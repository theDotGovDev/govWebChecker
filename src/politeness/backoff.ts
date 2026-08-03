export interface BackoffInput {
  baseMs: number;
  maxMs: number;
  consecutiveFailures: number;
}

/**
 * How long to wait before checking a target again.
 *
 * The invariant that matters (FR-006, Principle III): the answer is never below
 * `baseMs`. A struggling site receives less traffic from us, never more — so this
 * only ever grows, and recovery returns to the normal cadence rather than
 * tightening past it to "catch up".
 */
export function nextDelayMs({ baseMs, maxMs, consecutiveFailures }: BackoffInput): number {
  if (consecutiveFailures <= 0) return baseMs;
  const grown = baseMs * 2 ** consecutiveFailures;
  return Math.min(grown, maxMs);
}
