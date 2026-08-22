import type { LookupFunction } from 'node:net';
import type { Latency, Outcome } from '../record/types.js';
import type { RateLimiter } from '../politeness/rate-limiter.js';
import { performCheck } from './check.js';
import { pinnedLookup, ResolutionCache } from './resolve.js';

export interface SampleOptions {
  samples: number;
  timeoutMs: number;
  maxRedirects: number;
  limiter: RateLimiter;
  lookup?: LookupFunction;
  /** Resolves and pins each request's backend. Shared across a run. */
  backends?: ResolutionCache;
}

export interface SampleResult {
  outcome: Outcome;
  statusCode?: number;
  latency: Latency;
  redirectChain: string[];
  finalUrl: string;
  /** The backend the first request was sent to, when one was established. */
  address?: string;
  /**
   * UTC moment the limiter released the first sample — when the check ran.
   *
   * Comes from the limiter rather than a fresh clock read so the timestamp the
   * record publishes is the same instant the spacing arithmetic used.
   */
  requestedAt: string;
}

/**
 * Takes a slot for one request and says where to send it.
 *
 * Resolution and rate limiting are deliberately the same step. Keying the
 * limiter on an address we then failed to connect to would leave the record
 * asserting a guarantee about a machine we never contacted, so the address that
 * was accounted for is the address the socket is pinned to (FR-140).
 *
 * An unresolvable host yields no address and no pin. The name-keyed limits still
 * applied, and the record simply does not claim to know where the request went
 * (FR-121).
 */
async function acquireHop(
  url: string,
  options: SampleOptions,
  contacted: Set<string>,
): Promise<{ grantedAt: number; address?: string; lookup?: LookupFunction }> {
  const host = new URL(url).hostname;
  const backend = (await options.backends?.get(host)) ?? {};
  // A hop to a host not yet touched by this check is a first contact and pays
  // everything. A hop back to one already contacted pays the backend budget only.
  const continuing = contacted.has(host);
  contacted.add(host);
  const grantedAt = continuing
    ? await options.limiter.acquireContinuation(host, backend.address)
    : await options.limiter.acquire(host, backend.address);

  if (backend.address === undefined || backend.family === undefined) return { grantedAt };
  // A caller-supplied lookup is a test seam and outranks the pin, which is how a
  // DNS failure can be exercised without leaving the machine.
  return {
    grantedAt,
    address: backend.address,
    lookup: options.lookup ?? pinnedLookup(backend.address, backend.family),
  };
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
  const timings: number[] = [];
  let last: Awaited<ReturnType<typeof performCheck>> | undefined;
  let requestedAt: string | undefined;
  let address: string | undefined;

  for (let i = 0; i < options.samples; i++) {
    // Reset per sample, not per call. A redirect hop back to a host is one visit
    // continuing; a second *sample* is a second independent reading and pays the
    // full interval. Hoisting this out of the loop silently turns every sample
    // after the first into a continuation, which is a burst wearing the costume
    // of an optimisation.
    const contacted = new Set<string>();
    const result = await performCheck(url, {
      timeoutMs: options.timeoutMs,
      maxRedirects: options.maxRedirects,
      ...(options.lookup ? { lookup: options.lookup } : {}),
      acquire: async (hopUrl) => {
        const grant = await acquireHop(hopUrl, options, contacted);
        // The first hop is the one the record timestamps and names a backend for.
        requestedAt ??= new Date(grant.grantedAt).toISOString();
        address ??= grant.address;
        return grant.lookup !== undefined
          ? { grantedAt: grant.grantedAt, lookup: grant.lookup }
          : { grantedAt: grant.grantedAt };
      },
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
    ...(address !== undefined ? { address } : {}),
    ...(last.statusCode !== undefined ? { statusCode: last.statusCode } : {}),
    latency,
    redirectChain: last.redirectChain,
    finalUrl: last.finalUrl,
    requestedAt,
  };
}
