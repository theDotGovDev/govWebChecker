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

/**
 * The census fields.
 *
 * All optional, because the record is append-only and rows written before this
 * feature must stay valid without being rewritten (FR-136, FR-142). Optional is
 * not the same as unchecked: a malformed value is rejected, because the point of
 * these fields is to be readable by someone who does not trust our code.
 */
describe('census fields on the observation', () => {
  test('a row carrying none of them is still valid', () => {
    assert.deepEqual(validateObservation(wellFormed()), []);
  });

  test('a fully populated census row validates', () => {
    const row = {
      ...wellFormed(),
      tier: 'broad',
      cycle: '2026-W34',
      slice: 3,
      url_rule: 'canonical/1',
      resolution: { status: 'address', apex: true, www: true },
      presence: { state: 'website', rule: 'presence/1' },
    };
    assert.deepEqual(validateObservation(row), []);
  });

  test('rejects a tier outside the known set', () => {
    const problems = validateObservation({ ...wellFormed(), tier: 'medium' });
    assert.ok(problems.some((p) => p.includes('tier')), problems.join('; '));
  });

  test('rejects a slice outside 0..6', () => {
    for (const slice of [-1, 7, 1.5, '3']) {
      const problems = validateObservation({ ...wellFormed(), slice });
      assert.ok(problems.some((p) => p.includes('slice')), `slice ${slice}: ${problems.join('; ')}`);
    }
  });

  test('rejects a resolution status outside its enumeration', () => {
    // An unrecognised status is a verdict nobody can interpret. Letting it
    // through would put a value in the published record that no reader — and no
    // later version of us — can map back to what was observed.
    const problems = validateObservation({
      ...wellFormed(),
      resolution: { status: 'probably_fine', apex: true, www: true },
    });
    assert.ok(problems.some((p) => p.includes('resolution.status')), problems.join('; '));
  });

  test('rejects a presence state outside its enumeration', () => {
    const problems = validateObservation({
      ...wellFormed(),
      presence: { state: 'up', rule: 'presence/1' },
    });
    assert.ok(problems.some((p) => p.includes('presence.state')), problems.join('; '));
  });

  test('a presence reading must say which rule produced it', () => {
    // Without the version, a reading cannot be recomputed or superseded, and
    // FR-119's guarantee that history survives a better rule is void.
    const problems = validateObservation({
      ...wellFormed(),
      presence: { state: 'website' },
    });
    assert.ok(problems.some((p) => p.includes('presence.rule')), problems.join('; '));
  });

  test('presence stays out of outcome', () => {
    // FR-117: outcome is a statement about the protocol and nothing more.
    // Whether a website appears to exist is a reading of those facts, not one of
    // them, and must never become an outcome value.
    for (const outcome of ['no_website', 'absent', 'undetermined']) {
      const problems = validateObservation({ ...wellFormed(), outcome });
      assert.ok(problems.some((p) => p.includes('outcome')), `${outcome} must not be an outcome`);
    }
  });
});
