import { registrableDomain } from './domain.js';

export interface RateLimiterOptions {
  /** Minimum gap between requests to one hostname. */
  hostIntervalMs: number;
  /** Minimum gap between requests to any hostname sharing a registrable domain. */
  domainIntervalMs: number;
}

/**
 * Enforces the traffic limits the constitution requires to be structural.
 *
 * Two independent limits apply, and the stricter one governs:
 *
 * - **per host**, so one site is never hit faster than the configured cadence;
 * - **per registrable domain**, because distinct hostnames of one agency commonly
 *   resolve to a single backend. A per-host limit alone permits a burst against
 *   one machine that satisfies every stated rule (FR-003a).
 *
 * `acquire` also serializes: a second call for a host waits for the first to be
 * granted, so there is never more than one request in flight to a host (FR-003).
 * It resolves with the moment it granted, so a caller can record the time its
 * request was released rather than re-reading the clock later and drifting.
 *
 * There is no option to disable or shorten these at runtime. That is the point —
 * a limit a caller can turn off is a limit a caller will forget.
 */
/**
 * Enforced spacing exceeds the configured minimum by this margin.
 *
 * Callers record the grant moment `acquire` returns, so the gap between two
 * published timestamps is exactly the gap this limiter arithmetic produced and
 * the margin is not load-bearing. It is kept as headroom against clock
 * granularity, and it errs toward more spacing, never less — the only direction
 * Principle I permits us to err in.
 *
 * A margin is the wrong tool for drift between the grant and the timestamp. That
 * drift is unbounded — a robots.txt fetch sits in between — and a margin sized to
 * cover it would be a guess. Returning the grant moment removes the drift instead
 * of padding it.
 */
const GUARD_MS = 10;

export class RateLimiter {
  readonly #hostIntervalMs: number;
  readonly #domainIntervalMs: number;
  /** Key -> time the next request may proceed. Keys are hosts and domains. */
  readonly #nextFree = new Map<string, number>();
  /** Serializes acquisition so concurrent callers queue rather than race. */
  #tail: Promise<void> = Promise.resolve();

  constructor(options: RateLimiterOptions) {
    this.#hostIntervalMs = options.hostIntervalMs;
    this.#domainIntervalMs = options.domainIntervalMs;
  }

  /** Resolves with the epoch-millisecond moment this caller was granted. */
  async acquire(host: string): Promise<number> {
    const mine = this.#tail.then(() => this.#waitForSlot(host));
    // Swallow here only so one rejected acquisition cannot poison the queue for
    // every later caller; `mine` still rejects for the caller that owns it.
    this.#tail = mine.then(
      () => undefined,
      () => undefined,
    );
    return mine;
  }

  async #waitForSlot(host: string): Promise<number> {
    const domain = registrableDomain(host);
    const now = Date.now();
    const readyAt = Math.max(this.#nextFree.get(host) ?? now, this.#nextFree.get(domain) ?? now);

    // setTimeout may fire slightly early, so sleep until the clock actually says
    // we are clear rather than trusting one timer. Undershooting by even a
    // millisecond would make the guarantee in SC-002 false against our own
    // published record — `verify` reads the same timestamps a reader would.
    for (let remaining = readyAt - Date.now(); remaining > 0; remaining = readyAt - Date.now()) {
      await new Promise((resolve) => setTimeout(resolve, remaining));
    }

    const granted = Date.now();
    this.#nextFree.set(host, granted + this.#hostIntervalMs + GUARD_MS);
    this.#nextFree.set(domain, granted + this.#domainIntervalMs + GUARD_MS);
    return granted;
  }
}
