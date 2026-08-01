import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { appendObservation, recordPathFor } from '../../src/record/writer.js';
import type { Observation } from '../../src/record/types.js';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gwc-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function observation(overrides: Partial<Observation> = {}): Observation {
  return {
    schema: '1',
    run_id: 'run-1',
    target_id: 'irs-gov',
    host: 'www.irs.gov',
    url: 'https://www.irs.gov/',
    dimension: 'availability',
    checked_at: '2026-07-31T06:04:51Z',
    outcome: 'success',
    status_code: 200,
    redirect_chain: [],
    latency: { samples: 1, median_ms: 100, min_ms: 100, max_ms: 100 },
    method: {
      vantage: 'test',
      timeout_ms: 15_000,
      sample_count: 1,
      tool_version: '0.1.0',
      source: 'self_run',
    },
    ...overrides,
  };
}

describe('record writer', () => {
  test('partitions by dimension and month, from checked_at', () => {
    assert.equal(
      recordPathFor('/data', observation()),
      path.join('/data', 'availability', '2026-07.jsonl'),
    );
    assert.equal(
      recordPathFor('/data', observation({ checked_at: '2026-12-01T00:00:00Z' })),
      path.join('/data', 'availability', '2026-12.jsonl'),
    );
  });

  test('creates the file and its directory on first write', async () => {
    await appendObservation(dir, observation());
    const written = await fs.readFile(path.join(dir, 'availability', '2026-07.jsonl'), 'utf8');
    assert.equal(written.trimEnd().split('\n').length, 1);
    assert.deepEqual(JSON.parse(written.trim()), observation());
  });

  test('appends rather than replacing (FR-017)', async () => {
    await appendObservation(dir, observation({ target_id: 'first' }));
    await appendObservation(dir, observation({ target_id: 'second' }));
    const file = path.join(dir, 'availability', '2026-07.jsonl');
    const lines = (await fs.readFile(file, 'utf8')).trimEnd().split('\n');
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[0]!).target_id, 'first');
    assert.equal(JSON.parse(lines[1]!).target_id, 'second');
  });

  test('re-writing an identical observation appends, never deduplicates', async () => {
    // A correction is a new observation superseding the old one. Silently
    // collapsing duplicates would be an edit of history by another name.
    await appendObservation(dir, observation());
    await appendObservation(dir, observation());
    const file = path.join(dir, 'availability', '2026-07.jsonl');
    const lines = (await fs.readFile(file, 'utf8')).trimEnd().split('\n');
    assert.equal(lines.length, 2);
  });

  test('a previously written line is byte-identical after later writes', async () => {
    await appendObservation(dir, observation({ target_id: 'first' }));
    const file = path.join(dir, 'availability', '2026-07.jsonl');
    const before = (await fs.readFile(file, 'utf8')).split('\n')[0]!;
    await appendObservation(dir, observation({ target_id: 'second' }));
    const after = (await fs.readFile(file, 'utf8')).split('\n')[0]!;
    assert.equal(after, before);
  });

  test('each line is independently parseable', async () => {
    await appendObservation(dir, observation({ target_id: 'a' }));
    await appendObservation(dir, observation({ target_id: 'b', outcome: 'timeout' }));
    const file = path.join(dir, 'availability', '2026-07.jsonl');
    for (const line of (await fs.readFile(file, 'utf8')).trimEnd().split('\n')) {
      assert.doesNotThrow(() => JSON.parse(line));
    }
  });

  test('writes no newline inside a record', async () => {
    await appendObservation(dir, observation({ target_id: 'multi\nline' }));
    const file = path.join(dir, 'availability', '2026-07.jsonl');
    const lines = (await fs.readFile(file, 'utf8')).trimEnd().split('\n');
    assert.equal(lines.length, 1, 'a record containing a newline must not split a line');
  });

  test('refuses to write an invalid observation', async () => {
    const bad = { ...observation(), outcome: 'not_a_real_outcome' } as unknown as Observation;
    await assert.rejects(() => appendObservation(dir, bad));
  });
});
