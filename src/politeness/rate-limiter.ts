import { registrableDomain } from './domain.js';

export interface RateLimiterOptions {
  /** Minimum gap between requests to one hostname. */
  hostIntervalMs: number;
  /** Minimum gap between requests to any hostname sharing a registrable domain. */
  domainIntervalMs: number;
  /** Minimum gap between requests to one backend address, whatever name reached it. */
  addressIntervalMs: number;
}

/**
 * Enforces the traffic limits the constitution requires to be structural.
 *
 * Three independent limits apply, and the strictest one governs:
 *
 * - **per host**, so one site is never hit faster than the configured cadence;
 * - **per registrable domain**, because distinct hostnames of one agency commonly
 *   resolve to a single backend. A per-host limit alone permits a burst against
 *   one machine that satisfies every stated rule (FR-003a);
 * - **per backend address**, because at census scale *distinct registrable
 *   domains* share a backend too. The `.gov` hosting survey (run 32548354070)
 *   found 531 unrelated domains answering on one address, and 30.2% of the
 *   registry in address clusters large enough to occupy every worker at once
 *   inside a single broad-tier slice. Both name-keyed limits are satisfied by
 *   such a burst, because every name involved is different — only a key on the
 *   machine actually contacted can see it (FR-140).
 *
 * The address is optional because resolution can fail. When it does the two
 * name-keyed limits still apply: an unknown backend must not mean an unlimited
 * one.
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
  readonly #addressIntervalMs: number;
  /** Namespaced key -> time the next request may proceed (`host:`/`domain:`/`addr:`). */
  readonly #nextFree = new Map<string, number>();
  /** Serializes acquisition so concurrent callers queue rather than race. */
  #tail: Promise<void> = Promise.resolve();

  constructor(options: RateLimiterOptions) {
    this.#hostIntervalMs = options.hostIntervalMs;
    this.#domainIntervalMs = options.domainIntervalMs;
    this.#addressIntervalMs = options.addressIntervalMs;
  }

  /**
   * Resolves with the epoch-millisecond moment this caller was granted.
   *
   * `address` is the backend the request will actually be sent to. Pass it
   * whenever it is known, and pin the connection to it — accounting for one
   * address while the socket reaches another would make the guarantee false on
   * the very record that publishes it.
   */
  async acquire(host: string, address?: string): Promise<number> {
    const mine = this.#tail.then(() => this.#waitForSlot(host, address));
    // Swallow here only so one rejected acquisition cannot poison the queue for
    // every later caller; `mine` still rejects for the caller that owns it.
    this.#tail = mine.then(
      () => undefined,
      () => undefined,
    );
    return mine;
  }

  async #waitForSlot(host: string, address?: string): Promise<number> {
    // Every key is namespaced, because the three key spaces overlap and a
    // collision silently downgrades a limit to the weakest one that shares its
    // string.
    //
    // `alamosa.gov` is its own registrable domain, so an unnamespaced map wrote
    // the host deadline and then overwrote it with the shorter domain one —
    // turning a 15s per-host floor into 5s. Four of the 58 federal targets hit
    // this today, and a census of apex domains would hit it on every target.
    const hostKey = `host:${host}`;
    const domainKey = `domain:${registrableDomain(host)}`;
    const addressKey = address === undefined ? undefined : `addr:${address}`;
    const now = Date.now();
    const readyAt = Math.max(
      this.#nextFree.get(hostKey) ?? now,
      this.#nextFree.get(domainKey) ?? now,
      addressKey === undefined ? now : (this.#nextFree.get(addressKey) ?? now),
    );

    // setTimeout may fire slightly early, so sleep until the clock actually says
    // we are clear rather than trusting one timer. Undershooting by even a
    // millisecond would make the guarantee in SC-002 false against our own
    // published record — `verify` reads the same timestamps a reader would.
    for (let remaining = readyAt - Date.now(); remaining > 0; remaining = readyAt - Date.now()) {
      await new Promise((resolve) => setTimeout(resolve, remaining));
    }

    const granted = Date.now();
    this.#nextFree.set(hostKey, granted + this.#hostIntervalMs + GUARD_MS);
    this.#nextFree.set(domainKey, granted + this.#domainIntervalMs + GUARD_MS);
    if (addressKey !== undefined) {
      this.#nextFree.set(addressKey, granted + this.#addressIntervalMs + GUARD_MS);
    }
    return granted;
  }
}
