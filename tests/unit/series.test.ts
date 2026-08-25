import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { censusSeries, type CensusRunSummary } from '../../src/site/series.js';
import type { Observation } from '../../src/record/types.js';

function row(cycle: string, domain: string, slice: number, state: 'website' | 'no_website' | 'undetermined'): Observation {
  return {
    schema: '1',
    run_id: `run-${cycle}-${slice}`,
    target_id: domain,
    host: domain,
    url: `https://${domain}/`,
    dimension: 'availability',
    checked_at: '2026-08-22T09:00:00Z',
    outcome: state === 'website' ? 'success' : 'skipped',
    redirect_chain: [],
    latency: { samples: state === 'website' ? 1 : 0, ...(state === 'website' ? { median_ms: 100, min_ms: 100, max_ms: 100 } : {}) },
    tier: 'broad',
    cycle,
    slice,
    presence: { state, rule: 'presence/1' },
    method: { vantage: 'github-actions/test', timeout_ms: 15_000, sample_count: 1, tool_version: '0.1.0', source: 'self_run' },
  } as Observation;
}

function summary(cycle: string, slice: number, digest = 'sha256:frame-a'): CensusRunSummary {
  return { tier: 'broad', cycle, slice, frame_digest: digest, frame_size: 16535, slice_size: 2300 };
}

/**
 * A census series is discrete: one mark per cycle, nothing between them. A line
 * between two weekly readings asserts knowledge of the six days in between,
 * which is absence rendered as data (FR-230, Principle V).
 */
describe('the census series is cadence-aware (FR-230, FR-231)', () => {
  test('one mark per cycle, completeness computed from run summaries, not row counts', () => {
    const rows = [
      row('2026-W34', 'a.gov', 0, 'website'),
      row('2026-W34', 'b.gov', 1, 'no_website'),
      row('2026-W35', 'c.gov', 4, 'website'),
    ];
    const runs = [
      summary('2026-W34', 0), summary('2026-W34', 1), summary('2026-W34', 2),
      summary('2026-W34', 3), summary('2026-W34', 4), summary('2026-W34', 5),
      summary('2026-W34', 6),
      summary('2026-W35', 4),
    ];
    const series = censusSeries(rows, runs, 7);
    assert.equal(series.cadence, 'discrete');
    assert.equal(series.marks.length, 2);

    const [w34, w35] = series.marks;
    assert.equal(w34!.cycle, '2026-W34');
    assert.equal(w34!.complete, true, 'seven slice summaries against one digest is a complete cycle');
    assert.equal(w34!.slicesRan, 7);
    assert.equal(w35!.complete, false);
    assert.equal(w35!.slicesRan, 1);
    assert.equal(w35!.slicesInFrame, 7);
  });

  test('slices against two different frame digests do not sum to a complete cycle', () => {
    // Seven slices are a cycle only when they swept ONE frame. Four against one
    // digest and three against another covered neither frame completely, and
    // calling that complete would hide a mid-cycle frame change (FR-115 logic,
    // applied at presentation).
    const rows = [row('2026-W34', 'a.gov', 0, 'website')];
    const runs = [0, 1, 2, 3].map((s) => summary('2026-W34', s, 'sha256:frame-a'))
      .concat([4, 5, 6].map((s) => summary('2026-W34', s, 'sha256:frame-b')));
    const series = censusSeries(rows, runs, 7);
    assert.equal(series.marks[0]!.complete, false);
    assert.equal(series.marks[0]!.frameChanged, true, 'the frame change must be disclosable (FR-232)');
  });

  test('a duplicate slice run does not inflate completeness', () => {
    const rows = [row('2026-W34', 'a.gov', 0, 'website')];
    const runs = [summary('2026-W34', 0), summary('2026-W34', 0), summary('2026-W34', 1)];
    const series = censusSeries(rows, runs, 7);
    assert.equal(series.marks[0]!.slicesRan, 2, 'slice 0 ran twice; that is still two distinct slices of seven');
  });

  test('a cycle mark carries its presence figures with the shared denominator', () => {
    const rows = [
      row('2026-W34', 'a.gov', 0, 'website'),
      row('2026-W34', 'b.gov', 0, 'undetermined'),
    ];
    const series = censusSeries(rows, [summary('2026-W34', 0)], 7);
    const mark = series.marks[0]!;
    assert.equal(mark.presence.website.value, 1);
    assert.equal(mark.presence.undetermined.value, 1);
    assert.equal(mark.presence.website.population, 2, 'one denominator for the three states');
    assert.equal(mark.presence.website.rule, 'presence/1');
  });
});
