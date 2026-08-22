import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { RateLimiter } from '../../src/politeness/rate-limiter.js';

const ADDRESS_INTERVAL_MS = 120;

/**
 * The shared-hosting limit.
 *
 * `001`'s two limits key on the *name* used to reach a site. At census scale that
 * stops being enough: the `.gov` hosting survey (run 32548354070) found 531
 * distinct registrable domains answering on the single address 89.106.200.153,
 * and 4,320 domains — 30.2% of the frame — sitting in an address cluster large
 * enough to occupy every worker at once within one broad-tier slice.
 *
 * Neither the per-host nor the per-domain limit can see that, because every one
 * of those domains is a different name. Only a key on the backend actually
 * contacted can, which is what these tests hold in place.
 */
describe('per-address rate limiting (the shared-hosting gap)', () => {
  test('separates requests to distinct registrable domains sharing one backend', async () => {
    const limiter = new RateLimiter({
      hostIntervalMs: 1,
      domainIntervalMs: 1,
      addressIntervalMs: ADDRESS_INTERVAL_MS,
    });
    const stamps: number[] = [];

    // Three unrelated jurisdictions on one vendor's server. Both existing limits
    // are satisfied — different hosts, different registrable domains — and a
    // burst against that one machine is exactly what Principle I forbids.
    for (const host of ['aledoil.gov', 'abingtonpa.gov', 'altamontvillageny.gov']) {
      await limiter.acquire(host, '89.106.200.153');
      stamps.push(Date.now());
    }

    const gaps = stamps.slice(1).map((t, i) => t - stamps[i]!);
    for (const gap of gaps) {
      assert.ok(
        gap >= ADDRESS_INTERVAL_MS,
        `gap ${gap}ms is below the ${ADDRESS_INTERVAL_MS}ms per-address minimum; ` +
          'distinct .gov domains routinely share one vendor backend',
      );
    }
  });

  test('domains on different backends are not serialized by the address limiter', async () => {
    const limiter = new RateLimiter({
      hostIntervalMs: 1,
      domainIntervalMs: 1,
      addressIntervalMs: 5_000,
    });
    const started = Date.now();
    await limiter.acquire('aledoil.gov', '89.106.200.153');
    await limiter.acquire('alamosa.gov', '52.32.196.230');
    assert.ok(
      Date.now() - started < 1_000,
      'unrelated backends must not serialize — politeness is per server, not per run',
    );
  });

  test('a host with no known address still obeys the name-keyed limits', async () => {
    // Resolution can fail, and when it does the record must not claim we knew
    // where the request went (FR-121). The limiter must not fail open either.
    const limiter = new RateLimiter({
      hostIntervalMs: 120,
      domainIntervalMs: 1,
      addressIntervalMs: 1,
    });
    const stamps: number[] = [];
    for (let i = 0; i < 2; i++) {
      await limiter.acquire('unresolvable.gov', undefined);
      stamps.push(Date.now());
    }
    assert.ok(
      stamps[1]! - stamps[0]! >= 120,
      'an unknown backend must not disable the per-host limit',
    );
  });

  test('the strictest of the three limits governs', async () => {
    const limiter = new RateLimiter({
      hostIntervalMs: 1,
      domainIntervalMs: 1,
      addressIntervalMs: 200,
    });
    const stamps: number[] = [];
    for (let i = 0; i < 2; i++) {
      await limiter.acquire('aledoil.gov', '89.106.200.153');
      stamps.push(Date.now());
    }
    assert.ok(
      stamps[1]! - stamps[0]! >= 200,
      'the address limit must govern when it exceeds the host and domain ones',
    );
  });

  test('an address key cannot be spoofed by a hostname that looks like one', async () => {
    // The keys share one map. A target literally named "89.106.200.153" must not
    // consume the budget of the backend at that address, or a target list could
    // starve an unrelated server.
    const limiter = new RateLimiter({
      hostIntervalMs: 1,
      domainIntervalMs: 1,
      addressIntervalMs: 5_000,
    });
    const started = Date.now();
    await limiter.acquire('89.106.200.153');
    await limiter.acquire('aledoil.gov', '89.106.200.153');
    assert.ok(
      Date.now() - started < 1_000,
      'a hostname must not collide with the address namespace',
    );
  });
});
