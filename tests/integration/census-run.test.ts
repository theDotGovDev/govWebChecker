import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { installNoNetworkGuard, removeNoNetworkGuard } from '../fixtures/no-network.js';
import { fastServer, statusServer, type Fixture } from '../fixtures/servers.js';
import { stubResolver } from '../fixtures/dns.js';
import { executeCensus } from '../../src/census/run.js';
import type { Frame } from '../../src/census/frame.js';
import { sliceOf } from '../../src/census/slice.js';
import type { Observation } from '../../src/record/types.js';

before(() => installNoNetworkGuard());
after(() => removeNoNetworkGuard());

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gwc-census-'));
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
      city: '',
      state: '',
      slice: sliceOf(domain),
    })),
  };
}

const CONFIG = {
  timeoutMs: 2_000,
  maxRedirects: 3,
  hostIntervalMs: 1,
  domainIntervalMs: 1,
  addressIntervalMs: 1,
  maxConcurrentHosts: 4,
  vantage: 'test',
  toolVersion: '0.1.0',
};

async function readRows(): Promise<Observation[]> {
  const files = await fs.readdir(path.join(dir, 'availability')).catch(() => []);
  const rows: Observation[] = [];
  for (const f of files) {
    const text = await fs.readFile(path.join(dir, 'availability', f), 'utf8');
    for (const line of text.trim().split('\n')) if (line) rows.push(JSON.parse(line));
  }
  return rows;
}

describe('running one census slice', () => {
  let site: Fixture;
  before(async () => {
    site = await fastServer('a municipal website');
  });
  after(async () => {
    await site.close();
  });

  test('produces one observation per domain in the slice, fully attributed', async () => {
    const domain = 'alamosa.gov';
    const frame = frameOf([domain]);
    const dns = stubResolver({ [domain]: { A: ['127.0.0.1'] } });

    const summary = await executeCensus({
      frame,
      slice: sliceOf(domain),
      dataDir: dir,
      config: CONFIG,
      resolver: dns,
      // The fixture listens on a port, so the census must be told where to send
      // a request it derived itself. Production derives https://<domain>/.
      urlOverride: () => site.url,
      now: new Date('2026-08-22T04:00:00Z'),
    });

    assert.equal(summary.targets_attempted, 1);
    const rows = await readRows();
    assert.equal(rows.length, 1);
    const row = rows[0]!;
    assert.equal(row.tier, 'broad');
    assert.equal(row.slice, sliceOf(domain));
    assert.equal(row.cycle, '2026-W34');
    assert.equal(row.url_rule, 'canonical/1');
    assert.equal(row.resolution?.status, 'address');
    assert.equal(row.presence?.state, 'website');
    assert.equal(row.presence?.rule, 'presence/1');
    assert.equal(row.target_id, domain);
  });

  test('checks only the domains in the requested slice', async () => {
    // Coverage is a claim about a slice. A run that wandered outside its slice
    // would double-cover some domains and make the cycle's accounting a fiction.
    const domains = ['alamosa.gov', 'abingtonpa.gov', 'nih.gov', 'tsa.gov', 'aledoil.gov'];
    const frame = frameOf(domains);
    const target = sliceOf(domains[0]!);
    const inSlice = domains.filter((d) => sliceOf(d) === target);
    const dns = stubResolver(Object.fromEntries(domains.map((d) => [d, { A: ['127.0.0.1'] }])));

    await executeCensus({
      frame,
      slice: target,
      dataDir: dir,
      config: CONFIG,
      resolver: dns,
      urlOverride: () => site.url,
      now: new Date('2026-08-22T04:00:00Z'),
    });

    const rows = await readRows();
    assert.deepEqual(rows.map((r) => r.target_id).sort(), inSlice.sort());
  });

  test('the run summary carries what a coverage claim needs', async () => {
    const domain = 'alamosa.gov';
    const all = [domain, 'nih.gov', 'tsa.gov'];
    const frame = frameOf(all);
    // Computed, not assumed: another domain may hash into the same slice, and a
    // test that hardcoded 1 would be asserting the hash rather than the summary.
    const expectedSliceSize = all.filter((d) => sliceOf(d) === sliceOf(domain)).length;
    const dns = stubResolver(Object.fromEntries(all.map((d) => [d, { A: ['127.0.0.1'] }])));

    const summary = await executeCensus({
      frame,
      slice: sliceOf(domain),
      dataDir: dir,
      config: CONFIG,
      resolver: dns,
      urlOverride: () => site.url,
      now: new Date('2026-08-22T04:00:00Z'),
    });

    assert.equal(summary.tier, 'broad');
    assert.equal(summary.cycle, '2026-W34');
    assert.equal(summary.slice, sliceOf(domain));
    assert.equal(summary.frame_digest, frame.digest);
    assert.equal(summary.frame_size, 3);
    assert.equal(summary.slice_size, expectedSliceSize);
  });

  test('an empty slice fails rather than recording a successful sweep of nothing', async () => {
    // FR-115. A run that recorded coverage of nothing is the one shape that makes
    // a gap in the record look like coverage — the reader cannot tell it from a
    // slice that genuinely held no domains, and there is no such slice.
    const frame = frameOf(['alamosa.gov']);
    const empty = (sliceOf('alamosa.gov') + 1) % 7;
    await assert.rejects(
      () =>
        executeCensus({
          frame,
          slice: empty,
          dataDir: dir,
          config: CONFIG,
          resolver: stubResolver({}),
          urlOverride: () => site.url,
          now: new Date('2026-08-22T04:00:00Z'),
        }),
      /empty|no domains/i,
    );
  });
});

describe('a domain with no website is never reported as a broken one', () => {
  test('mail-only domains are recorded as absent, and receive no request', async () => {
    // The whole point. 1,807 registered .gov domains publish no web address, and
    // a request to any of them would be traffic spent to learn what DNS already
    // said — as well as producing a failure that reads as a broken website.
    const domain = 'mailonly.gov';
    const frame = frameOf([domain]);
    const dns = stubResolver({ [domain]: { MX: ['mail.mailonly.gov'] } });

    const summary = await executeCensus({
      frame,
      slice: sliceOf(domain),
      dataDir: dir,
      config: CONFIG,
      resolver: dns,
      urlOverride: () => {
        throw new Error('a domain with no web address must not be requested');
      },
      now: new Date('2026-08-22T04:00:00Z'),
    });

    assert.equal(summary.targets_attempted, 1);
    const row = (await readRows())[0]!;
    assert.equal(row.resolution?.status, 'mail_only');
    assert.equal(row.presence?.state, 'no_website');
    assert.equal(row.latency.samples, 0, 'nothing was measured, because nothing was sent');
  });

  test('a resolver failure is recorded as ours, not as the jurisdiction publishing nothing', async () => {
    const domain = 'unreachable.gov';
    const frame = frameOf([domain]);
    const dns = stubResolver({
      [domain]: { error: 'ESERVFAIL' },
      [`www.${domain}`]: { error: 'ESERVFAIL' },
    });

    await executeCensus({
      frame,
      slice: sliceOf(domain),
      dataDir: dir,
      config: CONFIG,
      resolver: dns,
      urlOverride: () => {
        throw new Error('must not request a domain we could not resolve');
      },
      now: new Date('2026-08-22T04:00:00Z'),
    });

    const row = (await readRows())[0]!;
    assert.equal(row.resolution?.status, 'resolver_error');
    assert.equal(row.presence?.state, 'undetermined');
    assert.notEqual(row.presence?.state, 'no_website');
  });

  test('a site that answers 500 is a website, and a broken one', async () => {
    const failing = await statusServer(500);
    try {
      const domain = 'broken.gov';
      const frame = frameOf([domain]);
      const dns = stubResolver({ [domain]: { A: ['127.0.0.1'] } });

      await executeCensus({
        frame,
        slice: sliceOf(domain),
        dataDir: dir,
        config: CONFIG,
        resolver: dns,
        urlOverride: () => failing.url,
        now: new Date('2026-08-22T04:00:00Z'),
      });

      const row = (await readRows())[0]!;
      assert.equal(row.outcome, 'http_error');
      assert.equal(row.presence?.state, 'website');
    } finally {
      await failing.close();
    }
  });

  test('presence never leaks into outcome (FR-117)', async () => {
    const domain = 'mailonly.gov';
    const frame = frameOf([domain]);
    const dns = stubResolver({ [domain]: { MX: ['mail.mailonly.gov'] } });

    await executeCensus({
      frame,
      slice: sliceOf(domain),
      dataDir: dir,
      config: CONFIG,
      resolver: dns,
      urlOverride: () => site_unused(),
      now: new Date('2026-08-22T04:00:00Z'),
    });

    const row = (await readRows())[0]!;
    const PROTOCOL_OUTCOMES = new Set([
      'success',
      'http_error',
      'timeout',
      'connection_failure',
      'dns_failure',
      'tls_failure',
      'blocked',
      'skipped',
    ]);
    assert.ok(
      PROTOCOL_OUTCOMES.has(row.outcome),
      `outcome "${row.outcome}" is a reading, not a protocol fact`,
    );
  });
});

function site_unused(): string {
  throw new Error('not requested');
}
