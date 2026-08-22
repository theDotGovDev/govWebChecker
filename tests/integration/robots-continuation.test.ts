import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { installNoNetworkGuard, removeNoNetworkGuard } from '../fixtures/no-network.js';
import { fastServer, type Fixture } from '../fixtures/servers.js';
import { stubResolver } from '../fixtures/dns.js';
import { sampleTarget } from '../../src/checker/sample.js';
import { RateLimiter } from '../../src/politeness/rate-limiter.js';
import { executeCensus } from '../../src/census/run.js';
import type { Frame } from '../../src/census/frame.js';
import { sliceOf } from '../../src/census/slice.js';

before(() => installNoNetworkGuard());
after(() => removeNoNetworkGuard());

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gwc-robots-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function frameOf(domains: string[]): Frame {
  return {
    source: 'test',
    retrieved_at: '2026-08-22T00:00:00Z',
    digest: 'sha256:test',
    domains: domains.map((domain) => ({
      domain,
      type: 'City',
      organization: 'Test',
      suborganization: '',
      city: '',
      state: '',
      slice: sliceOf(domain),
    })),
  };
}

/**
 * Fetching `robots.txt` and then the page it governs is one visit, not two.
 *
 * The per-host interval exists so that two *independent readings* are never taken
 * closer together than a visitor would reload. Asking a site's permission and
 * then acting on the answer is a single visit, and a browser does exactly this
 * without pausing fifteen seconds in the middle.
 *
 * Charging it twice is not politeness, it is arithmetic: it doubled the cost of
 * every census target and put a slice at 99 minutes against a 120-minute cap, for
 * no reduction in what any target actually experiences.
 *
 * The precedent is already in the codebase and was approved with it — a redirect
 * hop charges the backend budget but not the name-keyed interval, on exactly this
 * reasoning. This applies the same rule one request earlier.
 */
describe('robots.txt and the page it governs are one visit (R8a)', () => {
  let site: Fixture;
  before(async () => {
    site = await fastServer('a municipal website');
  });
  after(async () => {
    await site.close();
  });

  test('the per-host interval is charged once, not twice', async () => {
    const HOST_INTERVAL_MS = 400;
    const domain = 'alamosa.gov';
    const frame = frameOf([domain]);
    const dns = stubResolver({ [domain]: { A: ['127.0.0.1'] } });

    const started = Date.now();
    await executeCensus({
      frame,
      slice: sliceOf(domain),
      dataDir: dir,
      config: {
        timeoutMs: 2_000,
        maxRedirects: 3,
        hostIntervalMs: HOST_INTERVAL_MS,
        domainIntervalMs: HOST_INTERVAL_MS,
        // Deliberately small: the backend budget still applies to the second
        // request, because that is the limit protecting a shared machine and a
        // continuation must never escape it.
        addressIntervalMs: 10,
        maxConcurrentHosts: 4,
        vantage: 'test',
        toolVersion: '0.1.0',
      },
      resolver: dns,
      urlOverride: () => site.url,
      now: new Date('2026-08-22T04:00:00Z'),
    });
    const elapsed = Date.now() - started;

    assert.ok(
      elapsed < HOST_INTERVAL_MS,
      `one visit must pay one interval: took ${elapsed}ms, a full interval is ${HOST_INTERVAL_MS}ms`,
    );
  });

  test('a second target on the same host still pays the full interval', async () => {
    // The guard against the obvious over-correction. Two domains resolving to one
    // host are two independent readings, and nothing about R8a may let the second
    // skip the interval the first established.
    const HOST_INTERVAL_MS = 300;
    const domains = ['alamosa.gov', 'nih.gov', 'tsa.gov', 'aledoil.gov', 'abingtonpa.gov'];
    const target = sliceOf(domains[0]!);
    const inSlice = domains.filter((d) => sliceOf(d) === target);
    const frame = frameOf(domains);
    const dns = stubResolver(Object.fromEntries(domains.map((d) => [d, { A: ['127.0.0.1'] }])));

    const started = Date.now();
    await executeCensus({
      frame,
      slice: target,
      dataDir: dir,
      config: {
        timeoutMs: 2_000,
        maxRedirects: 3,
        hostIntervalMs: HOST_INTERVAL_MS,
        domainIntervalMs: 10,
        addressIntervalMs: 10,
        maxConcurrentHosts: 4,
        vantage: 'test',
        toolVersion: '0.1.0',
      },
      resolver: dns,
      // Every domain resolves to the one fixture, so they share a host exactly as
      // municipal domains on one vendor do.
      urlOverride: () => site.url,
      now: new Date('2026-08-22T04:00:00Z'),
    });
    const elapsed = Date.now() - started;

    const expected = (inSlice.length - 1) * HOST_INTERVAL_MS;
    assert.ok(
      elapsed >= expected,
      `${inSlice.length} independent readings of one host must be spaced: took ${elapsed}ms, expected at least ${expected}ms`,
    );
  });
});

describe('the seed covers one visit, never the samples after it', () => {
  let site: Fixture;
  before(async () => {
    site = await fastServer('a municipal website');
  });
  after(async () => {
    await site.close();
  });

  test('a second sample pays the full interval even when the first was seeded', async () => {
    // Written because sabotage found nothing to break. Seeding every sample
    // instead of the first passed all 274 tests, because the census takes one
    // sample and nothing else supplies `visiting` — so the rule that keeps R8a
    // from becoming a burst was a comment rather than a constraint.
    //
    // Sampling twice is two independent readings. Only the first continues the
    // visit that fetched robots.txt; the second waits like any other reading.
    const INTERVAL_MS = 300;
    const host = new URL(site.url).hostname;
    const limiter = new RateLimiter({
      hostIntervalMs: INTERVAL_MS,
      domainIntervalMs: 10,
      addressIntervalMs: 10,
    });

    const started = Date.now();
    await sampleTarget(site.url, {
      samples: 2,
      timeoutMs: 2_000,
      maxRedirects: 3,
      limiter,
      // No backend cache: this asserts the name-keyed interval, and leaving the
      // address budget out of it means a passing test cannot be one the address
      // limit happened to produce.
      visiting: [host],
    });
    const elapsed = Date.now() - started;

    assert.ok(
      elapsed >= INTERVAL_MS,
      `the second sample must pay the interval: took ${elapsed}ms, interval is ${INTERVAL_MS}ms`,
    );
  });
});
