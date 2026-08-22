import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { performCheck } from '../../src/checker/check.js';
import { RateLimiter } from '../../src/politeness/rate-limiter.js';
import { sampleTarget } from '../../src/checker/sample.js';
import { ResolutionCache } from '../../src/checker/resolve.js';
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

/**
 * Which limits a redirect hop charges (research.md R8).
 *
 * Putting every hop through the name-keyed intervals cost the 58-target hot tier
 * 125 seconds for 14 hops. Extrapolated to a census slice, where an apex
 * redirecting to `www` is among the commonest shapes in the registry, the same
 * rule adds on the order of an hour to a job capped at one hour. That is not a
 * tuning inconvenience — it makes the cycle undeliverable.
 *
 * The distinction that makes the fix a correction rather than a weakening: the
 * per-host interval exists so two *independent readings* of one site are not taken
 * closer together than an ordinary visitor would reload a page. A redirect is not
 * a second reading; it is the same visit continuing, and a visitor follows it
 * immediately. The backend limit answers a different question — how much
 * aggregate pressure one machine takes from unrelated parties — and a redirect
 * onto a vendor's shared host is exactly that, so it still charges.
 *
 * Both directions are pinned here, because a rule that only ever relaxes is
 * indistinguishable from a bug.
 */
describe('which limits a redirect hop charges', () => {
  test('a hop back to a host already contacted does not re-pay the name interval', async () => {
    // Through `sampleTarget`, not a hand-rolled acquire: the decision belongs in
    // production code, and a test that reimplements the policy proves only that
    // the test can implement it.
    const destination = await fastServer('arrived');
    const hop = await redirectTo(`${destination.url}elsewhere`);
    const limiter = new RateLimiter({
      hostIntervalMs: 4_000,
      domainIntervalMs: 4_000,
      addressIntervalMs: 1,
    });
    try {
      const started = Date.now();
      const result = await sampleTarget(hop.url, {
        samples: 1,
        timeoutMs: 2_000,
        maxRedirects: 5,
        limiter,
      });
      const elapsed = Date.now() - started;
      assert.equal(result.outcome, 'success');
      assert.ok(
        elapsed < 3_000,
        `a continuing visit waited ${elapsed}ms — it must not re-pay a reading interval mid-chain`,
      );
    } finally {
      await hop.close();
      await destination.close();
    }
  });

  test('a first contact with a new host in the chain still pays everything', async () => {
    // The half that must not be lost to the optimisation. Only a host this check
    // has already touched is a continuation; anything else is a fresh contact.
    const limiter = new RateLimiter({
      hostIntervalMs: 300,
      domainIntervalMs: 300,
      addressIntervalMs: 1,
    });
    const site = await fastServer('ok');
    try {
      const first = await sampleTarget(site.url, {
        samples: 1,
        timeoutMs: 2_000,
        maxRedirects: 5,
        limiter,
      });
      const started = Date.now();
      await sampleTarget(site.url, { samples: 1, timeoutMs: 2_000, maxRedirects: 5, limiter });
      assert.ok(
        Date.now() - started >= 300,
        'a separate check of the same host is a second reading and must be spaced',
      );
      assert.equal(first.outcome, 'success');
    } finally {
      await site.close();
    }
  });

  test('a continuation still waits on the backend budget', async () => {
    // The half the relaxation must not take with it. Exercised through
    // `sampleTarget` so it runs the real continuation path — a version of this
    // test that drove the limiter directly passed even with the backend wait
    // removed, which is how the gap was found.
    const INTERVAL_MS = 400;
    const destination = await fastServer('arrived');
    const hop = await redirectTo(`${destination.url}elsewhere`);
    const limiter = new RateLimiter({
      hostIntervalMs: 1,
      domainIntervalMs: 1,
      addressIntervalMs: INTERVAL_MS,
    });
    try {
      const started = Date.now();
      await sampleTarget(hop.url, {
        samples: 1,
        timeoutMs: 2_000,
        maxRedirects: 5,
        limiter,
        backends: new ResolutionCache(),
      });
      const elapsed = Date.now() - started;
      assert.ok(
        elapsed >= INTERVAL_MS,
        `the chain took ${elapsed}ms — a hop onto a shared backend must still pay ` +
          `the ${INTERVAL_MS}ms backend minimum, whoever else that machine serves`,
      );
    } finally {
      await hop.close();
      await destination.close();
    }
  });

  test('a hop still charges the backend limit', async () => {
    // The half that must not be lost. A redirect onto a vendor's shared host is
    // pressure on that machine arriving from a domain its other customers know
    // nothing about.
    const INTERVAL_MS = 150;
    const destination = await fastServer('arrived');
    const hop = await redirectTo(destination.url);
    const limiter = new RateLimiter({
      hostIntervalMs: 1,
      domainIntervalMs: 1,
      addressIntervalMs: INTERVAL_MS,
    });
    const grants: number[] = [];
    try {
      await performCheck(hop.url, {
        timeoutMs: 2_000,
        maxRedirects: 5,
        acquire: async (url) => {
          const grantedAt = await limiter.acquire(new URL(url).hostname, '127.0.0.1');
          grants.push(grantedAt);
          return { grantedAt };
        },
      });
      assert.equal(grants.length, 2);
      assert.ok(
        grants[1]! - grants[0]! >= INTERVAL_MS,
        `hops ${grants[1]! - grants[0]!}ms apart, below the ${INTERVAL_MS}ms backend minimum`,
      );
    } finally {
      await hop.close();
      await destination.close();
    }
  });
});
