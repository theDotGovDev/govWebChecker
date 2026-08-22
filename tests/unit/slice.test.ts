import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sliceOf, SLICES, sliceForDay } from '../../src/census/slice.js';

/**
 * Coverage has to be provable, not probabilistic.
 *
 * FR-112 and FR-113 turn on one property: a domain's slice must not move when the
 * registry gains or loses domains. The obvious implementation — position in the
 * sorted registry, modulo seven — fails exactly there. Inserting a single domain
 * near the top shifts roughly six sevenths of the frame into a different slice,
 * which within one cycle produces both double-coverage and gaps. The failure is
 * silent: the coverage count still looks healthy.
 *
 * Hashing the name instead makes the property structural rather than something to
 * be careful about.
 */
describe('slice assignment', () => {
  test('is deterministic for a domain', () => {
    const first = sliceOf('alamosa.gov');
    for (let i = 0; i < 10; i++) assert.equal(sliceOf('alamosa.gov'), first);
  });

  test('does not depend on what else is in the registry', () => {
    // The property the whole design rests on. There is no registry argument to
    // pass, which is the point — the function cannot depend on something it
    // cannot see.
    assert.equal(sliceOf.length, 1, 'slice must be a function of the domain alone');
  });

  test('lands every domain in exactly one of seven slices', () => {
    const domains = Array.from({ length: 5_000 }, (_, i) => `city${i}.gov`);
    for (const d of domains) {
      const s = sliceOf(d);
      assert.ok(Number.isInteger(s) && s >= 0 && s < SLICES, `${d} -> ${s}`);
    }
  });

  test('partitions a frame — the seven slices union to it, and do not overlap', () => {
    const domains = Array.from({ length: 5_000 }, (_, i) => `city${i}.gov`);
    const buckets = new Map<number, Set<string>>();
    for (const d of domains) {
      const s = sliceOf(d);
      if (!buckets.has(s)) buckets.set(s, new Set());
      buckets.get(s)!.add(d);
    }
    const total = [...buckets.values()].reduce((a, b) => a + b.size, 0);
    assert.equal(total, domains.length, 'every domain covered exactly once');

    const seen = new Set<string>();
    for (const bucket of buckets.values()) {
      for (const d of bucket) {
        assert.ok(!seen.has(d), `${d} appears in more than one slice`);
        seen.add(d);
      }
    }
  });

  test('spreads the frame across slices rather than piling it into one', () => {
    // Slices are work units, not statistical strata, so perfect balance is not
    // required. A grossly lopsided split would still mean one run doing most of
    // the census, which is a traffic problem rather than a statistical one.
    const domains = Array.from({ length: 14_000 }, (_, i) => `city${i}.gov`);
    const counts = new Array(SLICES).fill(0);
    for (const d of domains) counts[sliceOf(d)]!++;
    const expected = domains.length / SLICES;
    for (const [i, n] of counts.entries()) {
      assert.ok(
        n > expected * 0.8 && n < expected * 1.2,
        `slice ${i} holds ${n}, expected near ${expected}`,
      );
    }
  });

  test('a case difference or trailing dot is the same domain', () => {
    assert.equal(sliceOf('Alamosa.GOV'), sliceOf('alamosa.gov'));
    assert.equal(sliceOf('alamosa.gov.'), sliceOf('alamosa.gov'));
  });
});

describe('which slice a run covers', () => {
  test('advances by one each day and wraps after seven', () => {
    const day = Date.UTC(2026, 7, 22) / 86_400_000;
    const week = Array.from({ length: SLICES }, (_, i) => sliceForDay(day + i));
    assert.deepEqual([...new Set(week)].sort(), [0, 1, 2, 3, 4, 5, 6]);
    assert.equal(sliceForDay(day + SLICES), sliceForDay(day), 'wraps after a full cycle');
  });
});
