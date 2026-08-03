import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildSiteModel } from '../../src/site/model.js';
import type { Observation } from '../../src/record/types.js';
import type { Target } from '../../src/targets/load.js';

function target(id: string, host: string, agency = 'Test Agency'): Target {
  return {
    id,
    host,
    url: `https://${host}/`,
    agency,
    jurisdiction: 'federal',
    inclusion_reason: 'Rank 1 among federal sites by measured visits',
    traffic_evidence: { source: 'test', measure: 'visits', visits: 100 },
    active: true,
  };
}

function observation(overrides: Partial<Observation> = {}): Observation {
  return {
    schema: '1',
    run_id: 'run-1',
    target_id: 'a',
    host: 'a.gov',
    url: 'https://a.gov/',
    dimension: 'availability',
    checked_at: '2026-08-03T12:00:00Z',
    outcome: 'success',
    status_code: 200,
    redirect_chain: [],
    latency: { samples: 3, median_ms: 100, min_ms: 90, max_ms: 120 },
    method: {
      vantage: 'github-actions/Linux',
      timeout_ms: 15_000,
      sample_count: 3,
      tool_version: '0.1.0',
      source: 'self_run',
    },
    ...overrides,
  };
}

describe('site model', () => {
  test('pairs each target with its most recent observation', () => {
    const model = buildSiteModel({
      targets: [target('a', 'a.gov')],
      observations: [
        observation({ checked_at: '2026-08-01T12:00:00Z', latency: { samples: 1, median_ms: 500, min_ms: 500, max_ms: 500 } }),
        observation({ checked_at: '2026-08-03T12:00:00Z' }),
      ],
      runs: [],
    });
    assert.equal(model.sites.length, 1);
    assert.equal(model.sites[0]!.latest?.checked_at, '2026-08-03T12:00:00Z');
    assert.equal(model.sites[0]!.latest?.median_ms, 100);
  });

  test('a target with no observations reads as no data, never as zero', () => {
    const model = buildSiteModel({ targets: [target('a', 'a.gov')], observations: [], runs: [] });
    assert.equal(model.sites[0]!.latest, undefined);
    assert.equal(model.sites[0]!.observationCount, 0);
  });

  test('reports the outcome verbatim rather than collapsing to up or down', () => {
    const model = buildSiteModel({
      targets: [target('a', 'a.gov')],
      observations: [observation({ outcome: 'blocked', status_code: 403, latency: { samples: 0 } })],
      runs: [],
    });
    assert.equal(model.sites[0]!.latest!.outcome, 'blocked');
    assert.equal(model.sites[0]!.latest!.median_ms, undefined);
  });

  test('carries the method for every figure it exposes (Principle V)', () => {
    const model = buildSiteModel({
      targets: [target('a', 'a.gov')],
      observations: [observation()],
      runs: [],
    });
    const latest = model.sites[0]!.latest!;
    assert.equal(latest.vantage, 'github-actions/Linux');
    assert.equal(latest.samples, 3);
    assert.equal(latest.min_ms, 90);
    assert.equal(latest.max_ms, 120);
  });

  test('counts observations per site so a reader can judge the sample', () => {
    const model = buildSiteModel({
      targets: [target('a', 'a.gov')],
      observations: [observation(), observation({ checked_at: '2026-08-02T12:00:00Z' })],
      runs: [],
    });
    assert.equal(model.sites[0]!.observationCount, 2);
  });

  test('excludes observations from runs where nothing succeeded', () => {
    // A run that produced no successes is more likely our network than every
    // site at once (FR-024). Showing its rows as site behavior would repeat the
    // exact misattribution that marker exists to prevent.
    const model = buildSiteModel({
      targets: [target('a', 'a.gov')],
      observations: [observation({ run_id: 'bad', outcome: 'blocked', latency: { samples: 0 } })],
      runs: [
        {
          run_id: 'bad',
          started_at: '2026-08-03T12:00:00Z',
          finished_at: '2026-08-03T12:01:00Z',
          targets_attempted: 1,
          targets_succeeded: 0,
          all_targets_failed: true,
          vantage: 'x',
        },
      ],
    });
    assert.equal(model.sites[0]!.latest, undefined, 'a discounted run must not become site data');
    assert.equal(model.discardedRuns, 1);
  });

  test('sorts sites by traffic, the basis on which they were selected', () => {
    const a = target('a', 'a.gov');
    const b = { ...target('b', 'b.gov'), traffic_evidence: { source: 't', measure: 'v', visits: 999 } };
    const model = buildSiteModel({ targets: [a, b], observations: [], runs: [] });
    assert.deepEqual(model.sites.map((s) => s.id), ['b', 'a']);
  });

  test('summarises coverage honestly', () => {
    const model = buildSiteModel({
      targets: [target('a', 'a.gov'), target('b', 'b.gov')],
      observations: [observation({ target_id: 'a' })],
      runs: [],
    });
    assert.equal(model.summary.targets, 2);
    assert.equal(model.summary.withData, 1);
    assert.equal(model.summary.withoutData, 1);
  });

  test('reports the measurement window from the data, not from a clock', () => {
    const model = buildSiteModel({
      targets: [target('a', 'a.gov')],
      observations: [
        observation({ checked_at: '2026-08-01T00:00:00Z' }),
        observation({ checked_at: '2026-08-03T12:00:00Z' }),
      ],
      runs: [],
    });
    assert.equal(model.summary.firstObserved, '2026-08-01T00:00:00Z');
    assert.equal(model.summary.lastObserved, '2026-08-03T12:00:00Z');
  });

  test('an empty record produces an empty model rather than throwing', () => {
    const model = buildSiteModel({ targets: [], observations: [], runs: [] });
    assert.equal(model.sites.length, 0);
    assert.equal(model.summary.firstObserved, undefined);
  });
});
