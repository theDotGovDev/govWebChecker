import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { renderSite } from '../../src/site/render.js';
import { buildSiteModel } from '../../src/site/model.js';
import type { Target } from '../../src/targets/load.js';
import type { Observation } from '../../src/record/types.js';

const target: Target = {
  id: 'a', host: 'a.gov', url: 'https://a.gov/', agency: 'Dept of A',
  jurisdiction: 'federal', inclusion_reason: 'Rank 1',
  traffic_evidence: { source: 't', measure: 'visits', visits: 5 }, active: true,
};

function obs(overrides: Partial<Observation> = {}): Observation {
  return {
    schema: '1', run_id: 'r', target_id: 'a', host: 'a.gov', url: 'https://a.gov/',
    dimension: 'availability', checked_at: '2026-08-03T12:00:00Z', outcome: 'success',
    status_code: 200, redirect_chain: [],
    latency: { samples: 3, median_ms: 42, min_ms: 40, max_ms: 55 },
    method: { vantage: 'github-actions/Linux', timeout_ms: 15000, sample_count: 3, tool_version: '0.1.0', source: 'self_run' },
    ...overrides,
  };
}

describe('site rendering', () => {
  test('shows the median across readings, with the count it came from', () => {
    const html = renderSite(
      buildSiteModel({
        targets: [target],
        observations: [
          obs({ checked_at: '2026-08-03T10:00:00Z', latency: { samples: 1, median_ms: 40, min_ms: 40, max_ms: 40 } }),
          obs({ checked_at: '2026-08-03T11:00:00Z', latency: { samples: 1, median_ms: 55, min_ms: 55, max_ms: 55 } }),
        ],
        runs: [],
      }),
      'now',
    );
    assert.match(html, /55 ms/);
    // The spread and count now travel inside the figure's method rather than as
    // a bare token — same information, guaranteed adjacent to the number.
    assert.match(html, /spread 40–55 ms/);
    assert.match(html, /2 readings/);
  });

  test('refuses to present a single reading as a response time (FR-011a)', () => {
    const html = renderSite(buildSiteModel({ targets: [target], observations: [obs()], runs: [] }), 'now');
    assert.match(html, /not enough readings yet/);
    assert.doesNotMatch(html, /42 ms/, 'the lone reading must not be shown as the figure');
  });

  test('says "no measurement" rather than showing a zero', () => {
    const html = renderSite(buildSiteModel({ targets: [target], observations: [], runs: [] }), 'now');
    assert.match(html, /no measurement/);
    assert.doesNotMatch(html, /0 ms/);
  });

  test('states every outcome in words, not by colour alone', () => {
    const html = renderSite(
      buildSiteModel({ targets: [target], observations: [obs({ outcome: 'blocked', status_code: 403, latency: { samples: 0 } })], runs: [] }),
      'now',
    );
    assert.match(html, /Refused our request/);
  });

  test('carries the vantage-point caveat on the page', () => {
    const html = renderSite(buildSiteModel({ targets: [target], observations: [obs()], runs: [] }), 'now');
    assert.match(html, /data centre/i);
    assert.match(html, /not.{0,40}what a person on a home or mobile connection/is);
  });

  test('never claims uptime', () => {
    const html = renderSite(buildSiteModel({ targets: [target], observations: [obs()], runs: [] }), 'now');
    assert.doesNotMatch(html, /\b99\.\d%|uptime of|is up\b/i);
  });

  test('escapes text that could otherwise inject markup', () => {
    const nasty: Target = { ...target, agency: '<script>alert(1)</script>' };
    const html = renderSite(buildSiteModel({ targets: [nasty], observations: [], runs: [] }), 'now');
    assert.doesNotMatch(html, /<script>alert/);
    assert.match(html, /&lt;script&gt;/);
  });

  test('no asset is fetched from a third-party origin (FR-270)', () => {
    // Links TO other sites are fine — the measured site, the repository. What
    // never leaves the origin is an ASSET: anything a visitor's browser fetches
    // automatically. That is the rule D4 decided; the old blanket no-script,
    // no-external test enforced a stricter rule no spec had ever stated.
    const html = renderSite(buildSiteModel({ targets: [target], observations: [obs()], runs: [] }), 'now');
    assert.match(html, /^<!doctype html>/);
    assert.match(html, /<\/html>\s*$/);
    const assetTags =
      html.match(/<(script|img|source|iframe|embed|object|track|video|audio|use)\b[^>]*>/gi) ?? [];
    const linkTags = html.match(/<link\b[^>]*>/gi) ?? [];
    for (const tag of [...assetTags, ...linkTags]) {
      const url = tag.match(/(?:src|href|data)\s*=\s*"([^"]*)"/i)?.[1];
      if (url === undefined) continue;
      assert.doesNotMatch(url, /^(https?:)?\/\//i, `asset fetched off-origin: ${tag}`);
    }
    // @import and url() in styles are asset fetches too.
    assert.doesNotMatch(html, /@import\s+url?\(?\s*["']?https?:/i);
    assert.doesNotMatch(html, /url\(\s*["']?https?:/i);
  });

  test('every reading is in the HTML itself — script is never the only path (FR-271)', () => {
    const html = renderSite(buildSiteModel({ targets: [target], observations: [obs()], runs: [] }), 'now');
    // The page is server-rendered: figures, methods, and disclosures are markup,
    // not the product of a script. If a script tag exists it must be same-origin
    // (checked above) and the content must already be present without it.
    assert.match(html, /class="figure"/);
    assert.match(html, /<details/);
  });

  test('uses table semantics a screen reader can navigate', () => {
    const html = renderSite(buildSiteModel({ targets: [target], observations: [obs()], runs: [] }), 'now');
    assert.match(html, /<th scope="col">/);
    assert.match(html, /<th scope="row">/);
    assert.match(html, /<caption>/);
  });
});

describe('the page never publishes a figure without its population (SC-107)', () => {
  const model = {
    sites: [],
    tiers: [
      {
        tier: 'hot',
        population: 'federal hosts selected by measured public traffic, checked hourly',
        observations: 100,
        domains: 58,
        responded: 90,
        outcomes: { success: 90, timeout: 10 },
        presence: { website: 0, no_website: 0, undetermined: 0 },
      },
      {
        tier: 'broad',
        population: 'all registered US .gov domains, checked on a rolling weekly cycle',
        observations: 2364,
        domains: 2364,
        responded: 1900,
        outcomes: { success: 1900, dns_failure: 300, timeout: 164 },
        presence: { website: 2000, no_website: 300, undetermined: 64 },
      },
    ],
    census: {
      cycles: [
        {
          cycle: '2026-W34',
          domains: 2364,
          slices: [0],
          presence: { website: 2000, no_website: 300, undetermined: 64 },
        },
      ],
    },
    summary: {
      targets: 58,
      withData: 58,
      withoutData: 0,
      observations: 2464,
      vantages: ['github-actions/Linux'],
    },
    discardedRuns: 0,
  };

  test('states each tier population in words next to its numbers', () => {
    const prose = renderSite(model, '2026-08-22T06:00:00Z').replace(/\s+/g, ' ');
    assert.match(prose, /federal hosts selected by measured public traffic/);
    assert.match(prose, /all registered US \.gov domains/);
  });

  test('says plainly that absence is not failure', () => {
    // The page carries the largest correctness risk in the feature, so it has to
    // explain it rather than leave a reader to infer that 300 dns_failures mean
    // 300 broken government websites.
    //
    // Whitespace is collapsed first: the assertion is about the prose a reader
    // sees, not about where the source happens to wrap, and a test that breaks
    // on reflowing a paragraph is a test people learn to ignore.
    const prose = renderSite(model, '2026-08-22T06:00:00Z').replace(/\s+/g, ' ');
    assert.match(prose, /publishes no web address/i);
    assert.match(prose, /is not a broken website|different fact/i);
  });

  test('shows an incomplete cycle as incomplete', () => {
    const html = renderSite(model, '2026-08-22T06:00:00Z');
    assert.match(html, /1 of 7/);
    assert.match(html, /incomplete/i);
  });

  test('does not print a single combined availability headline', () => {
    // Both tiers appear, so a reader can compute what they like — but the page
    // itself never does the mixing for them.
    const html = renderSite(model, '2026-08-22T06:00:00Z');
    assert.ok(
      !/overall availability|total uptime|availability across/i.test(html),
      'a combined headline would mix two populations into one wrong number',
    );
  });
});
