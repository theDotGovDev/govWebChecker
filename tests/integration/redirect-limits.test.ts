import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { performCheck } from '../../src/checker/check.js';
import { RateLimiter } from '../../src/politeness/rate-limiter.js';
import { fastServer } from '../fixtures/servers.js';

async function redirectTo(location: string): Promise<{ url: string; close(): Promise<void> }> {
  const server = http.createServer((_req, res) => {
    res.writeHead(302, { location });
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

/**
 * A redirect is a request, and it goes to whatever the redirect names.
 *
 * `performCheck` followed up to five hops without passing any of them through
 * the limiter, so a single check could send six requests while the record showed
 * the spacing of one. At 58 curated federal targets that was a small leak. At
 * census scale it is a hole straight through the shared-hosting limit, because a
 * municipal domain redirecting onto its vendor's host is one of the commonest
 * shapes in the registry — the hop that actually reaches the shared backend is
 * precisely the one that escaped accounting.
 */
describe('redirect hops pass through the rate limiter', () => {
  test('every hop is acquired, in order', async () => {
    const destination = await fastServer('arrived');
    const second = await redirectTo(destination.url);
    const first = await redirectTo(second.url);
    const acquired: string[] = [];

    try {
      const result = await performCheck(first.url, {
        timeoutMs: 2_000,
        maxRedirects: 5,
        acquire: async (url) => {
          acquired.push(url);
          return { grantedAt: Date.now() };
        },
      });

      assert.equal(result.outcome, 'success');
      assert.deepEqual(
        acquired,
        [first.url, second.url, destination.url],
        'each hop must be accounted for, including the one that reaches the backend',
      );
    } finally {
      await first.close();
      await second.close();
      await destination.close();
    }
  });

  test('hops to one backend are spaced by the limiter that governs it', async () => {
    const INTERVAL_MS = 150;
    const destination = await fastServer('arrived');
    const hop = await redirectTo(destination.url);
    // Both fixtures are on 127.0.0.1, so they share a backend address exactly as
    // a jurisdiction and its vendor's host do.
    const limiter = new RateLimiter({
      hostIntervalMs: 1,
      domainIntervalMs: 1,
      addressIntervalMs: INTERVAL_MS,
    });
    const grants: number[] = [];

    try {
      const started = Date.now();
      await performCheck(hop.url, {
        timeoutMs: 2_000,
        maxRedirects: 5,
        acquire: async (url) => {
          const grantedAt = await limiter.acquire(new URL(url).hostname, '127.0.0.1');
          grants.push(grantedAt);
          return { grantedAt };
        },
      });

      assert.equal(grants.length, 2, 'the redirect and its destination are two requests');
      assert.ok(
        grants[1]! - grants[0]! >= INTERVAL_MS,
        `hops were ${grants[1]! - grants[0]!}ms apart, below the ${INTERVAL_MS}ms backend minimum`,
      );
      assert.ok(Date.now() - started >= INTERVAL_MS, 'the check must actually have waited');
    } finally {
      await hop.close();
      await destination.close();
    }
  });

  test('reports the grant moment of the first request as when the check ran', async () => {
    // The published timestamp has to be the instant the limiter released the
    // first request. Re-reading the clock later drifts below the spacing the
    // limiter enforced, which is how a previous timing bug made `verify` reject
    // roughly 80% of otherwise good runs.
    const destination = await fastServer('arrived');
    const hop = await redirectTo(destination.url);
    try {
      const grants: number[] = [];
      const result = await performCheck(hop.url, {
        timeoutMs: 2_000,
        maxRedirects: 5,
        acquire: async () => {
          const grantedAt = Date.now();
          grants.push(grantedAt);
          return { grantedAt };
        },
      });
      assert.equal(result.firstGrantedAt, grants[0], 'the first grant is when the check ran');
    } finally {
      await hop.close();
      await destination.close();
    }
  });

  test('still works with no limiter attached, for callers that have none', async () => {
    const destination = await fastServer('arrived');
    const hop = await redirectTo(destination.url);
    try {
      const result = await performCheck(hop.url, { timeoutMs: 2_000, maxRedirects: 5 });
      assert.equal(result.outcome, 'success');
      assert.equal(typeof result.firstGrantedAt, 'number');
    } finally {
      await hop.close();
      await destination.close();
    }
  });
});
