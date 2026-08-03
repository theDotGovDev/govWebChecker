import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { RateLimiter } from '../../src/politeness/rate-limiter.js';

const HOST_INTERVAL_MS = 120;
const DOMAIN_INTERVAL_MS = 1;

describe('per-host rate limiting', () => {
  test('separates consecutive requests to one host by the minimum interval', async () => {
    const limiter = new RateLimiter({
      hostIntervalMs: HOST_INTERVAL_MS,
      domainIntervalMs: DOMAIN_INTERVAL_MS,
    });
    const stamps: number[] = [];

    for (let i = 0; i < 3; i++) {
      await limiter.acquire('www.irs.gov');
      stamps.push(Date.now());
    }

    const gaps = stamps.slice(1).map((t, i) => t - stamps[i]!);
    for (const gap of gaps) {
      // The assertion the constitution requires: reduce the enforced interval
      // and this fails. It is the same evidence an outside reader checks from
      // the published record (SC-002).
      assert.ok(
        gap >= HOST_INTERVAL_MS,
        `gap ${gap}ms is below the ${HOST_INTERVAL_MS}ms per-host minimum`,
      );
    }
  });

  test('does not delay the first request to a host', async () => {
    const limiter = new RateLimiter({
      hostIntervalMs: 5_000,
      domainIntervalMs: DOMAIN_INTERVAL_MS,
    });
    const started = Date.now();
    await limiter.acquire('first.example.gov');
    assert.ok(Date.now() - started < 1_000, 'the first request must not wait');
  });

  test('never runs two requests to one host concurrently', async () => {
    const limiter = new RateLimiter({
      hostIntervalMs: HOST_INTERVAL_MS,
      domainIntervalMs: DOMAIN_INTERVAL_MS,
    });
    const order: string[] = [];

    await Promise.all(
      [1, 2, 3].map(async (n) => {
        await limiter.acquire('www.irs.gov');
        order.push(`start-${n}`);
        await new Promise((r) => setTimeout(r, 10));
        order.push(`end-${n}`);
      }),
    );

    // Every start must be followed by its own end before the next start.
    for (let i = 0; i < order.length; i += 2) {
      const start = order[i]!;
      const end = order[i + 1]!;
      assert.equal(
        start.replace('start-', ''),
        end.replace('end-', ''),
        `interleaved requests to one host: ${order.join(', ')}`,
      );
    }
  });

  test('different hosts are not blocked by each other', async () => {
    const limiter = new RateLimiter({
      hostIntervalMs: 5_000,
      domainIntervalMs: DOMAIN_INTERVAL_MS,
    });
    const started = Date.now();
    await limiter.acquire('a.example.gov');
    await limiter.acquire('b.other.gov');
    assert.ok(Date.now() - started < 1_000, 'unrelated hosts must not serialize');
  });
});
