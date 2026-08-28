import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { refusedUrl } from '../fixtures/failing.js';

/**
 * These tests exercise the CLI *shell* — argument handling, exit codes, output —
 * not the sampling path.
 *
 * The CLI has no option to shorten an interval (that is the point of
 * `contracts/checker-cli.md`), so a test that let it sample would wait the real
 * per-host interval between samples and turn the suite into a multi-minute job.
 * Run behavior is covered in `run.test.ts`, where the limits are injected. The
 * seam is deliberate: policy is fixed at the entry point, and the layer below it
 * takes its limits as arguments.
 */
const run = promisify(execFile);
const CLI = path.resolve('dist/src/cli/index.js');

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gwc-cli-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function cli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await run('node', [CLI, ...args]);
    return { code: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

async function targetsFile(entries: Array<{ id: string; url: string }>): Promise<string> {
  const file = path.join(dir, 'targets.json');
  await fs.writeFile(
    file,
    JSON.stringify({
      targets: entries.map((e) => ({
        id: e.id,
        host: new URL(e.url).hostname,
        url: e.url,
        agency: 'Test',
        jurisdiction: 'federal',
        inclusion_reason: 'fixture',
        traffic_evidence: { source: 'test', measure: 'n/a' },
        active: true,
      })),
    }),
    'utf8',
  );
  return file;
}

describe('the check command', () => {
  /**
   * The floor is what makes over-provisioning the schedule safe, so it has to
   * hold at the command, not just in the function that computes it. A run that
   * is not due must send nothing — including under --dry-run, which writes
   * nothing but sends the same traffic.
   */
  test('sends nothing when these hosts were read inside the floor', async () => {
    const file = await targetsFile([{ id: 'a', url: 'https://www.example.gov/' }]);
    const availability = path.join(dir, 'availability');
    await fs.mkdir(availability, { recursive: true });
    await fs.writeFile(
      path.join(availability, '2026-08.jsonl'),
      JSON.stringify({ host: 'www.example.gov', checked_at: new Date().toISOString() }) + '\n',
      'utf8',
    );
    const result = await cli(['check', '--targets', file, '--out', dir, '--dry-run']);
    assert.equal(result.code, 0, 'a skipped run is not a failure');
    assert.match(result.stderr, /not due/);
    assert.doesNotMatch(result.stderr, /targets,/, 'no run summary means no traffic was sent');
    assert.equal(result.stdout.trim(), '', 'a dry run that skipped emits no observations');
  });

  test('runs when the newest reading for these hosts is older than the floor', async () => {
    const file = await targetsFile([{ id: 'a', url: await refusedUrl() }]);
    const availability = path.join(dir, 'availability');
    await fs.mkdir(availability, { recursive: true });
    const old = new Date(Date.now() - 3 * 3600_000).toISOString();
    await fs.writeFile(
      path.join(availability, '2026-08.jsonl'),
      JSON.stringify({ host: new URL(await refusedUrl()).hostname, checked_at: old }) + '\n',
      'utf8',
    );
    const result = await cli(['check', '--targets', file, '--out', dir, '--dry-run']);
    assert.equal(result.code, 0);
    assert.match(result.stderr, /due: last reading 3h 0m ago/);
    assert.match(result.stderr, /1 targets/);
  });

  test('exits 1 when the target list cannot be read', async () => {
    const result = await cli(['check', '--targets', path.join(dir, 'missing.json')]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /cannot run/);
  });

  test('exits 1 on an invalid target list rather than checking a partial one', async () => {
    const file = path.join(dir, 'bad.json');
    await fs.writeFile(file, JSON.stringify({ targets: [{ id: 'x' }] }), 'utf8');
    const result = await cli(['check', '--targets', file]);
    assert.equal(result.code, 1);
  });

  test('rejects an unknown option rather than silently ignoring it', async () => {
    const result = await cli(['check', '--concurrency', '10']);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /unknown option/);
  });

  test('rejects the flags that would weaken a limit', async () => {
    // Each of these exists in tools like this one and deliberately not in ours.
    for (const flag of ['--rate-limit', '--no-rate-limit', '--timeout', '--user-agent', '--retries']) {
      const result = await cli(['check', flag, '1']);
      assert.equal(result.code, 1, `${flag} must not be accepted`);
      assert.match(result.stderr, /unknown option/);
    }
  });

  test('exits 1 when --only names a target that is not on the list', async () => {
    const file = await targetsFile([{ id: 'a', url: await refusedUrl() }]);
    const result = await cli(['check', '--targets', file, '--only', 'nope']);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /no active target/);
  });

  test('prints usage and exits 0 with no arguments', async () => {
    const result = await cli([]);
    assert.equal(result.code, 0);
    assert.match(result.stdout, /check/);
    assert.match(result.stdout, /no option to weaken a rate limit/);
  });
});

describe('the verify command', () => {
  const base = {
    schema: '1',
    run_id: 'r',
    target_id: 't',
    host: 'www.irs.gov',
    url: 'https://www.irs.gov/',
    dimension: 'availability',
    outcome: 'success',
    status_code: 200,
    redirect_chain: [],
    latency: { samples: 1, median_ms: 5, min_ms: 5, max_ms: 5 },
    method: { vantage: 'github-actions/test', timeout_ms: 1, sample_count: 1, tool_version: '0', source: 'self_run' },
  };

  async function record(rows: object[]): Promise<string> {
    const file = path.join(dir, 'record.jsonl');
    await fs.writeFile(file, rows.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8');
    return file;
  }

  /**
   * An acknowledgement belongs to the record it was written for.
   *
   * The default acknowledgement path is repo-relative, so every `verify` run
   * picks the same file up. Applying its entries to whatever record is on the
   * command line makes them all stale against any other file and fails a record
   * that has nothing to do with the breach — a real failure invented out of an
   * unrelated exemption.
   */
  test('an acknowledgement written for another record does not touch this one', async () => {
    const file = await record([
      { ...base, checked_at: '2026-07-31T06:00:00Z' },
      { ...base, checked_at: '2026-07-31T06:01:00Z' },
    ]);
    const acknowledged = path.join(dir, 'ack.json');
    await fs.writeFile(
      acknowledged,
      JSON.stringify({
        breaches: [
          {
            record: 'data/availability/1999-01.jsonl',
            check: 'per-address spacing',
            key: '192.0.66.230',
            earlier: '1999-01-01T00:00:00.000Z',
            later: '1999-01-01T00:00:00.100Z',
            cause: 'elsewhere',
            fixed_by: 'elsewhere',
          },
        ],
      }),
      'utf8',
    );
    const result = await cli(['verify', file, '--acknowledged', acknowledged]);
    assert.equal(result.code, 0, result.stdout);
    assert.doesNotMatch(result.stdout, /acknowledged breach/);
  });

  test('a malformed acknowledgement file fails loudly rather than verifying against none', async () => {
    const file = await record([{ ...base, checked_at: '2026-07-31T06:00:00Z' }]);
    const acknowledged = path.join(dir, 'ack.json');
    await fs.writeFile(acknowledged, '{ not json', 'utf8');
    const result = await cli(['verify', file, '--acknowledged', acknowledged]);
    assert.equal(result.code, 1, result.stdout);
  });

  test('exits 0 and prints a verdict table for a clean record', async () => {
    const file = await record([
      { ...base, checked_at: '2026-07-31T06:00:00Z' },
      { ...base, checked_at: '2026-07-31T06:01:00Z' },
    ]);
    const result = await cli(['verify', file]);
    assert.equal(result.code, 0, result.stdout);
    assert.match(result.stdout, /per-host spacing.*PASS/);
    assert.match(result.stdout, /per-domain spacing.*PASS/);
    assert.match(result.stdout, /all guarantees hold/);
  });

  test('exits 1 and names the violation on a record that breaks a guarantee', async () => {
    const file = await record([
      { ...base, checked_at: '2026-07-31T06:00:00Z' },
      { ...base, checked_at: '2026-07-31T06:00:01Z' },
    ]);
    const result = await cli(['verify', file]);
    assert.equal(result.code, 1);
    assert.match(result.stdout, /per-host spacing.*FAIL/);
    assert.match(result.stdout, /VIOLATIONS FOUND/);
  });

  test('shows the numbers, not just a verdict', async () => {
    const file = await record([
      { ...base, checked_at: '2026-07-31T06:00:00Z' },
      { ...base, checked_at: '2026-07-31T06:00:01Z' },
    ]);
    const result = await cli(['verify', file]);
    assert.match(result.stdout, /min observed 1000ms.*required 15000ms/);
  });

  test('exits 1 when given no file', async () => {
    const result = await cli(['verify']);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /usage/);
  });
});
