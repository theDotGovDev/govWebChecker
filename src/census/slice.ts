/**
 * Which slice of the rolling cycle a domain belongs to.
 *
 * The broad tier covers the whole frame over about a week, one seventh per run
 * (FR-111). FR-112 requires that assignment be deterministic and stable per
 * domain, and FR-113 that it degrade gracefully as the registry gains and loses
 * domains — so that coverage is provable rather than probabilistic.
 *
 * Hashing the *name* satisfies both outright: a domain's slice never changes, no
 * matter what else enters or leaves the registry. Nothing reshuffles, so there is
 * no cycle in which a domain is covered twice or missed.
 *
 * The obvious alternative — position in the sorted registry, modulo seven — fails
 * exactly here. Inserting one domain near the top shifts roughly six sevenths of
 * the frame into a different slice, producing double-coverage and gaps within a
 * single cycle. The failure is silent: the coverage count still looks healthy.
 *
 * That is why this function takes a domain and nothing else. There is no registry
 * to pass, so there is no registry it can accidentally depend on.
 */

/** One cycle, one week, one seventh per day. */
export const SLICES = 7;

/** FNV-1a. Not cryptographic — it needs to be stable and well spread, not secret. */
export function sliceOf(domain: string): number {
  const name = domain.toLowerCase().replace(/\.$/, '');
  let hash = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    hash ^= name.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % SLICES;
}

/**
 * The slice a run covers, from the day it runs on.
 *
 * Days since the Unix epoch rather than a day-of-week, so the cycle does not
 * silently restart at a week boundary and leave a slice uncovered when a month
 * or a year rolls over.
 */
export function sliceForDay(daysSinceEpoch: number): number {
  return ((Math.floor(daysSinceEpoch) % SLICES) + SLICES) % SLICES;
}

/** The slice for a moment in time, in UTC. */
export function sliceForDate(at: Date): number {
  return sliceForDay(at.getTime() / 86_400_000);
}

/**
 * The cycle an observation belongs to, as an ISO week.
 *
 * Coverage is asserted per cycle, so this is what a reader groups by when asking
 * whether the frame was covered.
 */
export function cycleOf(at: Date): string {
  const d = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  // ISO weeks belong to the year containing their Thursday.
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
