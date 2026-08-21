import type { LookupFunction } from 'node:net';
import type { Latency, Outcome } from '../record/types.js';
import type { RateLimiter } from '../politeness/rate-limiter.js';
import { performCheck } from './check.js';

export interface SampleOptions {
  samples: number;
  timeoutMs: number;
  maxRedirects: number;
  limiter: RateLimiter;
  lookup?: LookupFunction;
}

export interface SampleResult {
  outcome: Outcome;
  statusCode?: number;
  latency: Latency;
  redirectChain: string[];
  finalUrl: string;
  /**
   * UTC moment the limiter released the first sample — when the check ran.
   *
   * Comes from the limiter rather than a fresh clock read so the timestamp the
   * record publishes is the same instant the spacing arithmetic used.
   */
  requestedAt: string;
}

/**
 * Median rather than mean.
 *
 * Latency distributions are right-skewed, and a single slow reading from a noisy
 * shared runner would drag a mean while leaving a median intact (research.md R5).
 */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1]! + sorted[middle]!) / 2)
    : sorted[middle]!;
}

/**
 * Checks one target several times and summarizes the timings.
 *
 * Every sample passes through the rate limiter, so taking more of them buys
 * statistical confidence without ever bursting at the target (FR-011b). The
 * outcome reported is that of the last sample; the timings summarize only the
 * samples that actually produced one.
 */
export async function sampleTarget(url: string, options: SampleOptions): Promise<SampleResult> {
  const host = new URL(url).hostname;
  const timings: number[] = [];
  let last: Awaited<ReturnType<typeof performCheck>> | undefined;
  let requestedAt: string | undefined;

  for (let i = 0; i < options.samples; i++) {
    const granted = await options.limiter.acquire(host);
    requestedAt ??= new Date(granted).toISOString();
    const result = await performCheck(url, {
      timeoutMs: options.timeoutMs,
      maxRedirects: options.maxRedirects,
      ...(options.lookup ? { lookup: options.lookup } : {}),
    });
    last = result;
    if (typeof result.elapsedMs === 'number') timings.push(result.elapsedMs);
  }

  if (!last || requestedAt === undefined) {
    throw new Error('sampleTarget requires at least one sample');
  }

  // No successful timing means no latency figure at all. A zero here would read
  // as "instant" to anyone scanning the record — absence must look like absence
  // (Principle V).
  const latency: Latency =
    timings.length === 0
      ? { samples: 0 }
      : {
          samples: timings.length,
          median_ms: median(timings),
          min_ms: Math.min(...timings),
          max_ms: Math.max(...timings),
        };

  return {
    outcome: last.outcome,
    ...(last.statusCode !== undefined ? { statusCode: last.statusCode } : {}),
    latency,
    redirectChain: last.redirectChain,
    finalUrl: last.finalUrl,
    requestedAt,
  };
}
