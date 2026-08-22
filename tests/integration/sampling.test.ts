import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installNoNetworkGuard, removeNoNetworkGuard } from '../fixtures/no-network.js';
import { fastServer, silentServer } from '../fixtures/servers.js';
import { RateLimiter } from '../../src/politeness/rate-limiter.js';
import { sampleTarget } from '../../src/checker/sample.js';

before(() => installNoNetworkGuard());
after(() => removeNoNetworkGuard());

const HOST_INTERVAL_MS = 100;

function limiter() {
  return new RateLimiter({ hostIntervalMs: HOST_INTERVAL_MS, domainIntervalMs: 1, addressIntervalMs: 1 });
}

describe('multi-sample timing (FR-011a, FR-011b)', () => {
  test('takes the requested number of samples', async () => {
    const f = await fastServer();
    try {
      const result = await sampleTarget(f.url, {
        samples: 3,
        timeoutMs: 2_000,
        maxRedirects: 5,
        limiter: limiter(),
      });
      assert.equal(result.latency.samples, 3);
      assert.equal(f.requests.length, 3);
    } finally {
      await f.close();
    }
  });

  test('spaces the samples by the per-host interval — statistics are not a licence to burst', async () => {
    const f = await fastServer();
    try {
      const started = Date.now();
      await sampleTarget(f.url, {
        samples: 3,
        timeoutMs: 2_000,
        maxRedirects: 5,
        limiter: limiter(),
      });
      const elapsed = Date.now() - started;
      assert.ok(
        elapsed >= HOST_INTERVAL_MS * 2,
        `3 samples took ${elapsed}ms; at least ${HOST_INTERVAL_MS * 2}ms of spacing is required`,
      );
    } finally {
      await f.close();
    }
  });

  test('stores median, min, max and the count', async () => {
    const f = await fastServer();
    try {
      const result = await sampleTarget(f.url, {
        samples: 3,
        timeoutMs: 2_000,
        maxRedirects: 5,
        limiter: limiter(),
      });
      const { samples, median_ms, min_ms, max_ms } = result.latency;
      assert.equal(samples, 3);
      assert.ok(typeof median_ms === 'number');
      assert.ok(min_ms! <= median_ms!, 'min must not exceed median');
      assert.ok(max_ms! >= median_ms!, 'max must not be below median');
    } finally {
      await f.close();
    }
  });

  test('a total failure stores samples: 0 with no latency figure (Principle V)', async () => {
    const f = await silentServer();
    try {
      const result = await sampleTarget(f.url, {
        samples: 2,
        timeoutMs: 150,
        maxRedirects: 5,
        limiter: limiter(),
      });
      assert.equal(result.outcome, 'timeout');
      assert.equal(result.latency.samples, 0);
      assert.equal(result.latency.median_ms, undefined, 'absence must not read as zero');
      assert.equal(result.latency.min_ms, undefined);
      assert.equal(result.latency.max_ms, undefined);
    } finally {
      await f.close();
    }
  });

  test('reports the median of the successful samples only', async () => {
    const f = await fastServer();
    try {
      const result = await sampleTarget(f.url, {
        samples: 1,
        timeoutMs: 2_000,
        maxRedirects: 5,
        limiter: limiter(),
      });
      // One sample is visible as one sample rather than disguised as a clean
      // figure — the spread is degenerate and says so.
      assert.equal(result.latency.samples, 1);
      assert.equal(result.latency.min_ms, result.latency.max_ms);
    } finally {
      await f.close();
    }
  });
});
