import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { buildSiteModel } from '../../src/site/model.js';
import { renderSite } from '../../src/site/render.js';
import { writePages } from '../../src/site/pages.js';
import { sliceOf } from '../../src/census/slice.js';
import type { Frame } from '../../src/census/frame.js';
import type { Observation } from '../../src/record/types.js';
import type { Target } from '../../src/targets/load.js';
import type { DeepReading } from '../../src/quality/deep-check.js';

/**
 * These tests read the RENDERED OUTPUT, not the model — the same standard
 * `verify` holds against the record. A guarantee checked at the model can be
 * bypassed by a template literal; one checked at the output cannot.
 */

function target(host: string, id: string, agency = 'Test Agency'): Target {
  return {
    id,
    host,
    url: `https://${host}/`,
    agency,
    added: '2026-08-01',
    reason: 'test',
    traffic_evidence: { source: 'test', measured_at: '2026-08-01', visits: 1000 },
  } as unknown as Target;
}

function row(overrides: Partial<Observation> = {}): Observation {
  return {
    schema: '1',
    run_id: 'run-1',
    target_id: 'www-example-gov',
    host: 'www.example.gov',
    url: 'https://www.example.gov/',
    dimension: 'availability',
    checked_at: '2026-08-20T06:00:00Z',
    outcome: 'success',
    status_code: 200,
    redirect_chain: [],
    latency: { samples: 1, median_ms: 120, min_ms: 120, max_ms: 120 },
    tier: 'hot',
    method: {
      vantage: 'github-actions/test-runner-7',
      timeout_ms: 15_000,
      sample_count: 1,
      tool_version: '0.1.0',
      source: 'self_run',
    },
    ...overrides,
  } as Observation;
}

function fixtureRows(): Observation[] {
  const rows: Observation[] = [];
  for (let i = 0; i < 6; i++) {
    rows.push(
      row({
        checked_at: `2026-08-2${i}T06:00:00Z`,
        run_id: `run-${i}`,
        latency: { samples: 1, median_ms: 100 + i * 7, min_ms: 90, max_ms: 200 },
        outcome: i === 3 ? 'timeout' : 'success',
      }),
    );
  }
  return rows;
}

function render(
  rows: Observation[],
  targets = [target('www.example.gov', 'www-example-gov')],
  runs: import('../../src/site/model.js').RunRow[] = [],
  quality: DeepReading[] = [],
): string {
  const model = buildSiteModel({ targets, observations: rows, runs, quality });
  return renderSite(model, '2026-08-24 17:00 UTC');
}

function qualityReading(metrics: Record<string, number>, overrides: Partial<DeepReading> = {}): DeepReading {
  const units: Record<string, string> = { cumulative_layout_shift: 'unitless', total_byte_weight: 'byte' };
  return {
    schema: 'govwebchecker/quality/1',
    run_id: 'q-1',
    target_id: 'www-example-gov',
    host: 'www.example.gov',
    url: 'https://www.example.gov/',
    dimension: 'quality',
    checked_at: '2026-08-24T06:00:00Z',
    outcome: 'measured',
    metrics: Object.fromEntries(
      Object.entries(metrics).map(([k, v]) => [k, { value: v, unit: units[k] ?? 'millisecond' }]),
    ),
    method: {
      tool: 'lighthouse',
      tool_version: '13.4.1',
      preset: 'lighthouse:default/mobile',
      device: { form_factor: 'mobile', width: 412, height: 823, scale: 1.75, mobile: true },
      network: { rtt_ms: 150, throughput_kbps: 1638.4, cpu_slowdown: 4, method: 'simulate' },
      vantage: 'github-actions/test-runner-7',
      source: 'self_run',
    },
    ...overrides,
  };
}

const GOOD_PAGE = {
  first_contentful_paint: 1200, largest_contentful_paint: 1900, speed_index: 2400,
  cumulative_layout_shift: 0.02, total_blocking_time: 90, time_to_interactive: 2600,
  server_response_time: 300, total_byte_weight: 840_000,
};

/** The page body, with CSS (which legitimately contains `%`) removed. */
function body(html: string): string {
  return html.replace(/<style>[\s\S]*?<\/style>/, '');
}

/**
 * The body with every Figure-produced fragment removed — spans and captioned
 * charts alike (FR-281: a chart is a figure at a different size). A chart block
 * is only exempt because a separate assertion below proves every chart carries
 * its method caption; strip without that check and the guarantee is a hole.
 */
function outsideFigures(html: string): string {
  return body(html)
    .replace(/<figure class="chart"[\s\S]*?<\/figure>/g, '')
    // A band's tooltip states the published THRESHOLD that decided it — a cited
    // constant, not a measurement of ours. Exempt only because the assertion
    // below proves every band carries its threshold and its source.
    .replace(/<span class="band band--[a-z]+"[^>]*>[\s\S]*?<\/span>/g, '')
    // The counts a figure was computed FROM — its denominators, stated inside
    // that figure's own method disclosure. Exempt only because the assertion
    // below proves each one sits with the figure it explains.
    .replace(/<p class="denominators">[\s\S]*?<\/p>/g, '')
    .replace(/<span class="denominators">[\s\S]*?<\/span>/g, '')
    // The page's own provenance: what was built, when, from how much. Not a
    // measurement of any site. Exempt only because the assertion below proves
    // the footer states its build time and links the record it was built from.
    .replace(/<footer>[\s\S]*?<\/footer>/g, '')
    .replace(/<span class="(?:figure|absence)">[\s\S]*?<\/span><\/span>/g, '');
}

describe('every published quantity carries its method (FR-201, FR-251, SC-201)', () => {
  test('no percentage or latency token appears outside a Figure', () => {
    const html = render(fixtureRows());
    const naked = outsideFigures(html);
    assert.doesNotMatch(naked, /\d+(\.\d+)?\s*%/, 'a rate outside a Figure is a number without a method');
    assert.doesNotMatch(naked, /\b\d[\d,]*\s*ms\b/, 'a latency outside a Figure is a number without a method');
  });

  test('a rendered figure states tier, population, window, samples and vantage adjacent', () => {
    const html = render(fixtureRows());
    const figures = body(html).match(/<span class="figure">[\s\S]*?<\/span><\/span>/g) ?? [];
    assert.ok(figures.length > 0, 'the page must publish at least one Figure');
    for (const f of figures) {
      assert.match(f, /sites?\b/, `population missing: ${f}`);
      assert.match(f, /\d{4}-\d{2}-\d{2}/, `window missing: ${f}`);
      assert.match(f, /readings?\b/, `sample count missing: ${f}`);
      assert.match(f, /from /, `vantage missing: ${f}`);
    }
  });

  test('the vantage comes from the rows, never from configuration', () => {
    const html = render(fixtureRows());
    assert.match(html, /github-actions\/test-runner-7/, 'the vantage the rows carry must be the one shown');
  });
});

describe('the build refuses what it cannot honestly present', () => {
  test('a local-vantage row fails the build rather than being presented (FR-253)', () => {
    const rows = [...fixtureRows(), row({ run_id: 'run-local', method: {
      vantage: 'local', timeout_ms: 15_000, sample_count: 1, tool_version: '0.1.0', source: 'self_run',
    } as Observation['method'] })];
    assert.throws(
      () => render(rows),
      /local/,
      'a local reading measures the developer machine; presenting it as the target is the FR-024 error again',
    );
  });

  test('an empty record renders absence, not zeroes (FR-204)', () => {
    const html = render([]);
    const naked = outsideFigures(html);
    assert.doesNotMatch(naked, /\b0(\.0)?\s*%/, 'zero reads as measured-and-it-was-nothing');
    assert.doesNotMatch(naked, /\b0\s*ms\b/);
    assert.match(body(html), /no measurements yet/i);
  });
});

describe('the site links its own evidence (FR-206) and states its currency (FR-252)', () => {
  test('the record and the verification tool are linked', () => {
    const html = render(fixtureRows());
    assert.match(html, /data\/availability/, 'the record the site was built from must be reachable');
    assert.match(html, /verify/i, 'the tool that proves the record must be named');
  });

  test('the page states when it was built and how current each tier is', () => {
    const html = render(fixtureRows());
    assert.match(html, /2026-08-24 17:00 UTC/, 'when the site was built');
    assert.match(body(html), /latest reading[\s\S]*2026-08-25/i, 'how current the tier is (FR-252)');
  });

  test('a single-vantage figure is described as the network path, not the site alone (FR-203)', () => {
    const html = render(fixtureRows());
    assert.match(body(html), /network path/i);
  });
});

function censusRow(domain: string, overrides: Partial<Observation> = {}): Observation {
  return row({
    target_id: domain,
    host: domain,
    url: `https://${domain}/`,
    tier: 'broad',
    cycle: '2026-W34',
    slice: 1,
    url_rule: 'canonical/1',
    resolution: { status: 'address', apex: true, www: true },
    presence: { state: 'website', rule: 'presence/1' },
    ...overrides,
  } as Partial<Observation>);
}

function censusFixture(): Observation[] {
  return [
    censusRow('works.gov', { run_id: 'c1' }),
    censusRow('broken.gov', { run_id: 'c2', outcome: 'http_error', status_code: 500 }),
    censusRow('mailonly.gov', {
      run_id: 'c3',
      outcome: 'skipped',
      skip_reason: 'no web address published (mail_only)',
      latency: { samples: 0 },
      resolution: { status: 'mail_only', apex: false, www: false, codes: ['ENODATA'] },
      presence: { state: 'no_website', rule: 'presence/1' },
    } as Partial<Observation>),
    censusRow('unknown.gov', {
      run_id: 'c4',
      outcome: 'dns_failure',
      latency: { samples: 0 },
      resolution: { status: 'resolver_error', apex: false, www: false, codes: ['ESERVFAIL'] },
      presence: { state: 'undetermined', rule: 'presence/1' },
    } as Partial<Observation>),
  ];
}

describe('absence, uncertainty and failure never merge (FR-210 to FR-214, SC-202)', () => {
  test('presence renders as three figures per context, sharing one stated denominator', () => {
    // The invariant holds everywhere presence appears — the tier panel and each
    // census mark alike: exactly three figures (website, no_website,
    // undetermined) per context, one denominator, the rule named on each.
    const html = render([...fixtureRows(), ...censusFixture()]);
    const figures = body(html).match(/<span class="figure">[\s\S]*?<\/span><\/span>/g) ?? [];
    const presence = figures.filter((f) => /presence\/1/.test(f));
    assert.ok(presence.length >= 3, 'presence must be published');
    assert.equal(presence.length % 3, 0,
      'every context shows all three states — a missing one is a merged or dropped state');
    for (const f of presence) {
      assert.match(f, /\d+ sites?/, `the shared denominator must be stated: ${f}`);
      assert.match(f, /rule presence\/1/, `the versioned rule must travel with the reading (FR-205): ${f}`);
    }
    // Context = the paragraph the figures share. Three states per paragraph,
    // and within one paragraph all three carry the same denominator.
    const paragraphs = body(html).match(/<p>[\s\S]*?<\/p>/g) ?? [];
    for (const para of paragraphs) {
      const inPara = para.match(/<span class="figure">[\s\S]*?<\/span><\/span>/g)?.filter((f) => /presence\/1/.test(f)) ?? [];
      if (inPara.length === 0) continue;
      assert.equal(inPara.length, 3,
        `a context showing presence shows all three states — a missing one is a merged or dropped state: ${para.slice(0, 120)}`);
      const denominators = new Set(inPara.map((f) => f.match(/(\d+) sites?/)?.[1]));
      assert.equal(denominators.size, 1, 'one shared denominator per context');
    }
  });

  test('no failure vocabulary attaches to a domain with no website or an unknown one', () => {
    const html = body(render([...fixtureRows(), ...censusFixture()])).replace(/\s+/g, ' ');
    assert.doesNotMatch(
      html,
      /mailonly\.gov[^.]{0,80}(down|broken|fail)/i,
      'a domain publishing no website is not a broken one (FR-213)',
    );
    assert.doesNotMatch(
      html,
      /unknown\.gov[^.]{0,80}(down|broken|fail)/i,
      'our resolver failing is not the jurisdiction failing (FR-212)',
    );
  });

  test('a 500 is a website, and a broken one — distinct from both (FR-214)', () => {
    const html = render([...fixtureRows(), ...censusFixture()]);
    const model = buildSiteModel({
      targets: [target('www.example.gov', 'www-example-gov')],
      observations: [...fixtureRows(), ...censusFixture()],
      runs: [],
    });
    const broad = model.tiers.find((t) => t.tier === 'broad')!;
    assert.equal(broad.presence.website, 2, 'the 500 counts as a website that exists');
    assert.equal(broad.presence.no_website, 1);
    assert.equal(broad.presence.undetermined, 1);
    assert.match(html, /presence\/1/);
  });

  test('no view field merges two presence states (asserted over the emitted object graph)', () => {
    const model = buildSiteModel({
      targets: [target('www.example.gov', 'www-example-gov')],
      observations: [...fixtureRows(), ...censusFixture()],
      runs: [],
    });
    const names: string[] = [];
    const walk = (o: unknown, path: string): void => {
      if (o === null || typeof o !== 'object') return;
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
        names.push(`${path}.${k}`);
        walk(v, `${path}.${k}`);
      }
    };
    walk(model, 'model');
    const merged = names.filter((n) =>
      /down|broken|unavailable|failing/i.test(n.split('.').pop() ?? ''),
    );
    assert.deepEqual(merged, [], `no field may be a merged verdict: ${merged.join(', ')}`);
  });
});

describe('tiers never blend (FR-220 to FR-223, SC-203)', () => {
  test('every rendered figure names exactly one tier', () => {
    const html = render([...fixtureRows(), ...censusFixture()]);
    const figures = body(html).match(/<span class="figure">[\s\S]*?<\/span><\/span>/g) ?? [];
    assert.ok(figures.length > 0);
    for (const f of figures) {
      const hot = /hourly target/.test(f);
      const broad = /weekly target/.test(f);
      assert.ok(hot !== broad, `a figure must belong to exactly one tier: ${f}`);
    }
  });

  test('each tier panel states what its tier cannot answer (FR-223)', () => {
    const prose = body(render([...fixtureRows(), ...censusFixture()])).replace(/\s+/g, ' ');
    assert.match(prose, /cannot (see|detect|answer)[^.]{0,80}(short|interruption)/i,
      'the weekly census cannot detect a short interruption, and must say so');
    assert.match(prose, /says nothing about[^.]{0,60}other/i,
      'the hourly tier says nothing about the domains it does not check');
  });
});

describe('change over time is drawn at its cadence (FR-230 to FR-233, SC-207)', () => {
  function censusRuns(): import('../../src/site/model.js').RunRow[] {
    const base = {
      run_id: 'r', started_at: '2026-08-22T09:00:00Z', finished_at: '2026-08-22T10:00:00Z',
      targets_attempted: 2, targets_succeeded: 2, all_targets_failed: false,
      vantage: 'github-actions/test-runner-7',
      frame_digest: 'sha256:frame-a', frame_size: 16535, slice_size: 2300, tier: 'broad',
    };
    return [
      { ...base, run_id: 'cr1', cycle: '2026-W34', slice: 1 },
      { ...base, run_id: 'cr2', cycle: '2026-W35', slice: 4 },
    ] as unknown as import('../../src/site/model.js').RunRow[];
  }

  function twoCycles(): Observation[] {
    return [
      ...censusFixture(),
      censusRow('w35.gov', { run_id: 'c5', cycle: '2026-W35', slice: 4 }),
    ];
  }

  test('the census series renders one mark per cycle and draws nothing between them', () => {
    const html = render([...fixtureRows(), ...twoCycles()], undefined, censusRuns());
    const section = body(html).match(/<section class="census-series">[\s\S]*?<\/section>/)?.[0];
    assert.ok(section, 'the census series section must exist when census rows do');
    const marks = section.match(/class="mark/g) ?? [];
    assert.equal(marks.length, 2, 'one mark per cycle');
    assert.doesNotMatch(section, /<path|<line|polyline/i,
      'a path between weekly readings asserts knowledge of the days between (FR-230)');
  });

  test('an in-progress cycle is marked in progress and never as a movement', () => {
    const html = render([...fixtureRows(), ...twoCycles()], undefined, censusRuns());
    const prose = body(html).replace(/\s+/g, ' ');
    assert.match(prose, /2026-W35[\s\S]{0,200}?in progress/i);
    assert.match(prose, /1 of 7 daily passes/i, 'how much of the week has run must be stated');
  });

  test('a mid-cycle frame change is disclosed where the trend is shown (FR-232)', () => {
    const runs = censusRuns();
    (runs[1] as unknown as { cycle: string; frame_digest: string }).cycle = '2026-W34';
    (runs[1] as unknown as { frame_digest: string }).frame_digest = 'sha256:frame-b';
    const html = render([...fixtureRows(), ...censusFixture()], undefined, runs);
    const prose = body(html).replace(/\s+/g, ' ');
    assert.match(prose, /frame changed|registry changed/i,
      'slices against two digests are not one coverage claim');
  });
});

describe('every site the record knows has a listing (FR-245, FR-247, FR-248, SC-209)', () => {
  function frameOf(domains: string[]): Frame {
    return {
      source: 'test',
      retrieved_at: '2026-08-22T00:00:00Z',
      digest: 'sha256:test',
      domains: domains.map((domain) => ({
        domain, type: 'City', organization: 'Test', suborganization: '', city: '', state: '',
        slice: sliceOf(domain),
      })),
    };
  }

  test('the built tree carries one listing per site, none for the excluded, and each carries its obligations', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gwc-pages-'));
    try {
      const rows = [...fixtureRows(), ...censusFixture()];
      const frame = frameOf(['works.gov', 'broken.gov', 'mailonly.gov', 'unknown.gov', 'notyet.gov']);
      const written = await writePages({
        model: buildSiteModel({
          targets: [target('www.example.gov', 'www-example-gov')],
          observations: rows,
          runs: [],
        }),
        observations: rows,
        frame,
        outDir: dir,
        generatedAt: '2026-08-24 17:00 UTC',
        excluded: ['unknown.gov'],
      });

      // One listing per site the record knows, minus the excluded one.
      for (const host of ['www.example.gov', 'works.gov', 'broken.gov', 'mailonly.gov']) {
        const page = await fs.readFile(path.join(dir, 'sites', `${host}.html`), 'utf8');
        assert.match(page, /correct|remove/i, `${host}: correction route (FR-240)`);
        assert.match(page, /hourly|weekly/i, `${host}: cadence stated (FR-247)`);
        assert.match(page, /\d{4}-\d{2}-\d{2}/, `${host}: last-checked stated (FR-247)`);
      }
      await assert.rejects(
        () => fs.readFile(path.join(dir, 'sites', 'unknown.gov.html'), 'utf8'),
        'an excluded domain leaves current views; its rows stay in the record (FR-248)',
      );

      // Domain groups exist for the registered names.
      const group = await fs.readFile(path.join(dir, 'domains', 'works.gov.html'), 'utf8');
      assert.match(group, /1 site checked/);

      assert.ok(written.listings >= 4);
      assert.equal(written.excluded, 1);

      // The lookup's index is a self-hosted asset naming every page that exists
      // — checked and pending alike — and nothing else.
      const lookup = JSON.parse(await fs.readFile(path.join(dir, 'sites', 'index.json'), 'utf8'));
      for (const host of ['www.example.gov', 'works.gov', 'notyet.gov']) {
        assert.ok(lookup.includes(host), `lookup must find ${host}`);
      }
      assert.ok(!lookup.includes('unknown.gov'), 'an excluded domain is not offered by search');

      // D2: a frame domain the census has not reached yet is still reachable —
      // as "not yet checked", asserting nothing the record does not contain
      // (FR-249). Absence of a page would itself be a statement.
      const pending = await fs.readFile(path.join(dir, 'sites', 'notyet.gov.html'), 'utf8');
      assert.match(pending, /not (yet )?been checked|not yet checked/i);
      assert.doesNotMatch(pending.replace(/<style>[\s\S]*?<\/style>/, ''), /down|broken|failing/i);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('the page works on a phone and layers its depth (mobile + progressive disclosure)', () => {
  test('wide content scrolls in its own container; the page never scrolls sideways', () => {
    const html = render([...fixtureRows(), ...censusFixture()]);
    // Every <table> sits inside a .scroll container.
    const tables = (body(html).match(/<table>/g) ?? []).length;
    const scrolls = (body(html).match(/class="scroll"/g) ?? []).length;
    assert.ok(tables > 0);
    assert.ok(scrolls >= tables, `${tables} tables need ${tables} scroll containers, found ${scrolls}`);
    assert.match(html, /name="viewport" content="width=device-width/);
  });

  test('the presence bar renders as labeled segments, and color is never the only channel', () => {
    const html = render([...fixtureRows(), ...censusFixture()]);
    const viz = html.match(/<figure class="presence-viz"[\s\S]*?<\/figure>/g) ?? [];
    assert.ok(viz.length > 0, 'the part-to-whole visualization must exist when presence does');
    for (const v of viz) {
      const segs = (v.match(/<rect/g) ?? []).length;
      const keys = (v.match(/class="key"/g) ?? []).length;
      assert.equal(keys, segs, 'every drawn segment carries a text label with its count');
      assert.match(v, /aria-labelledby/, 'the figure is named for assistive tech');
      assert.doesNotMatch(v, /%/, 'segment labels are counts; a rate belongs to a Figure');
    }
  });

  test('technical depth is one disclosure away, and the plain reading needs no disclosure', () => {
    const html = render([...fixtureRows(), ...censusFixture()]);
    assert.match(html, /<details class="depth">/, 'per-tier detail sits behind a disclosure');
    // The plain-language essentials are NOT inside <details>: a non-technical
    // reader gets them without interacting.
    const outside = body(html).replace(/<details[\s\S]*?<\/details>/g, '');
    assert.match(outside, /Absence is not failure/);
    assert.match(outside, /have a website/i);
  });

  test('icons are decorative and every asset stays on-origin (FR-270, FR-271)', () => {
    const html = render([...fixtureRows(), ...censusFixture()]);
    const svgs = html.match(/<svg[^>]*class="(icon|logo)"[^>]*>/g) ?? [];
    assert.ok(svgs.length > 0, 'the page carries its icons inline');
    for (const tag of svgs) {
      assert.match(tag, /aria-hidden="true"/, 'icons never carry meaning the words do not');
    }
    // Script is welcome as enhancement (D4) — but only inline or same-origin,
    // and never load-bearing: the lookup panel is hidden until script runs, so
    // a reader without it sees the noscript route rather than a dead control.
    for (const tag of html.match(/<script[^>]*>/gi) ?? []) {
      assert.doesNotMatch(tag, /src\s*=\s*"(https?:)?\/\//i, `off-origin script: ${tag}`);
    }
    assert.doesNotMatch(html, /fetch\(\s*["'](https?:)?\/\//i, 'script must fetch same-origin only');
    assert.match(html, /data-lookup hidden/, 'enhanced UI is hidden until the enhancement exists');
    assert.match(html, /<noscript>/, 'the no-script reader gets a stated route, not silence');
  });

  test('every host named in the table links to its own listing (FR-240)', () => {
    const html = render([...fixtureRows(), ...censusFixture()]);
    assert.match(html, /href="sites\/www\.example\.gov\.html"/,
      'the naming surface links the page where readings and the correction route live');
  });
});

describe('the ecosystem view (D5, FR-280 to FR-286)', () => {
  function frameWithTypes(): import('../../src/census/frame.js').Frame {
    return {
      source: 'test',
      retrieved_at: '2026-08-22T00:00:00Z',
      digest: 'sha256:test',
      domains: [
        { domain: 'works.gov', type: 'City', organization: 'T', suborganization: '', city: '', state: '', slice: 0 },
        { domain: 'broken.gov', type: 'County', organization: 'T', suborganization: '', city: '', state: '', slice: 0 },
        { domain: 'mailonly.gov', type: 'City - Election', organization: 'T', suborganization: '', city: '', state: '', slice: 0 },
        { domain: 'unknown.gov', type: 'School district', organization: 'T', suborganization: '', city: '', state: '', slice: 0 },
      ],
    };
  }

  function fullModel(): ReturnType<typeof buildSiteModel> {
    return buildSiteModel({
      targets: [target('www.example.gov', 'www-example-gov')],
      observations: [...fixtureRows(), ...censusFixture()],
      runs: [],
      frame: frameWithTypes(),
    });
  }

  test('every chart carries its method as a caption (FR-281) — the exemption the stripper relies on', () => {
    const html = renderSite(fullModel(), '2026-08-24 17:00 UTC');
    const charts = body(html).match(/<figure class="chart"[\s\S]*?<\/figure>/g) ?? [];
    assert.ok(charts.length >= 2, 'the page leads with visualization (FR-280)');
    for (const c of charts) {
      assert.match(c, /class="chart-method"/, `a chart without its method is a bare number at scale: ${c.slice(0, 100)}`);
      assert.match(c, /readings?\b/, 'sample count in the caption');
      assert.match(c, /from /, 'vantage in the caption');
      assert.match(c, /\d{4}-\d{2}-\d{2}/, 'window in the caption');
    }
  });

  test('presence composition is shown across kinds of government, three states intact (FR-282)', () => {
    const html = renderSite(fullModel(), '2026-08-24 17:00 UTC');
    const eco = body(html).match(/<figure class="chart" role="img" aria-labelledby="eco-t"[\s\S]*?<\/figure>/)?.[0];
    assert.ok(eco, 'the by-kind composition must exist when the frame is supplied');
    assert.match(eco, /City/);
    assert.match(eco, /County/);
    assert.doesNotMatch(eco, /City - Election/, 'election variants fold into their parent kind');
    for (const cls of ['seg-website', 'seg-none', 'seg-unknown']) {
      assert.match(eco, new RegExp(cls), 'all three states, never merged');
    }
  });

  test('the daily trend is a line, and the census never is (FR-283)', () => {
    const html = renderSite(fullModel(), '2026-08-24 17:00 UTC');
    const trend = body(html).match(/aria-labelledby="trend-a-t"[\s\S]*?<\/figure>/)?.[0];
    assert.ok(trend, 'the answered-by-day trend renders when monitoring rows exist');
    assert.match(trend, /<polyline/, 'hourly sampling may draw a connected daily line');
    const census = body(html).match(/<section class="census-series">[\s\S]*?<\/section>/)?.[0] ?? '';
    assert.doesNotMatch(census, /<polyline|<path|<line/i, 'the census stays marks');
  });

  test('agencies compare on one measure, and declining automation is a stance, not a zero (FR-284)', () => {
    const rows = [
      ...fixtureRows(),
      ...['a', 'b', 'c'].map((i) =>
        row({
          run_id: `blocked-${i}`,
          target_id: 'www-ssa-gov',
          host: 'www.ssa.gov',
          checked_at: `2026-08-2${i === 'a' ? 0 : i === 'b' ? 1 : 2}T06:00:00Z`,
          outcome: 'blocked',
          status_code: 403,
          latency: { samples: 0 },
        }),
      ),
    ];
    const html = renderSite(
      buildSiteModel({
        targets: [
          target('www.example.gov', 'www-example-gov'),
          target('www.ssa.gov', 'www-ssa-gov', 'Social Security Administration'),
        ],
        observations: rows,
        runs: [],
      }),
      '2026-08-24 17:00 UTC',
    );
    const prose = body(html).replace(/\s+/g, ' ');
    assert.match(prose, /How do agencies compare/);
    assert.match(prose, /refusal of automated traffic|declines? automation|Declining robots/i);
    const agencyBlock = body(html).match(/aria-labelledby="agency-t"[\s\S]*?<\/figure>/)?.[0] ?? '';
    assert.doesNotMatch(agencyBlock, /www\.ssa\.gov|0\.0%/, 'no zero bar for a refusing agency');
  });

  test('the masthead does not reintroduce the machinery the page removed (FR-286, D4)', () => {
    // Headings were cleaned of tier vocabulary; the introduction was not, and it
    // is the first thing a reader meets. D4 removed tiers as a category, so the
    // page must not teach one on the way in.
    const html = renderSite(fullModel(), '2026-08-24 17:00 UTC');
    const intro = body(html).slice(0, body(html).indexOf('class="dashboard"'));
    assert.doesNotMatch(intro, /\btiers?\b|\bslices?\b|\bcycles?\b/i,
      `the way in should not require our vocabulary: ${intro.replace(/<[^>]+>/g, ' ').trim().slice(0, 200)}`);
  });

  test('the tiles are the first thing a reader meets (FR-310)', () => {
    const html = body(renderSite(fullModel(), '2026-08-24 17:00 UTC'));
    const dashboard = html.indexOf('class="dashboard"');
    // Nothing numeric may sit above them competing for the first screen.
    const above = html.slice(0, dashboard);
    assert.doesNotMatch(above, /<ul class="stats"/,
      'a row of context-free counts above the tiles pushes the answer off the first screen');
  });

  test('no bare count is published outside a Figure either (FR-201)', () => {
    // The stripper caught rates and latencies; a count is just as much a
    // measurement, and "58 sites" with no window or vantage is exactly the
    // unmethodded number Principle V forbids.
    const naked = outsideFigures(renderSite(fullModel(), '2026-08-24 17:00 UTC'));
    const pattern = /\b\d[\d,]*\s+(?:sites?|domains?|observations?|readings?)\b/gi;
    const hits: string[] = [];
    for (const m of naked.matchAll(pattern)) {
      hits.push(naked.slice(Math.max(0, m.index - 70), m.index + m[0].length + 25).replace(/\s+/g, ' '));
    }
    assert.deepEqual(hits, [], 'a count outside a Figure is a number without a method');
  });

  test('the footer earns its exemption by stating what the page was built from', () => {
    const footer = body(renderSite(fullModel(), '2026-08-24 17:00 UTC'))
      .match(/<footer>[\s\S]*?<\/footer>/)?.[0] ?? '';
    assert.ok(footer, 'the page must carry a provenance footer');
    assert.match(footer, /2026-08-24 17:00 UTC/, 'when the page was built');
    assert.match(footer, /\d{4}-\d{2}-\d{2}/, 'the window the record covers');
    assert.match(footer, /href="[^"]*(github|data)/i, 'and a link to the record itself');
  });

  test('a denominator block only ever appears with the figure it explains', () => {
    // This is the exemption the count check above relies on. A denominators
    // block is method: the counts a figure was computed from. Loose on the page
    // it would be a set of bare numbers; inside the method disclosure of a panel
    // that publishes a Figure, it is that Figure's working.
    const html = body(renderSite(fullModel(), '2026-08-24 17:00 UTC'));
    const panels = html.match(/<div class="panel tier-panel">[\s\S]*?<\/div>\s*<\/div>/g) ?? [];
    const blocks = html.match(/<p class="denominators">/g) ?? [];
    assert.ok((html.match(/<span class="denominators">/g) ?? []).length > 0,
      'the inline denominator exemption must be exercised too');
    assert.ok(blocks.length > 0, 'the exemption must be exercised, or it is untested');
    let accounted = 0;
    for (const panel of panels) {
      const inside = panel.match(/<p class="denominators">/g) ?? [];
      if (inside.length === 0) continue;
      accounted += inside.length;
      assert.match(panel, /class="figure"/,
        `denominators without the figure they explain: ${panel.slice(0, 160)}`);
      // Every one of them, not merely one of them: a block above the disclosure
      // is a set of bare numbers standing on its own, which is exactly what the
      // exemption must not cover.
      const above = panel.slice(0, panel.indexOf('<details class="depth">'));
      assert.deepEqual(above.match(/<p class="denominators">/g) ?? [], [],
        'denominators must sit inside the method disclosure, not beside the headline');
    }
    assert.equal(accounted, blocks.length,
      'every denominators block must belong to a panel that publishes a figure');
  });

  test('a figure states its cadence, never a tier name (FR-286, D4)', () => {
    // The heading scan below never looked inside a method line, so the machinery
    // survived in the one place every figure carries it.
    const html = body(renderSite(fullModel(), '2026-08-24 17:00 UTC'));
    const methods = html.match(/<span class="method">[\s\S]*?<\/span>/g) ?? [];
    assert.ok(methods.length > 0);
    for (const m of methods) {
      assert.doesNotMatch(m, /\btiers?\b|\bslices?\b/i,
        `a reader should not meet our machinery in a method line: ${m}`);
    }
    assert.ok(methods.some((m) => /(hourly|weekly) target/.test(m)),
      'a figure must still say how often the reading was taken');

    // The cadence phrase is what now keeps the two populations apart, so the
    // phrases must actually differ. Collapsing them to one word would let a
    // weekly census figure read as an hourly one, which is the blend the tier
    // labels existed to prevent (FR-220) — and no other check would notice.
    const cadences = new Set(
      methods.map((m) => m.match(/(hourly|weekly) target/)?.[1]).filter(Boolean),
    );
    assert.ok(cadences.size >= 2,
      `a page carrying both populations must distinguish them: saw ${[...cadences].join(', ')}`);
  });

  test('collection vocabulary never structures the page (FR-286)', () => {
    const html = renderSite(fullModel(), '2026-08-24 17:00 UTC');
    const headings = body(html).match(/<(h1|h2|h3|summary|caption|th)\b[^>]*>[\s\S]*?<\/\1>/g) ?? [];
    for (const h of headings) {
      const text = h.replace(/<[^>]+>/g, ' ');
      assert.doesNotMatch(
        text,
        /\btiers?\b|\bslices?\b|\bcycles?\b/i,
        `a reader should never need our machinery's vocabulary to navigate: ${text.trim().slice(0, 80)}`,
      );
    }
  });
});

describe('a measurement is published with what it means (FR-301 to FR-303)', () => {
  test('every band states its threshold and cites a source — the exemption the stripper relies on', () => {
    const html = render(fixtureRows());
    const bands = body(html).match(/<span class="band band--[a-z]+"[^>]*>[\s\S]*?<\/span>/g) ?? [];
    assert.ok(bands.length > 0, 'response times must be interpreted, not left as raw units');
    for (const b of bands) {
      const title = b.match(/title="([^"]*)"/)?.[1] ?? '';
      assert.match(title, /\d/, `a band must state the threshold that decided it: ${b}`);
      assert.match(title, /web\.dev|Google/i, `a band must cite where its threshold came from: ${b}`);
    }
  });

  test('the band never replaces the measurement it interprets (FR-303)', () => {
    const html = body(render(fixtureRows()));
    // Wherever a band appears, the exact figure appears in the same cell.
    const cells = html.match(/<td class="num">[\s\S]*?<\/td>/g) ?? [];
    const banded = cells.filter((c) => /class="band/.test(c));
    assert.ok(banded.length > 0);
    for (const c of banded) {
      assert.match(c, /class="figure"/, `a band must sit beside its figure, never instead of it: ${c}`);
      assert.match(c, /class="method"/, 'and the full method stays with it');
    }
  });
});

/**
 * The dashboard (US2, FR-310 to FR-312).
 *
 * A first screen that answers before it enumerates. The owner's framing: most
 * people do not know what "ms" means, or whether 500 of them is good — so the
 * tiles say what was found in words, keep the figure and its method attached,
 * and lead to the detail for anyone who wants it.
 */
describe('the first screen answers rather than enumerates (FR-310 to FR-312)', () => {
  const dashboardHtml = () => {
    const html = render(fixtureRows(), undefined, [], [qualityReading(GOOD_PAGE)]);
    return html.slice(0, html.indexOf('</section>') + 10);
  };

  test('the first screen is tiles, and no table appears before them', () => {
    const html = render(fixtureRows());
    const dashboard = html.indexOf('class="dashboard"');
    assert.ok(dashboard > 0, 'the page must open with a dashboard');
    const table = html.indexOf('<table');
    assert.ok(table === -1 || table > dashboard, 'a raw table must not be the first thing a reader meets');
    assert.ok(html.indexOf('class="tile') > dashboard);
  });

  test('every tile states what was found in words, not only in numbers', () => {
    const tiles = dashboardHtml().match(/<a class="tile[\s\S]*?<\/a>/g) ?? [];
    assert.ok(tiles.length >= 3, `expected several tiles, got ${tiles.length}`);
    for (const tile of tiles) {
      const state = tile.match(/<p class="tile-state">([\s\S]*?)<\/p>/)?.[1] ?? '';
      assert.ok(state.length > 3, `a tile must say what was found: ${tile}`);
      // The visible words only. A band's title attribute states the published
      // threshold that decided it — a cited constant, not the reading restated —
      // and a separate assertion proves every band carries one.
      const words = state.replace(/<[^>]*>/g, '').trim();
      assert.ok(words.length > 3, `a tile's plain reading must be words, not markup: ${tile}`);
      assert.doesNotMatch(words, /\d+(\.\d+)?\s*(%|ms)\b/,
        `the plain reading must not be the raw number restated: "${words}"`);
    }
  });

  test('every tile leads to the detail behind it (FR-311)', () => {
    const html = render(fixtureRows(), undefined, [], [qualityReading(GOOD_PAGE)]);
    const tiles = html.match(/<a class="tile[^>]*href="([^"]+)"/g) ?? [];
    assert.ok(tiles.length >= 3);
    for (const tile of tiles) {
      const href = tile.match(/href="([^"]+)"/)![1]!;
      assert.match(href, /^#/, `a tile must lead somewhere on this page: ${href}`);
      assert.ok(html.includes(`id="${href.slice(1)}"`),
        `the tile points at ${href}, which nothing on the page answers to`);
    }
  });

  test('a dimension with no readings is not-yet-measured, never zero and never absent (FR-312)', () => {
    // No quality readings at all: the tile must still be there, saying so.
    const html = render(fixtureRows());
    const experience = html.match(/<a class="tile[^>]*id-page-experience[\s\S]*?<\/a>/)
      ?? html.match(/<a class="tile[\s\S]*?page-experience[\s\S]*?<\/a>/);
    assert.ok(experience, 'the tile must appear even with nothing measured — a missing tile reads as nothing to say');
    assert.match(experience[0], /not yet|no readings|nothing measured/i);
    assert.doesNotMatch(experience[0], /\b0\s*(%|of)/, 'nothing measured is not a score of zero');
  });

  test('a tile that carries a number carries its method with it', () => {
    const tiles = dashboardHtml().match(/<a class="tile[\s\S]*?<\/a>/g) ?? [];
    for (const tile of tiles) {
      const stripped = tile
        .replace(/<span class="band band--[a-z]+"[^>]*>[\s\S]*?<\/span>/g, '')
    // The counts a figure was computed FROM — its denominators, stated inside
    // that figure's own method disclosure. Exempt only because the assertion
    // below proves each one sits with the figure it explains.
    .replace(/<p class="denominators">[\s\S]*?<\/p>/g, '')
    .replace(/<span class="denominators">[\s\S]*?<\/span>/g, '')
    // The page's own provenance: what was built, when, from how much. Not a
    // measurement of any site. Exempt only because the assertion below proves
    // the footer states its build time and links the record it was built from.
    .replace(/<footer>[\s\S]*?<\/footer>/g, '')
        .replace(/<span class="(?:figure|absence)">[\s\S]*?<\/span><\/span>/g, '');
      assert.doesNotMatch(stripped, /\d+(\.\d+)?\s*%/, `a rate outside a Figure: ${tile}`);
      assert.doesNotMatch(stripped, /\b\d[\d,]*\s*ms\b/, `a latency outside a Figure: ${tile}`);
    }
  });

  test('the quality figures state the cadence they were actually taken at', () => {
    // The defect this pins: every deep-quality figure read "checked hourly" on
    // the first real build, because the model constructed them with the hourly
    // tier. The deep check runs once a day. Overstating a cadence
    // twenty-four-fold is a false method, and the label test alone could not
    // catch it — that only proved 'daily' renders as "checked daily", never that
    // anything passes 'daily'.
    const html = render(fixtureRows(), undefined, [], [qualityReading(GOOD_PAGE)]);
    const section = html.slice(html.indexOf('id="page-experience"'), html.indexOf('<h2', html.indexOf('id="page-experience"') + 10));
    const cadences = new Set(section.match(/(?:hourly|daily|weekly) target/g) ?? []);
    assert.ok(cadences.size > 0, 'the section must publish figures at all');
    assert.deepEqual([...cadences], ['daily target'],
      `deep readings are taken daily; this section claims ${[...cadences].join(', ')}`);

    // And the tile that leads to it must agree with the section it leads to.
    const tile = html.match(/<a class="tile[^>]*id="tile-page-experience"[\s\S]*?<\/a>/)![0];
    assert.match(tile, /daily target/);
    assert.doesNotMatch(tile, /hourly target|weekly target/);
  });

  test('a mixed result says how mixed, not just that it is mixed', () => {
    // "Mixed" for six of seven rows is what the first real build published, and
    // it tells a reader nothing: eight sites passing out of forty-nine reads
    // identically to thirty-seven. The counts exist in the model; hiding them
    // wastes the only thing that makes a check actionable.
    const html = render(fixtureRows(), undefined, [], [
      qualityReading(GOOD_PAGE),
      qualityReading({ ...GOOD_PAGE, largest_contentful_paint: 9000 },
        { host: 'slow.gov', target_id: 'slow-gov', url: 'https://slow.gov/' }),
    ]);
    const section = html.slice(html.indexOf('id="page-experience"'));
    const row = section.match(/<tr>\s*<th scope="row">Does the main content appear quickly\?[\s\S]*?<\/tr>/)![0];
    const text = row.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    assert.match(text, /\b1 of 2\b/,
      `a mixed row must publish how many passed of how many measured: ${text}`);
  });

  test('the count of sites passing carries its method, like any other figure', () => {
    const html = render(fixtureRows(), undefined, [], [qualityReading(GOOD_PAGE)]);
    const section = html.slice(html.indexOf('id="page-experience"'));
    // A bare "1 of 2 sites" would be a published quantity with no window, no
    // vantage and no cadence — the thing the Figure type exists to prevent.
    const naked = outsideFigures(section);
    assert.doesNotMatch(naked, /\b\d[\d,]*\s+(?:sites?|pages?)\b/,
      'a count of sites outside a Figure is a number without a method');
  });

  test('the page-experience tile summarises the checks without hiding them', () => {
    const html = render(fixtureRows(), undefined, [], [qualityReading(GOOD_PAGE)]);
    // The composite is permitted as analysis (D3) only while the parts stay
    // visible, so the individual checks must be on the page too (FR-332).
    assert.match(html, /Does the main content appear quickly\?/);
    assert.match(html, /Does the page hold still while it loads\?/);
    // And every check must name the line it was judged against, and who drew it.
    assert.match(html, /web\.dev|Core Web Vitals|Lighthouse/);
  });

  test('a page that fails a check is not described as passing', () => {
    const slow = { ...GOOD_PAGE, largest_contentful_paint: 9000, total_blocking_time: 1400 };
    const html = render(fixtureRows(), undefined, [], [qualityReading(slow)]);
    const section = html.slice(html.indexOf('id="page-experience"'));
    assert.match(section, /Does the main content appear quickly\?/);
    assert.match(section, /9,?000|9\.0 s|9000/, 'the failing measurement itself is shown, not hidden behind a word');
  });
});

/**
 * The tile that says whether government is online is the single most quotable
 * thing on this page, and the easiest place to be unfair.
 *
 * A 403 is an answer. The server responded and declined a bot, which the rest of
 * this site is careful to call a posture rather than an outage — the agency
 * section carves it out explicitly. In the live record 15.5 of the 20.4 points
 * of non-success are exactly that, so a first screen driven by the success rate
 * would tell a reader that many government websites are down when the record
 * says most of them answered and refused us.
 */
describe('a refusal is never published as an outage (Principle V, FR-261)', () => {
  const withRefusals = (): Observation[] => {
    const rows: Observation[] = [];
    for (let i = 0; i < 10; i++) {
      rows.push(row({
        checked_at: `2026-08-2${i % 5}T0${i}:00:00Z`,
        run_id: `run-${i}`,
        // Eight of ten decline automated traffic; one succeeds, one times out.
        ...(i < 8
          ? { outcome: 'blocked' as const, status_code: 403, latency: { samples: 0 } }
          : i === 8
            ? { outcome: 'success' as const, latency: { samples: 1, median_ms: 120, min_ms: 120, max_ms: 120 } }
            : { outcome: 'timeout' as const, latency: { samples: 0 } }),
      }));
    }
    return rows;
  };

  test('a record that is mostly refusals does not read as government being down', () => {
    const html = render(withRefusals());
    const tile = html.match(/<a class="tile[^>]*id="tile-answering"[\s\S]*?<\/a>/)![0];
    const words = (tile.match(/<p class="tile-state">([\s\S]*?)<\/p>/)?.[1] ?? '')
      .replace(/<[^>]*>/g, '').trim();
    assert.doesNotMatch(words, /\b(down|offline|outage|not online|unavailable)\b/i,
      `eight of ten checks were declined, not failed: "${words}"`);
    assert.doesNotMatch(words, /many are not|most are not/i,
      `a refusal is a posture, not an absence: "${words}"`);
  });

  test('the words on the tile and the number under them describe the same thing', () => {
    // Eight refusals, one success, one timeout. A tile whose words are drawn
    // from the failures but whose figure is the success rate would say "almost
    // all" above "10%", which is not a subtle problem.
    const html = render(withRefusals());
    const tile = html.match(/<a class="tile[^>]*id="tile-answering"[\s\S]*?<\/a>/)![0];
    const value = Number(tile.match(/<span class="figure">([\d.]+)%/)?.[1]);
    assert.ok(Number.isFinite(value), `the tile must publish a rate: ${tile}`);
    assert.ok(value >= 85, `nine of ten checks reached the site; the tile shows ${value}%`);
  });

  test('the tile names refusal as its own thing, distinct from failing', () => {
    const html = render(withRefusals());
    const tile = html.match(/<a class="tile[^>]*id="tile-answering"[\s\S]*?<\/a>/)![0];
    assert.match(tile, /declin|refus/i,
      'a reader must be told that some sites answer by declining automated traffic');
  });

  test('the figure on the tile is the aggregate of the line beside it', () => {
    // The fixture carries rows from before the record had a tier field — the
    // live record's actual situation, and the one where the responded rate and
    // the success rate diverge. The tile must publish the responded rate,
    // computed here from the rows rather than read back from the model.
    const untiered = (o: Partial<Observation>): Observation => {
      const r = row(o) as Observation & { tier?: unknown };
      delete r.tier;
      return r;
    };
    const rows = [
      ...fixtureRows(),
      untiered({ checked_at: '2026-08-19T06:00:00Z', run_id: 'old-1' }),
      untiered({ checked_at: '2026-08-19T07:00:00Z', run_id: 'old-2', outcome: 'timeout',
        latency: { samples: 0 } }),
    ];
    const asked = rows.filter((o) => o.outcome !== 'skipped');
    const reached = asked.filter(
      (o) => o.outcome === 'success' || o.outcome === 'blocked' || o.outcome === 'http_error',
    );
    const expected = ((100 * reached.length) / asked.length).toFixed(1);

    const html = render(rows);
    const tile = html.match(/<a class="tile[^>]*id="tile-answering"[\s\S]*?<\/a>/)![0];
    assert.ok(tile.includes('<svg class="spark"'), 'the tile must draw its series');
    const printed = tile.match(/<span class="figure">([\d.]+)%/)?.[1];
    assert.equal(printed, expected,
      `the tile must publish the rate its line draws, not the success rate: ${tile}`);
  });
});
