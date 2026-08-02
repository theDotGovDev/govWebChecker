import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { verifyRecord } from '../../src/cli/verify.js';
import type { Observation } from '../../src/record/types.js';

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gwc-verify-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function row(overrides: Partial<Observation> = {}): Observation {
  return {
    schema: '1',
    run_id: 'run-1',
    target_id: 'irs-gov',
    host: 'www.irs.gov',
    url: 'https://www.irs.gov/',
    dimension: 'availability',
    checked_at: '2026-07-31T06:00:00Z',
    outcome: 'success',
    status_code: 200,
    redirect_chain: [],
    latency: { samples: 1, median_ms: 10, min_ms: 10, max_ms: 10 },
    method: {
      vantage: 'test',
      timeout_ms: 1_000,
      sample_count: 1,
      tool_version: '0.1.0',
      source: 'self_run',
    },
    ...overrides,
  };
}

async function writeRecord(rows: Observation[]): Promise<string> {
  const file = path.join(dir, 'record.jsonl');
  await fs.writeFile(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  return file;
}

const LIMITS = { hostIntervalMs: 60_000, domainIntervalMs: 10_000 };

describe('verify reads the record, not the code (SC-002, SC-012)', () => {
  test('passes a well-spaced record', async () => {
    const file = await writeRecord([
      row({ checked_at: '2026-07-31T06:00:00Z' }),
      row({ checked_at: '2026-07-31T06:01:00Z' }),
    ]);
    const report = await verifyRecord(file, LIMITS);
    assert.equal(report.ok, true, JSON.stringify(report.checks));
  });

  test('detects a per-host spacing violation', async () => {
    const file = await writeRecord([
      row({ checked_at: '2026-07-31T06:00:00Z' }),
      row({ checked_at: '2026-07-31T06:00:30Z' }),
    ]);
    const report = await verifyRecord(file, LIMITS);
    assert.equal(report.ok, false);
    assert.ok(report.checks.some((c) => /per-host/.test(c.name) && !c.pass));
  });

  test('detects a per-domain spacing violation across different hosts', async () => {
    const file = await writeRecord([
      row({ host: 'www.va.gov', url: 'https://www.va.gov/', checked_at: '2026-07-31T06:00:00Z' }),
      row({ host: 'benefits.va.gov', url: 'https://benefits.va.gov/', checked_at: '2026-07-31T06:00:01Z' }),
    ]);
    const report = await verifyRecord(file, LIMITS);
    assert.equal(report.ok, false);
    assert.ok(report.checks.some((c) => /per-domain/.test(c.name) && !c.pass));
  });

  test('detects a row missing its method', async () => {
    const bad = row();
    delete (bad as { method?: unknown }).method;
    const file = await writeRecord([bad]);
    const report = await verifyRecord(file, LIMITS);
    assert.equal(report.ok, false);
    assert.ok(report.checks.some((c) => /method/.test(c.name) && !c.pass));
  });

  test('detects a future timestamp', async () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const file = await writeRecord([row({ checked_at: future })]);
    const report = await verifyRecord(file, LIMITS);
    assert.equal(report.ok, false);
    assert.ok(report.checks.some((c) => /future/.test(c.name) && !c.pass));
  });

  test('detects a target whose own rows go backwards in time', async () => {
    // One target is checked serially, so its own observations must be appended in
    // order. A later row with an earlier timestamp means the file was reordered
    // or rewritten, which append-only forbids.
    const file = await writeRecord([
      row({ target_id: 'irs-gov', checked_at: '2026-07-31T07:00:00Z' }),
      row({ target_id: 'irs-gov', checked_at: '2026-07-31T06:00:00Z' }),
    ]);
    const report = await verifyRecord(file, LIMITS);
    assert.equal(report.ok, false);
    assert.ok(report.checks.some((c) => /order/.test(c.name) && !c.pass));
  });

  test('does NOT flag interleaved targets, which concurrency produces legitimately', async () => {
    // Different hosts are checked concurrently and appended as each finishes, so
    // rows across targets are not globally chronological. Treating that as a
    // violation would fail every honest run — it did, before this test existed.
    const file = await writeRecord([
      row({
        target_id: 'b-gov',
        host: 'b.gov',
        url: 'https://b.gov/',
        checked_at: '2026-07-31T06:00:05Z',
      }),
      row({
        target_id: 'a-gov',
        host: 'a.gov',
        url: 'https://a.gov/',
        checked_at: '2026-07-31T06:00:00Z',
      }),
    ]);
    const report = await verifyRecord(file, LIMITS);
    assert.equal(
      report.ok,
      true,
      `interleaving must not be a violation: ${JSON.stringify(report.checks.filter((c) => !c.pass))}`,
    );
  });

  test('reports expected versus actual rather than a bare verdict', async () => {
    const file = await writeRecord([
      row({ checked_at: '2026-07-31T06:00:00Z' }),
      row({ checked_at: '2026-07-31T06:00:30Z' }),
    ]);
    const report = await verifyRecord(file, LIMITS);
    const spacing = report.checks.find((c) => /per-host/.test(c.name))!;
    assert.match(spacing.detail, /\d/, 'the report must show the numbers, not just pass/fail');
  });

  test('a failure outcome is not itself a violation', async () => {
    const file = await writeRecord([
      row({ checked_at: '2026-07-31T06:00:00Z', outcome: 'timeout', latency: { samples: 0 } }),
    ]);
    const clean = { ...row({ outcome: 'timeout', latency: { samples: 0 } }) };
    delete (clean as { status_code?: number }).status_code;
    const report = await verifyRecord(file, LIMITS);
    // A site being down is data. verify checks our conduct, not the sites'.
    assert.ok(report.checks.every((c) => c.pass || !/outcome/.test(c.name)));
  });
});
