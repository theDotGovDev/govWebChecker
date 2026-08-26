import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validateQualityReading } from '../../src/record/quality.js';
import { appendQualityReading } from '../../src/record/writer.js';
import type { DeepReading } from '../../src/quality/deep-check.js';

function reading(overrides: Partial<DeepReading> = {}): DeepReading {
  return {
    schema: 'govwebchecker/quality/1',
    run_id: '2026-08-26T10:00:00Z/quality/abc12345',
    target_id: 'example-gov',
    host: 'example.gov',
    url: 'https://example.gov/',
    dimension: 'quality',
    checked_at: '2026-08-26T10:15:00Z',
    outcome: 'measured',
    metrics: {
      largest_contentful_paint: { value: 2412.3, unit: 'millisecond' },
      cumulative_layout_shift: { value: 0.021, unit: 'unitless' },
    },
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

/**
 * The gate on the availability record exists because the record is a published
 * product and a malformed row is a claim nobody can check. A deep reading makes a
 * *larger* claim from the same record, so it passes through a gate of its own
 * rather than being trusted because our own code produced it.
 */
describe('a quality reading is admitted only if it can be checked (Principle V)', () => {
  test('a well-formed reading is admitted', () => {
    assert.deepEqual(validateQualityReading(reading()), []);
  });

  test('a reading whose emulation is missing is refused', () => {
    const naked = reading();
    delete (naked.method as Partial<DeepReading['method']>).network;
    const problems = validateQualityReading(naked);
    assert.ok(problems.some((p: string) => /network/.test(p)),
      'a duration with no stated connection is not comparable to anything');
  });

  test('a reading carrying the tool\'s composite score is refused (D3)', () => {
    const derived = { ...reading(), score: 0.87 } as unknown;
    assert.ok(validateQualityReading(derived).some((p: string) => /score/.test(p)),
      'the record is the measured layer; a rollup here would be indistinguishable from an observation');
  });

  test('a metric with no unit is refused', () => {
    const r = reading({ metrics: { speed_index: { value: 3300 } as never } });
    assert.ok(validateQualityReading(r).some((p: string) => /unit/.test(p)));
  });

  test('a metric that is not a number is refused rather than coerced', () => {
    const r = reading({ metrics: { speed_index: { value: '3300' as never, unit: 'millisecond' } } });
    assert.ok(validateQualityReading(r).some((p: string) => /speed_index/.test(p)));
  });

  test('a failed check must say why, and must carry no metrics', () => {
    const silent = reading({ outcome: 'check_failed', metrics: {} });
    assert.ok(validateQualityReading(silent).some((p: string) => /why|reason|failure/i.test(p)),
      'a check that produced nothing must record what stopped it');

    const contradictory = reading({
      outcome: 'check_failed',
      check_failure: 'NO_FCP',
      metrics: { speed_index: { value: 3300, unit: 'millisecond' } },
    });
    assert.ok(validateQualityReading(contradictory).some((p: string) => /metric/.test(p)),
      'a reading cannot both have failed and have measured something');
  });

  test('a page body or a screenshot in the record is refused', () => {
    for (const field of ['body', 'html', 'screenshot', 'content']) {
      const r = { ...reading(), [field]: 'anything' };
      assert.ok(validateQualityReading(r).some((p: string) => new RegExp(field).test(p)),
        `${field} would persist the page rather than a measurement of it`);
    }
  });

  test('an availability outcome is refused in a quality reading (FR-324)', () => {
    for (const outcome of ['success', 'timeout', 'http_error', 'dns_failure']) {
      const r = reading({ outcome: outcome as never });
      assert.ok(validateQualityReading(r).length > 0,
        `"${outcome}" describes whether the site answered, which this reading does not know`);
    }
  });
});

describe('a quality reading is appended, never rewritten', () => {
  test('it lands in its own dimension, one line per reading', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'quality-record-'));
    try {
      await appendQualityReading(dir, reading());
      await appendQualityReading(dir, reading({ target_id: 'other-gov' }));
      const lines = (await fs.readFile(path.join(dir, 'quality', '2026-08.jsonl'), 'utf8'))
        .trim().split('\n');
      assert.equal(lines.length, 2);
      assert.equal((JSON.parse(lines[1]!) as DeepReading).target_id, 'other-gov');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  test('a reading that fails the gate is never written', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'quality-record-'));
    try {
      const bad = { ...reading(), score: 0.87 } as unknown as DeepReading;
      await assert.rejects(() => appendQualityReading(dir, bad), /score/);
      await assert.rejects(() => fs.readFile(path.join(dir, 'quality', '2026-08.jsonl'), 'utf8'));
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
