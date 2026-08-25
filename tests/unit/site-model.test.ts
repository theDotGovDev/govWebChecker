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

  test('aggregates response time across observations, not within one check', () => {
    // At hourly cadence each observation is a single reading. A site's response
    // time is the median of the series; showing the newest reading alone would
    // present noise as a measurement (FR-011a).
    const model = buildSiteModel({
      targets: [target('a', 'a.gov')],
      observations: [
        observation({ checked_at: '2026-08-03T10:00:00Z', latency: { samples: 1, median_ms: 100, min_ms: 100, max_ms: 100 } }),
        observation({ checked_at: '2026-08-03T11:00:00Z', latency: { samples: 1, median_ms: 900, min_ms: 900, max_ms: 900 } }),
        observation({ checked_at: '2026-08-03T12:00:00Z', latency: { samples: 1, median_ms: 200, min_ms: 200, max_ms: 200 } }),
      ],
      runs: [],
    });
    const typical = model.sites[0]!.typical!;
    assert.equal(typical.median.value, 200, 'the outlier must not drag the figure');
    assert.equal(typical.median.samples, 3, 'the count it was computed from travels with it');
  });

  test('a lone reading yields no typical figure', () => {
    const model = buildSiteModel({
      targets: [target('a', 'a.gov')],
      observations: [observation()],
      runs: [],
    });
    assert.equal(model.sites[0]!.typical, undefined, 'one reading is not a response time');
  });

  test('counts how often a site responded, as a reliability signal', () => {
    const model = buildSiteModel({
      targets: [target('a', 'a.gov')],
      observations: [
        observation({ checked_at: '2026-08-03T10:00:00Z', outcome: 'success' }),
        observation({ checked_at: '2026-08-03T11:00:00Z', outcome: 'timeout', latency: { samples: 0 } }),
        observation({ checked_at: '2026-08-03T12:00:00Z', outcome: 'success' }),
        observation({ checked_at: '2026-08-03T13:00:00Z', outcome: 'success' }),
      ],
      runs: [],
    });
    assert.equal(model.sites[0]!.responded, 3);
    assert.equal(model.sites[0]!.observationCount, 4);
  });

  test('failed observations contribute to the count but not to the timing', () => {
    const model = buildSiteModel({
      targets: [target('a', 'a.gov')],
      observations: [
        observation({ checked_at: '2026-08-03T10:00:00Z', latency: { samples: 1, median_ms: 100, min_ms: 100, max_ms: 100 } }),
        observation({ checked_at: '2026-08-03T11:00:00Z', outcome: 'timeout', latency: { samples: 0 } }),
        observation({ checked_at: '2026-08-03T12:00:00Z', latency: { samples: 1, median_ms: 300, min_ms: 300, max_ms: 300 } }),
      ],
      runs: [],
    });
    assert.equal(model.sites[0]!.typical!.median.samples, 2, 'a timeout is not a slow reading');
  });

  test('an empty record produces an empty model rather than throwing', () => {
    const model = buildSiteModel({ targets: [], observations: [], runs: [] });
    assert.equal(model.sites.length, 0);
    assert.equal(model.summary.firstObserved, undefined);
  });
});

/**
 * User Story 4: aggregate figures must not be misread across tiers.
 *
 * The broad tier has a far higher failure and absence rate than 58 curated
 * federal hosts — not because government websites got worse, but because the
 * population is different. Anyone computing an ecosystem-level figure has to be
 * able to see that, and a wrong headline about US government is hard to retract.
 */
describe('per-tier figures (FR-139, SC-107)', () => {
  const rows = [
    observation({ target_id: 'a', tier: 'hot', outcome: 'success' }),
    observation({ target_id: 'b', tier: 'hot', outcome: 'timeout', latency: { samples: 0 } }),
    observation({
      target_id: 'alamosa.gov',
      tier: 'broad',
      cycle: '2026-W34',
      slice: 3,
      outcome: 'success',
      resolution: { status: 'address', apex: true, www: true },
      presence: { state: 'website', rule: 'presence/1' },
    }),
    observation({
      target_id: 'mailonly.gov',
      tier: 'broad',
      cycle: '2026-W34',
      slice: 3,
      outcome: 'dns_failure',
      latency: { samples: 0 },
      resolution: { status: 'mail_only', apex: false, www: false },
      presence: { state: 'no_website', rule: 'presence/1' },
    }),
    observation({
      target_id: 'unreachable.gov',
      tier: 'broad',
      cycle: '2026-W34',
      slice: 3,
      outcome: 'dns_failure',
      latency: { samples: 0 },
      resolution: { status: 'resolver_error', apex: false, www: false },
      presence: { state: 'undetermined', rule: 'presence/1' },
    }),
  ];

  test('computes a figure per tier from rows alone, consulting no target list', () => {
    // The target list is passed empty on purpose. A per-tier figure that needed
    // it would break the moment the list changed, which is exactly what FR-139
    // forbids — and target lists change constantly.
    const model = buildSiteModel({ targets: [], observations: rows, runs: [] });
    const hot = model.tiers.find((t) => t.tier === 'hot')!;
    const broad = model.tiers.find((t) => t.tier === 'broad')!;
    assert.equal(hot.observations, 2);
    assert.equal(broad.observations, 3);
    assert.equal(hot.responded, 1);
    assert.equal(broad.responded, 1);
  });

  test('a broad-tier figure separates absence from failure', () => {
    // Reporting 2 of 3 broad-tier domains as failing would be false: one of them
    // never published a website, and one we could not resolve. Only the first is
    // a statement about the jurisdiction at all.
    const model = buildSiteModel({ targets: [], observations: rows, runs: [] });
    const broad = model.tiers.find((t) => t.tier === 'broad')!;
    assert.equal(broad.presence.website, 1);
    assert.equal(broad.presence.no_website, 1);
    assert.equal(broad.presence.undetermined, 1);
  });

  test('never publishes a single combined availability figure', () => {
    // SC-107. The model has no field a caller could mistake for "availability
    // across all of .gov". Anything that reads like one has to be built by the
    // caller from per-tier parts, which is a decision they take visibly.
    const model = buildSiteModel({ targets: [], observations: rows, runs: [] });
    const keys = Object.keys(model.summary);
    for (const forbidden of ['availability', 'uptime', 'combined', 'overall']) {
      assert.ok(
        !keys.some((k) => k.toLowerCase().includes(forbidden)),
        `summary.${forbidden} would be a figure that silently mixes populations`,
      );
    }
  });

  test('every tier figure states the population it covers', () => {
    const model = buildSiteModel({ targets: [], observations: rows, runs: [] });
    for (const tier of model.tiers) {
      assert.ok(tier.population.length > 0, `${tier.tier} must state its population`);
      assert.equal(typeof tier.domains, 'number');
    }
  });

  test('rows predating tiers are attributed rather than silently dropped', () => {
    // The record is append-only and full of rows written before `tier` existed.
    // Dropping them would understate history; guessing their tier would invent
    // provenance. They are counted as untiered and named as such.
    const model = buildSiteModel({
      targets: [],
      observations: [observation({ target_id: 'old' })],
      runs: [],
    });
    const untiered = model.tiers.find((t) => t.tier === 'untiered');
    assert.ok(untiered, 'pre-tier rows must appear somewhere a reader can see them');
    assert.equal(untiered.observations, 1);
  });

  test('census coverage is reported per cycle from the rows', () => {
    const model = buildSiteModel({ targets: [], observations: rows, runs: [] });
    const cycle = model.census?.cycles.find((c) => c.cycle === '2026-W34');
    assert.ok(cycle, 'a census cycle must be visible');
    assert.equal(cycle.domains, 3);
  });
});
