import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { validateObservation } from '../../src/record/validate.js';
import type { Observation } from '../../src/record/types.js';

function wellFormed(): Observation {
  return {
    schema: '1',
    run_id: '2026-07-31T06:00:12Z/availability',
    target_id: 'irs-gov',
    host: 'www.irs.gov',
    url: 'https://www.irs.gov/',
    dimension: 'availability',
    checked_at: '2026-07-31T06:04:51Z',
    outcome: 'success',
    status_code: 200,
    redirect_chain: [],
    latency: { samples: 3, median_ms: 412, min_ms: 388, max_ms: 509 },
    method: {
      vantage: 'test',
      timeout_ms: 15_000,
      sample_count: 3,
      tool_version: '0.1.0',
      source: 'self_run',
    },
  };
}

describe('observation record contract', () => {
  test('a well-formed observation validates', () => {
    assert.deepEqual(validateObservation(wellFormed()), []);
  });

  test('method is required on every row, including failures (FR-014)', () => {
    const { method, ...withoutMethod } = wellFormed();
    void method;
    const problems = validateObservation(withoutMethod);
    assert.ok(
      problems.some((p) => /method/.test(p)),
      'a row without its method is unusable — Principle V',
    );
  });

  test('a failure row is a complete observation, not an abbreviated one', () => {
    const failure: Observation = {
      ...wellFormed(),
      outcome: 'timeout',
      latency: { samples: 0 },
    };
    delete (failure as { status_code?: number }).status_code;
    assert.deepEqual(validateObservation(failure), []);
  });

  test('rejects an unknown outcome (FR-013 is a closed set)', () => {
    const bad = { ...wellFormed(), outcome: 'probably_fine' };
    assert.ok(validateObservation(bad).length > 0);
  });

  test('rejects a verdict field', () => {
    const withVerdict = { ...wellFormed(), up: true };
    const problems = validateObservation(withVerdict);
    assert.ok(
      problems.some((p) => /verdict|up\b/.test(p)),
      'the record stores what happened, never whether it counts as healthy',
    );
  });

  test('rejects a stored page body (FR-015)', () => {
    const withBody = { ...wellFormed(), body: '<html>...</html>' };
    assert.ok(validateObservation(withBody).length > 0);
  });

  test('rejects latency of zero standing in for no measurement', () => {
    const zeroed = { ...wellFormed(), latency: { samples: 0, median_ms: 0 } };
    assert.ok(
      validateObservation(zeroed).length > 0,
      'absence of data must read as absence, never as zero (Principle V)',
    );
  });

  test('requires checked_at to be UTC', () => {
    const local = { ...wellFormed(), checked_at: '2026-07-31T06:04:51+02:00' };
    assert.ok(validateObservation(local).length > 0);
  });
});
