import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { largestGapMs } from '../../src/site/model.js';

/**
 * The worst a single site went unmeasured.
 *
 * Per host, then the worst of them. Measuring over the pooled timeline instead
 * would be catastrophically wrong in the flattering direction: 58 sites are
 * checked together, so pooled readings land milliseconds apart and the worst gap
 * would come out near zero — a bursty sampler certifying itself as continuous.
 */
describe('the largest gap is measured per site, never over the pooled timeline', () => {
  const HOUR = 3_600_000;
  const at = (ms: number) => new Date(Date.parse('2026-08-27T00:00:00Z') + ms).toISOString();

  test('a run that checks every site together does not read as continuous coverage', () => {
    // Two runs, 40 hours apart, each touching three sites milliseconds apart.
    // Pooled, the largest gap is 40h but the *typical* one is ~0; per host every
    // gap is 40h. Only the per-host answer describes anyone's coverage.
    const rows = [];
    for (const [i, host] of ['a.gov', 'b.gov', 'c.gov'].entries()) {
      rows.push({ host, checked_at: at(i * 3) });
      rows.push({ host, checked_at: at(40 * HOUR + i * 3) });
    }
    const worst = largestGapMs(rows)!;
    assert.ok(
      Math.abs(worst - 40 * HOUR) < 1000,
      `expected ~40h per host, got ${(worst / HOUR).toFixed(2)}h — pooled timelines hide the gap`,
    );
  });

  test('the worst host governs, not the typical one', () => {
    const rows = [
      { host: 'steady.gov', checked_at: at(0) },
      { host: 'steady.gov', checked_at: at(HOUR) },
      { host: 'steady.gov', checked_at: at(2 * HOUR) },
      { host: 'neglected.gov', checked_at: at(0) },
      { host: 'neglected.gov', checked_at: at(30 * HOUR) },
    ];
    assert.equal(largestGapMs(rows), 30 * HOUR, 'one badly-served site is the finding');
  });

  test('one reading per site reports no gap rather than a gap of zero', () => {
    // Zero would say "measured continuously" about a site seen exactly once,
    // which is absence rendered as data (FR-204).
    const rows = [
      { host: 'a.gov', checked_at: at(0) },
      { host: 'b.gov', checked_at: at(5) },
    ];
    assert.equal(largestGapMs(rows), undefined);
  });

  test('an empty set has no gap', () => {
    assert.equal(largestGapMs([]), undefined);
  });

  test('rows arriving out of order are still spaced correctly', () => {
    // The record interleaves targets, so a host's rows are not guaranteed sorted
    // as they come out of the file.
    const rows = [
      { host: 'a.gov', checked_at: at(20 * HOUR) },
      { host: 'a.gov', checked_at: at(0) },
      { host: 'a.gov', checked_at: at(HOUR) },
    ];
    assert.equal(largestGapMs(rows), 19 * HOUR);
  });

  test('an unparseable timestamp is skipped, not read as the epoch', () => {
    const rows = [
      { host: 'a.gov', checked_at: at(0) },
      { host: 'a.gov', checked_at: 'not a date' },
      { host: 'a.gov', checked_at: at(2 * HOUR) },
    ];
    assert.equal(largestGapMs(rows), 2 * HOUR, 'a bad row must not invent a 56-year gap');
  });
});
