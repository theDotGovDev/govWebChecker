import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { executeDeepRun, type DeepRunConfig } from '../../src/quality/run.js';
import type { ToolResult } from '../../src/quality/deep-check.js';
import { fastServer, fastServerOn, robotsServer, type Fixture } from '../fixtures/servers.js';

function lhr(): ToolResult {
  return {
    lighthouseVersion: '13.4.1',
    fetchTime: '2026-08-26T10:15:00.000Z',
    configSettings: {
      formFactor: 'mobile',
      screenEmulation: { width: 412, height: 823, deviceScaleFactor: 1.75, mobile: true },
      throttling: { rttMs: 150, throughputKbps: 1638.4, cpuSlowdownMultiplier: 4 },
      throttlingMethod: 'simulate',
    },
    audits: {
      'largest-contentful-paint': { numericValue: 2412.3, numericUnit: 'millisecond' },
      'speed-index': { numericValue: 3300, numericUnit: 'millisecond' },
    },
  };
}

const CONFIG: DeepRunConfig = {
  timeoutMs: 5_000,
  maxRedirects: 5,
  hostIntervalMs: 0,
  domainIntervalMs: 0,
  addressIntervalMs: 0,
  vantage: 'github-actions/test',
  preset: 'lighthouse:default/mobile',
};

async function tmp() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'deep-run-'));
}

function target(id: string, fixture: Fixture) {
  return { id, host: fixture.host, url: fixture.url };
}

describe('a deep run asks permission before it loads a page (Principle II)', () => {
  test('a disallowed path is not deep-checked at all', async () => {
    const site = await robotsServer('User-agent: *\nDisallow: /');
    try {
      let invocations = 0;
      const summary = await executeDeepRun({
        targets: [target('disallowed', site)],
        dataDir: await tmp(),
        config: { ...CONFIG, dryRun: true },
        run: async () => { invocations += 1; return lhr(); },
      });
      assert.equal(invocations, 0, 'a deep check loads the whole page — asking first is the point');
      assert.equal(summary.readings[0]!.outcome, 'skipped');
      assert.match(summary.readings[0]!.skip_reason!, /robots/i);
      assert.deepEqual(summary.readings[0]!.metrics, {});
    } finally {
      await site.close();
    }
  });
});

describe('a deep run measures one page at a time (validity, Principle I)', () => {
  test('no two page loads overlap, even across unrelated hosts', async () => {
    // Distinct loopback addresses, so the per-host limiter is not what produces
    // the serialization. If these four ran concurrently the limiter would happily
    // allow it — nothing but this pass keeps them apart.
    const sites = await Promise.all(
      ['127.0.0.2', '127.0.0.3', '127.0.0.4', '127.0.0.5'].map((a) => fastServerOn(a)),
    );
    try {
      let inFlight = 0;
      let peak = 0;
      const summary = await executeDeepRun({
        targets: sites.map((s, i) => target(`ok-${i}`, s)),
        dataDir: await tmp(),
        config: { ...CONFIG, dryRun: true },
        run: async () => {
          inFlight += 1;
          peak = Math.max(peak, inFlight);
          await new Promise((r) => setTimeout(r, 20));
          inFlight -= 1;
          return lhr();
        },
      });
      assert.equal(peak, 1,
        'two browsers competing for the same CPU inflate the very numbers being measured');
      assert.equal(summary.readings.length, 4);
      assert.equal(summary.concurrency, 1, 'the run says how many ran at once, so this is checkable from the record');
    } finally {
      await Promise.all(sites.map((s) => s.close()));
    }
  });
});

describe('a failed check is data, and the pass continues (Principle IV)', () => {
  test('one target failing does not stop the others', async () => {
    const site = await fastServer();
    try {
      let call = 0;
      const summary = await executeDeepRun({
        targets: Array.from({ length: 3 }, (_, i) => target(`ok-${i}`, site)),
        dataDir: await tmp(),
        config: { ...CONFIG, dryRun: true },
        run: async () => {
          if (call++ === 1) throw new Error('NO_FCP');
          return lhr();
        },
      });
      assert.equal(summary.readings.length, 3);
      assert.equal(summary.targets_measured, 2);
      assert.equal(summary.outcome_breakdown['check_failed'], 1);
      assert.equal(summary.all_targets_failed, false);
    } finally {
      await site.close();
    }
  });

  test('a pass where nothing measured is marked, not published as a finding', async () => {
    const site = await fastServer();
    try {
      const summary = await executeDeepRun({
        targets: [target('ok', site)],
        dataDir: await tmp(),
        config: { ...CONFIG, dryRun: true },
        run: async () => { throw new Error('chrome did not start'); },
      });
      assert.equal(summary.all_targets_failed, true,
        'every site failing at once is more likely our runner than every agency at once');
    } finally {
      await site.close();
    }
  });
});

describe('readings reach disk as the pass proceeds', () => {
  test('each reading is appended, and a dry run writes nothing', async () => {
    const site = await fastServer();
    const dir = await tmp();
    const dry = await tmp();
    try {
      const targets = [target('ok', site)];
      await executeDeepRun({ targets, dataDir: dry, config: { ...CONFIG, dryRun: true }, run: async () => lhr() });
      await assert.rejects(() => fs.readdir(path.join(dry, 'quality')));

      const summary = await executeDeepRun({ targets, dataDir: dir, config: CONFIG, run: async () => lhr() });
      const month = summary.readings[0]!.checked_at.slice(0, 7);
      const lines = (await fs.readFile(path.join(dir, 'quality', `${month}.jsonl`), 'utf8')).trim().split('\n');
      assert.equal(lines.length, 1);
      const runs = await fs.readFile(path.join(dir, 'runs', `${summary.started_at.slice(0, 7)}.jsonl`), 'utf8');
      assert.match(runs, /"dimension":"quality"/, 'the run itself is recorded, so coverage is assertable');
      assert.doesNotMatch(runs, /"readings"/, 'the rows are already on disk; the run file does not duplicate them');
    } finally {
      await site.close();
      await fs.rm(dir, { recursive: true, force: true });
      await fs.rm(dry, { recursive: true, force: true });
    }
  });
});
