import { test, describe, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { installNoNetworkGuard, removeNoNetworkGuard } from '../fixtures/no-network.js';
import { fastServer, statusServer, robotsServer, type Fixture } from '../fixtures/servers.js';
import { refusedUrl } from '../fixtures/failing.js';
import { executeRun } from '../../src/checker/run.js';
import type { Target } from '../../src/targets/load.js';
import type { Observation } from '../../src/record/types.js';

before(() => installNoNetworkGuard());
after(() => removeNoNetworkGuard());

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gwc-run-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function target(id: string, url: string, overrides: Partial<Target> = {}): Target {
  return {
    id,
    host: new URL(url).hostname,
    url,
    agency: 'Test Agency',
    jurisdiction: 'federal',
    inclusion_reason: 'fixture',
    traffic_evidence: { source: 'test', measure: 'n/a' },
    active: true,
    ...overrides,
  };
}

const CONFIG = {
  samples: 1,
  timeoutMs: 1_000,
  maxRedirects: 3,
  hostIntervalMs: 1,
  domainIntervalMs: 1,
  maxConcurrentHosts: 4,
  vantage: 'test',
  toolVersion: '0.1.0',
};

async function readRecord(month = new Date().toISOString().slice(0, 7)): Promise<Observation[]> {
  const file = path.join(dir, 'availability', `${month}.jsonl`);
  const text = await fs.readFile(file, 'utf8');
  return text.trimEnd().split('\n').map((l) => JSON.parse(l) as Observation);
}

describe('a run', () => {
  test('records one observation per active target', async () => {
    const a = await fastServer();
    const b = await fastServer();
    try {
      await executeRun({
        targets: [target('a', a.url), target('b', b.url)],
        dataDir: dir,
        config: CONFIG,
      });
      const rows = await readRecord();
      assert.equal(rows.length, 2);
      assert.deepEqual(rows.map((r) => r.target_id).sort(), ['a', 'b']);
    } finally {
      await a.close();
      await b.close();
    }
  });

  test('does not check a retired target (SC-005)', async () => {
    const a = await fastServer();
    const b = await fastServer();
    try {
      await executeRun({
        targets: [target('a', a.url), target('b', b.url, { active: false })],
        dataDir: dir,
        config: CONFIG,
      });
      assert.equal((await readRecord()).length, 1);
      assert.equal(b.requests.length, 0, 'a retired target must receive no traffic');
    } finally {
      await a.close();
      await b.close();
    }
  });

  test('one target failing does not stop the others (FR-023)', async () => {
    const good = await fastServer();
    const dead = await refusedUrl();
    try {
      await executeRun({
        targets: [target('dead', dead), target('good', good.url)],
        dataDir: dir,
        config: CONFIG,
      });
      const rows = await readRecord();
      assert.equal(rows.length, 2, 'both targets must produce an observation');
      assert.equal(rows.find((r) => r.target_id === 'dead')?.outcome, 'connection_failure');
      assert.equal(rows.find((r) => r.target_id === 'good')?.outcome, 'success');
    } finally {
      await good.close();
    }
  });

  test('a failure is recorded, never omitted (FR-012)', async () => {
    const bad = await statusServer(503);
    try {
      await executeRun({ targets: [target('bad', bad.url)], dataDir: dir, config: CONFIG });
      const rows = await readRecord();
      assert.equal(rows.length, 1);
      assert.equal(rows[0]!.outcome, 'http_error');
      assert.equal(rows[0]!.status_code, 503);
    } finally {
      await bad.close();
    }
  });

  test('marks a run in which every target failed (FR-024)', async () => {
    const dead = await refusedUrl();
    const summary = await executeRun({
      targets: [target('dead', dead)],
      dataDir: dir,
      config: CONFIG,
    });
    assert.equal(
      summary.all_targets_failed,
      true,
      'a fault in our own network must not later read as a nationwide outage',
    );
  });

  test('persists the run summary so a reader can discount a bad run (FR-024)', async () => {
    const dead = await refusedUrl();
    await executeRun({ targets: [target('dead', dead)], dataDir: dir, config: CONFIG });

    const month = new Date().toISOString().slice(0, 7);
    const text = await fs.readFile(path.join(dir, 'runs', `${month}.jsonl`), 'utf8');
    const summary = JSON.parse(text.trim()) as Record<string, unknown>;

    // Returning the marker is not enough — the record is what a reader sees, and
    // an all-failed run has to be discountable from the files alone.
    assert.equal(summary['all_targets_failed'], true);
    assert.equal(summary['targets_attempted'], 1);
    assert.equal(summary['targets_succeeded'], 0);
    assert.ok(typeof summary['run_id'] === 'string');
  });

  test('the run summary joins to its observations by run_id', async () => {
    const a = await fastServer();
    try {
      await executeRun({ targets: [target('a', a.url)], dataDir: dir, config: CONFIG });
      const month = new Date().toISOString().slice(0, 7);
      const summary = JSON.parse(
        (await fs.readFile(path.join(dir, 'runs', `${month}.jsonl`), 'utf8')).trim(),
      ) as { run_id: string };
      assert.equal((await readRecord())[0]!.run_id, summary.run_id);
    } finally {
      await a.close();
    }
  });

  test('a dry run writes neither observations nor a run summary', async () => {
    const a = await fastServer();
    try {
      await executeRun({
        targets: [target('a', a.url)],
        dataDir: dir,
        config: { ...CONFIG, dryRun: true },
      });
      await assert.rejects(() => fs.stat(path.join(dir, 'availability')));
      await assert.rejects(() => fs.stat(path.join(dir, 'runs')));
    } finally {
      await a.close();
    }
  });

  test('marks a run where every target was blocked — that is our network, not theirs', async () => {
    // Found by running against real targets from a sandbox whose egress refused
    // CONNECT: every target came back 403/blocked, and the run was NOT marked,
    // because "blocked" counted as the site answering. The record would have
    // asserted that three federal agencies refuse automated traffic when the
    // truth was our own network path.
    const a = await statusServer(403);
    const b = await statusServer(403);
    try {
      const summary = await executeRun({
        targets: [target('a', a.url), target('b', b.url)],
        dataDir: dir,
        config: CONFIG,
      });
      assert.equal(
        summary.all_targets_failed,
        true,
        'no target produced a successful measurement, so the run is not trustworthy',
      );
    } finally {
      await a.close();
      await b.close();
    }
  });

  test('records the outcome breakdown so uniformity is visible to a reader', async () => {
    const a = await statusServer(403);
    const good = await fastServer();
    try {
      await executeRun({
        targets: [target('a', a.url), target('good', good.url)],
        dataDir: dir,
        config: CONFIG,
      });
      const month = new Date().toISOString().slice(0, 7);
      const summary = JSON.parse(
        (await fs.readFile(path.join(dir, 'runs', `${month}.jsonl`), 'utf8')).trim(),
      ) as { outcome_breakdown: Record<string, number> };
      assert.deepEqual(summary.outcome_breakdown, { blocked: 1, success: 1 });
    } finally {
      await a.close();
      await good.close();
    }
  });

  test('does not mark a run in which something succeeded', async () => {
    const good = await fastServer();
    const dead = await refusedUrl();
    try {
      const summary = await executeRun({
        targets: [target('good', good.url), target('dead', dead)],
        dataDir: dir,
        config: CONFIG,
      });
      assert.equal(summary.all_targets_failed, false);
    } finally {
      await good.close();
    }
  });

  test('skips a robots-disallowed target and records why, without fetching it', async () => {
    let f: Fixture | undefined;
    try {
      f = await robotsServer('User-agent: *\nDisallow: /\n');
      await executeRun({ targets: [target('blocked', f.url)], dataDir: dir, config: CONFIG });
      const rows = await readRecord();
      assert.equal(rows[0]!.outcome, 'skipped');
      assert.match(rows[0]!.skip_reason ?? '', /robots/i);
      const paths = f.requests.map((r) => r.url);
      assert.deepEqual(paths, ['/robots.txt'], `only robots.txt should be requested, got ${paths.join(', ')}`);
    } finally {
      await f?.close();
    }
  });

  test('every observation carries its method (FR-014)', async () => {
    const a = await fastServer();
    try {
      await executeRun({ targets: [target('a', a.url)], dataDir: dir, config: CONFIG });
      const row = (await readRecord())[0]!;
      assert.equal(row.method.vantage, 'test');
      assert.equal(row.method.timeout_ms, CONFIG.timeoutMs);
      assert.equal(row.method.sample_count, CONFIG.samples);
      assert.equal(row.method.source, 'self_run');
    } finally {
      await a.close();
    }
  });

  test('every observation in a run shares its run_id', async () => {
    const a = await fastServer();
    const b = await fastServer();
    try {
      await executeRun({
        targets: [target('a', a.url), target('b', b.url)],
        dataDir: dir,
        config: CONFIG,
      });
      const rows = await readRecord();
      assert.equal(new Set(rows.map((r) => r.run_id)).size, 1);
    } finally {
      await a.close();
      await b.close();
    }
  });

  test('records when the check actually ran (FR-011)', async () => {
    const a = await fastServer();
    const before = new Date().toISOString();
    try {
      await executeRun({ targets: [target('a', a.url)], dataDir: dir, config: CONFIG });
      const row = (await readRecord())[0]!;
      assert.ok(row.checked_at >= before, 'checked_at must be the real execution time');
      assert.ok(row.checked_at <= new Date().toISOString());
      assert.match(row.checked_at, /Z$/, 'timestamps are UTC');
    } finally {
      await a.close();
    }
  });

  test('writes no page body to disk (FR-015)', async () => {
    const a = await fastServer('<html>secret content</html>');
    try {
      await executeRun({ targets: [target('a', a.url)], dataDir: dir, config: CONFIG });
      const file = path.join(dir, 'availability', `${new Date().toISOString().slice(0, 7)}.jsonl`);
      const text = await fs.readFile(file, 'utf8');
      assert.ok(!text.includes('secret content'), 'page content must never reach disk');
    } finally {
      await a.close();
    }
  });
});
