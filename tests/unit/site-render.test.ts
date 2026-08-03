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
  test('shows a measured figure with its spread and sample count', () => {
    const html = renderSite(buildSiteModel({ targets: [target], observations: [obs()], runs: [] }), 'now');
    assert.match(html, /42 ms/);
    assert.match(html, /40–55 ms/);
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

  test('is a complete, self-contained document with no external requests', () => {
    const html = renderSite(buildSiteModel({ targets: [target], observations: [obs()], runs: [] }), 'now');
    assert.match(html, /^<!doctype html>/);
    assert.match(html, /<\/html>\s*$/);
    assert.doesNotMatch(html, /<script/i);
    assert.doesNotMatch(html, /https?:\/\/(?!a\.gov|github\.com)/);
  });

  test('uses table semantics a screen reader can navigate', () => {
    const html = renderSite(buildSiteModel({ targets: [target], observations: [obs()], runs: [] }), 'now');
    assert.match(html, /<th scope="col">/);
    assert.match(html, /<th scope="row">/);
    assert.match(html, /<caption>/);
  });
});
