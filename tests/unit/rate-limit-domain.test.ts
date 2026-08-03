import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { RateLimiter } from '../../src/politeness/rate-limiter.js';

const DOMAIN_INTERVAL_MS = 120;

describe('per-registrable-domain rate limiting (FR-003a)', () => {
  test('separates requests to different hosts sharing one domain', async () => {
    const limiter = new RateLimiter({
      hostIntervalMs: 1,
      domainIntervalMs: DOMAIN_INTERVAL_MS,
    });
    const stamps: number[] = [];

    // Distinct hostnames, one agency. A per-host limiter alone lets these burst
    // against what is very likely a single backend — the hole FR-003a closes.
    for (const host of ['www.va.gov', 'benefits.va.gov', 'myhealth.va.gov']) {
      await limiter.acquire(host);
      stamps.push(Date.now());
    }

    const gaps = stamps.slice(1).map((t, i) => t - stamps[i]!);
    for (const gap of gaps) {
      assert.ok(
        gap >= DOMAIN_INTERVAL_MS,
        `gap ${gap}ms is below the ${DOMAIN_INTERVAL_MS}ms per-domain minimum; ` +
          'distinct hostnames of one agency commonly share a backend',
      );
    }
  });

  test('hosts on different domains are not serialized by the domain limiter', async () => {
    const limiter = new RateLimiter({ hostIntervalMs: 1, domainIntervalMs: 5_000 });
    const started = Date.now();
    await limiter.acquire('www.irs.gov');
    await limiter.acquire('www.va.gov');
    assert.ok(Date.now() - started < 1_000, 'unrelated domains must not serialize');
  });

  test('the stricter of the two limits governs', async () => {
    const limiter = new RateLimiter({ hostIntervalMs: 200, domainIntervalMs: 20 });
    const stamps: number[] = [];
    for (let i = 0; i < 2; i++) {
      await limiter.acquire('www.irs.gov');
      stamps.push(Date.now());
    }
    assert.ok(
      stamps[1]! - stamps[0]! >= 200,
      'same host twice must obey the per-host interval even when it exceeds the domain one',
    );
  });
});
