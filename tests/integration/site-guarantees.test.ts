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

/**
 * These tests read the RENDERED OUTPUT, not the model — the same standard
 * `verify` holds against the record. A guarantee checked at the model can be
 * bypassed by a template literal; one checked at the output cannot.
 */

function target(host: string, id: string): Target {
  return {
    id,
    host,
    url: `https://${host}/`,
    agency: 'Test Agency',
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
): string {
  const model = buildSiteModel({ targets, observations: rows, runs });
  return renderSite(model, '2026-08-24 17:00 UTC');
}

/** The page body, with CSS (which legitimately contains `%`) removed. */
function body(html: string): string {
  return html.replace(/<style>[\s\S]*?<\/style>/, '');
}

/** The body with every Figure-produced fragment removed. What remains must publish no quantity. */
function outsideFigures(html: string): string {
  return body(html).replace(/<span class="(?:figure|absence)">[\s\S]*?<\/span><\/span>/g, '');
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
      const hot = /hot tier/.test(f);
      const broad = /broad tier/.test(f);
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
    assert.match(prose, /1 of 7 slices/i, 'how much of the cycle has run must be stated');
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
