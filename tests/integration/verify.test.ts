import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { verifyRecord } from '../../src/cli/verify.js';
import type { Observation } from '../../src/record/types.js';
import { sliceOf } from '../../src/census/slice.js';

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
      vantage: 'github-actions/test',
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

const LIMITS = { hostIntervalMs: 60_000, domainIntervalMs: 10_000, addressIntervalMs: 5_000 };

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

  test('reports plainly when handed a file that is not an observation record', async () => {
    // The first real workflow run crashed here: the verify step globbed
    // data/*/*.jsonl, which swept in the run-summary file, whose rows have no
    // host. A TypeError killed the step, the commit was skipped, and three
    // perfectly good measurements were discarded. A tool that gates publication
    // must fail legibly or not at all.
    const file = path.join(dir, 'runs.jsonl');
    await fs.writeFile(
      file,
      JSON.stringify({
        run_id: 'r',
        started_at: '2026-08-03T15:48:58Z',
        finished_at: '2026-08-03T15:49:43Z',
        targets_attempted: 3,
        targets_succeeded: 3,
        all_targets_failed: false,
        outcome_breakdown: { success: 3 },
        vantage: 'github-actions/Linux',
      }) + '\n',
      'utf8',
    );

    const report = await verifyRecord(file, LIMITS);
    assert.equal(report.ok, false);
    assert.ok(
      report.checks.some((c) => /observation record/i.test(c.detail) || /observation record/i.test(c.name)),
      `expected a legible explanation, got ${JSON.stringify(report.checks)}`,
    );
  });

  test('does not throw on rows missing the fields it keys on', async () => {
    const file = path.join(dir, 'partial.jsonl');
    await fs.writeFile(file, JSON.stringify({ dimension: 'availability', nonsense: true }) + '\n', 'utf8');
    await assert.doesNotReject(() => verifyRecord(file, LIMITS));
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

/**
 * The shared-hosting guarantee has to be checkable by a reader, not merely
 * enforced by us. Principle V is the whole reason: a limit nobody outside can
 * confirm is a promise, and this project publishes claims about named
 * institutions on the strength of these promises.
 */
describe('verify proves the shared-hosting limit from the record alone', () => {
  test('detects two distinct domains hitting one backend too fast', async () => {
    const file = await writeRecord([
      row({
        target_id: 'aledoil',
        host: 'aledoil.gov',
        url: 'https://aledoil.gov/',
        address: '89.106.200.153',
        checked_at: '2026-07-31T06:00:00Z',
      }),
      row({
        target_id: 'abingtonpa',
        host: 'abingtonpa.gov',
        url: 'https://abingtonpa.gov/',
        address: '89.106.200.153',
        checked_at: '2026-07-31T06:00:01Z',
      }),
    ]);
    const report = await verifyRecord(file, LIMITS);
    assert.equal(report.ok, false, 'one second apart on one server must fail');
    const check = report.checks.find((c) => c.name === 'per-address spacing');
    assert.ok(check && !check.pass, JSON.stringify(report.checks));
    assert.match(check.detail, /89\.106\.200\.153/, 'the report must name the backend');
  });

  test('passes distinct domains on one backend that are properly spaced', async () => {
    const file = await writeRecord([
      row({
        target_id: 'aledoil',
        host: 'aledoil.gov',
        url: 'https://aledoil.gov/',
        address: '89.106.200.153',
        checked_at: '2026-07-31T06:00:00Z',
      }),
      row({
        target_id: 'abingtonpa',
        host: 'abingtonpa.gov',
        url: 'https://abingtonpa.gov/',
        address: '89.106.200.153',
        checked_at: '2026-07-31T06:00:10Z',
      }),
    ]);
    const report = await verifyRecord(file, LIMITS);
    assert.equal(report.ok, true, JSON.stringify(report.checks));
  });

  test('does not group address-less rows together as if they shared a backend', async () => {
    // Rows predating the address field, or whose resolution failed, carry no
    // address. Treating "absent" as a shared key would invent a violation out of
    // missing data — the same mistake as reading absence as zero (Principle V).
    const file = await writeRecord([
      row({ target_id: 'a', host: 'a.gov', url: 'https://a.gov/', checked_at: '2026-07-31T06:00:00Z' }),
      row({ target_id: 'b', host: 'b.gov', url: 'https://b.gov/', checked_at: '2026-07-31T06:00:01Z' }),
    ]);
    const report = await verifyRecord(file, LIMITS);
    assert.equal(report.ok, true, JSON.stringify(report.checks));
  });

  test('existing records without the address field still verify (FR-136)', async () => {
    const file = await writeRecord([
      row({ checked_at: '2026-07-31T06:00:00Z' }),
      row({ checked_at: '2026-07-31T06:01:00Z' }),
    ]);
    const report = await verifyRecord(file, LIMITS);
    assert.equal(report.ok, true, 'the record is append-only; old rows must stay valid');
  });
});

/**
 * Coverage, provable by a reader holding only the record and the frame.
 *
 * SC-102 promises someone can state how many domains a cycle covered and name the
 * ones it did not, without re-running anything and without trusting our code. So
 * this is computed from observations and the committed frame — not from our run
 * summaries, which are our own account of what we did.
 */
describe('verify proves census coverage (FR-114, SC-102)', () => {
  // a.gov, f.gov and h.gov all hash into slice 3; b.gov into 0 and c.gov into 6.
  // Coverage is a claim about the slices that ran, so a fixture that put every
  // domain in its own slice could not express "this slice missed one".
  const frame = {
    source: 'test',
    retrieved_at: '2026-08-22T00:00:00Z',
    digest: 'sha256:test',
    domains: ['a.gov', 'f.gov', 'b.gov', 'c.gov'].map((domain) => ({
      domain,
      type: 'City',
      organization: '',
      suborganization: '',
      city: '',
      state: '',
      slice: sliceOf(domain),
    })),
  };

  function censusRow(domain: string, at: string): Observation {
    return row({
      target_id: domain,
      host: domain,
      url: `https://${domain}/`,
      checked_at: at,
      tier: 'broad',
      cycle: '2026-W34',
      slice: sliceOf(domain),
      resolution: { status: 'address', apex: true, www: true },
      presence: { state: 'website', rule: 'presence/1' },
    });
  }

  test('a cycle that covered the whole frame passes and says so', async () => {
    const file = await writeRecord(
      frame.domains.map((d, i) => censusRow(d.domain, `2026-08-2${2 + i}T06:00:00Z`)),
    );
    const report = await verifyRecord(file, LIMITS, frame);
    const check = report.checks.find((c) => c.name === 'census coverage');
    assert.ok(check, JSON.stringify(report.checks.map((c) => c.name)));
    assert.equal(check.pass, true, check.detail);
    assert.match(check.detail, /4\/4 domains/);
    assert.match(check.detail, /3\/3 slices/);
  });

  test('names the domains a slice that ran did not reach', async () => {
    // "How many" is not enough. A reader has to be able to name them, or the
    // gap cannot be investigated — and an uninvestigable gap is indistinguishable
    // from a jurisdiction that vanished.
    const file = await writeRecord([censusRow('a.gov', '2026-08-22T06:00:00Z')]);
    const report = await verifyRecord(file, LIMITS, frame);
    const check = report.checks.find((c) => c.name === 'census coverage')!;
    assert.equal(check.pass, false, check.detail);
    assert.match(check.detail, /f\.gov/);
    assert.equal(report.ok, false, 'a slice that skipped a domain it owned must not pass');
  });

  test('a cycle still in progress is neither a failure nor reported as complete', async () => {
    // The census covers the frame over seven days. Judged against the whole frame
    // on day one, every cycle in progress would report thousands of missing
    // domains — reading "not yet" as "never came", which is the exact error this
    // feature exists to avoid, one level up from a jurisdiction's website.
    const file = await writeRecord([
      censusRow('a.gov', '2026-08-22T06:00:00Z'),
      censusRow('f.gov', '2026-08-22T06:10:00Z'),
    ]);
    const report = await verifyRecord(file, LIMITS, frame);
    const check = report.checks.find((c) => c.name === 'census coverage')!;
    assert.equal(check.pass, true, check.detail);
    assert.match(check.detail, /1\/3 slices/, 'must say how much of the cycle has run');
    assert.ok(
      !check.detail.includes('b.gov') && !check.detail.includes('c.gov'),
      `a slice that has not run yet is not a miss: ${check.detail}`,
    );
  });

  test('hot-tier rows are not counted toward census coverage', async () => {
    // The hot tier checks 58 curated hosts hourly. Counting those toward a census
    // cycle would inflate coverage with domains the census never reached.
    const file = await writeRecord([
      censusRow('a.gov', '2026-08-22T06:00:00Z'),
      censusRow('f.gov', '2026-08-22T06:10:00Z'),
      row({ tier: 'hot', target_id: 'irs-gov', checked_at: '2026-08-22T07:00:00Z' }),
    ]);
    const report = await verifyRecord(file, LIMITS, frame);
    const check = report.checks.find((c) => c.name === 'census coverage')!;
    assert.match(check.detail, /2\/2 domains/);
    assert.ok(!check.detail.includes('irs-gov'), check.detail);
  });

  test('is skipped, not failed, when no frame is supplied', async () => {
    // `verify` runs against records that predate the census. Absence of a frame
    // is absence of a question, not a failed answer.
    const file = await writeRecord([row()]);
    const report = await verifyRecord(file, LIMITS);
    assert.equal(report.ok, true);
    assert.ok(!report.checks.some((c) => c.name === 'census coverage'));
  });
});
