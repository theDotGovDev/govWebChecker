import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { verifyRecord } from '../../src/cli/verify.js';
import type { DeepReading } from '../../src/quality/deep-check.js';

const LIMITS = { hostIntervalMs: 15_000, domainIntervalMs: 5_000, addressIntervalMs: 5_000 };

function reading(overrides: Partial<DeepReading> = {}): DeepReading {
  return {
    schema: 'govwebchecker/quality/1',
    run_id: '2026-08-25T10:00:00Z/quality/abc12345',
    target_id: 'example-gov',
    host: 'example.gov',
    url: 'https://example.gov/',
    dimension: 'quality',
    checked_at: '2026-08-25T10:15:00Z',
    outcome: 'measured',
    metrics: { speed_index: { value: 3300, unit: 'millisecond' } },
    method: {
      tool: 'lighthouse',
      tool_version: '13.4.1',
      preset: 'lighthouse:default/mobile',
      device: { form_factor: 'mobile', width: 412, height: 823, scale: 1.75, mobile: true },
      network: { rtt_ms: 150, throughput_kbps: 1638.4, cpu_slowdown: 4, method: 'simulate' },
      vantage: 'github-actions/Linux',
      source: 'self_run',
    },
    ...overrides,
  };
}

async function verifyRows(rows: unknown[]) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'verify-quality-'));
  const file = path.join(dir, 'quality.jsonl');
  await fs.writeFile(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
  try {
    return await verifyRecord(file, LIMITS);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/**
 * `verify` is what stands between a run and publication, and it reads the record
 * rather than the code — anyone can run the same check against the published
 * files and reach the same verdict. A record of deep readings makes larger claims
 * than an availability record, so it is gated at least as hard, not waved through
 * because it is a different shape.
 */
describe('a published quality record is checked on its own terms', () => {
  test('a clean record passes, and says which checks it passed', async () => {
    const report = await verifyRows([
      reading({ checked_at: '2026-08-25T10:00:00Z' }),
      reading({ host: 'other.gov', target_id: 'other-gov', checked_at: '2026-08-25T10:00:20Z' }),
    ]);
    assert.equal(report.ok, true, JSON.stringify(report.checks, null, 1));
    assert.ok(report.checks.some((c) => /vantage/i.test(c.name)));
  });

  test('a reading missing its emulation fails publication', async () => {
    const naked = reading();
    delete (naked.method as Partial<DeepReading['method']>).network;
    const report = await verifyRows([naked]);
    assert.equal(report.ok, false);
  });

  /**
   * The hole AGENTS.md names: a run from a development sandbox writes into
   * `data/`, passes every shape check, and is committable. `vantage()` labels
   * such rows `local` rather than `github-actions/*`, so they are honest — but
   * nothing refused them. A measurement taken from an ephemeral container
   * describes that container's network, resolver and CPU, not the target, and
   * publishing it would put a claim about a named agency behind a number that
   * measured us.
   */
  test('a reading taken from a development sandbox fails publication', async () => {
    const local = reading();
    local.method.vantage = 'local';
    const report = await verifyRows([local]);
    assert.equal(report.ok, false);
    const check = report.checks.find((c) => /vantage/i.test(c.name))!;
    assert.equal(check.pass, false);
    assert.match(check.detail, /local/);
  });

  test('a reading with no vantage at all fails publication', async () => {
    const anonymous = reading();
    delete (anonymous.method as Partial<DeepReading['method']>).vantage;
    assert.equal((await verifyRows([anonymous])).ok, false);
  });

  test('two page loads too close together on one host fail publication', async () => {
    const report = await verifyRows([
      reading({ checked_at: '2026-08-25T10:00:00Z' }),
      reading({ checked_at: '2026-08-25T10:00:03Z' }),
    ]);
    assert.equal(report.ok, false);
    const spacing = report.checks.find((c) => /host spacing/.test(c.name))!;
    assert.equal(spacing.pass, false);
    assert.match(spacing.detail, /3000ms.*15000ms|min observed 3000/);
  });

  test('a derived score in the record fails publication (D3)', async () => {
    const report = await verifyRows([{ ...reading(), score: 0.87 }]);
    assert.equal(report.ok, false);
  });

  test('a reading dated in the future fails publication', async () => {
    const report = await verifyRows([reading({ checked_at: '2099-01-01T00:00:00Z' })]);
    assert.equal(report.ok, false);
  });

  test('a skipped reading does not count against spacing — it made no page request', async () => {
    const report = await verifyRows([
      reading({ checked_at: '2026-08-25T10:00:00Z' }),
      reading({
        checked_at: '2026-08-25T10:00:01Z',
        outcome: 'skipped',
        skip_reason: 'robots.txt disallows this path',
        metrics: {},
      }),
    ]);
    const spacing = report.checks.find((c) => /host spacing/.test(c.name))!;
    assert.equal(spacing.pass, true, spacing.detail);
  });

  test('the same vantage gate applies to an availability record', async () => {
    // The hole AGENTS.md names is not specific to deep readings; it was simply
    // never closed. A record type that enforced it and one that did not would be
    // an inconsistency a reader would rightly distrust.
    const local = {
      schema: '1', run_id: 'r', target_id: 't', host: 'example.gov', url: 'https://example.gov/',
      dimension: 'availability', checked_at: '2026-08-25T10:00:00Z', outcome: 'success',
      status_code: 200, redirect_chain: [], latency: { samples: 1, median_ms: 100, min_ms: 100, max_ms: 100 },
      method: { vantage: 'local', timeout_ms: 15000, sample_count: 1, tool_version: '0.1.0', source: 'self_run' },
    };
    const report = await verifyRows([local]);
    assert.equal(report.ok, false);
    assert.equal(report.checks.find((c) => /vantage/i.test(c.name))!.pass, false);
  });

  test('an availability record still verifies as one', async () => {
    // The dispatch must not swallow the record this project already publishes.
    const report = await verifyRows([{
      schema: '1', run_id: 'r', target_id: 't', host: 'example.gov', url: 'https://example.gov/',
      dimension: 'availability', checked_at: '2026-08-25T10:00:00Z', outcome: 'success',
      status_code: 200, redirect_chain: [], latency: { samples: 1, median_ms: 100, min_ms: 100, max_ms: 100 },
      method: { vantage: 'github-actions/test', timeout_ms: 15000, sample_count: 1, tool_version: '0.1.0', source: 'self_run' },
    }]);
    assert.equal(report.ok, true, JSON.stringify(report.checks, null, 1));
  });
});
