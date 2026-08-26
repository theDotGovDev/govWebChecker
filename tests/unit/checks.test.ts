import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { checksFor, CHECKS, type PlainCheck } from '../../src/site/checks.js';
import { RULES } from '../../src/site/interpret.js';
import type { DeepReading } from '../../src/quality/deep-check.js';

function reading(metrics: Record<string, number>, overrides: Partial<DeepReading> = {}): DeepReading {
  const units: Record<string, string> = { cumulative_layout_shift: 'unitless', total_byte_weight: 'byte' };
  return {
    schema: 'govwebchecker/quality/1',
    run_id: 'r', target_id: 'example-gov', host: 'example.gov', url: 'https://example.gov/',
    dimension: 'quality', checked_at: '2026-08-25T10:00:00Z', outcome: 'measured',
    metrics: Object.fromEntries(
      Object.entries(metrics).map(([k, v]) => [k, { value: v, unit: units[k] ?? 'millisecond' }]),
    ),
    method: {
      tool: 'lighthouse', tool_version: '13.4.1', preset: 'lighthouse:default/mobile',
      device: { form_factor: 'mobile', width: 412, height: 823, scale: 1.75, mobile: true },
      network: { rtt_ms: 150, throughput_kbps: 1638.4, cpu_slowdown: 4, method: 'simulate' },
      vantage: 'github-actions/Linux', source: 'self_run',
    },
    ...overrides,
  };
}

const FAST = {
  largest_contentful_paint: 1900, cumulative_layout_shift: 0.02,
  total_blocking_time: 90, speed_index: 2400, first_contentful_paint: 1200,
  time_to_interactive: 2600, server_response_time: 300,
};

/**
 * FR-330: a check is a stated threshold over one recorded measurement, with the
 * threshold and its source published beside the result. Not a rating we assign —
 * a line someone else drew, applied to a number we took, both shown.
 */
describe('every plain check names its threshold and where it came from (FR-330)', () => {
  test('a check carries the measurement, the threshold and the citation', () => {
    const checks = checksFor(reading(FAST));
    for (const check of checks) {
      assert.ok(check.question.length > 10, 'a check asks something a reader recognises');
      assert.doesNotMatch(check.question, /\bms\b|LCP|CLS|TBT|TTFB|percentile/i,
        `a check must not restate the jargon it exists to replace: "${check.question}"`);
      if (check.state === 'not_evaluated') continue;
      assert.ok(check.threshold.length > 3, `${check.id} must state the line it was judged against`);
      assert.ok(check.source.length > 8, `${check.id} must cite who drew that line`);
      assert.equal(typeof check.measured!.value, 'number');
    }
  });

  test('the thresholds are the published ones, at their exact boundaries', () => {
    const at = (metric: string, value: number) =>
      checksFor(reading({ [metric]: value })).find((c: PlainCheck) => c.id === metric)!.state;
    // web.dev Core Web Vitals: LCP good <= 2500ms; CLS good <= 0.1.
    assert.equal(at('largest_contentful_paint', 2500), 'passes');
    assert.equal(at('largest_contentful_paint', 2501), 'does_not_pass');
    assert.equal(at('cumulative_layout_shift', 0.1), 'passes');
    assert.equal(at('cumulative_layout_shift', 0.11), 'does_not_pass');
    // Lighthouse metric scoring: TBT good <= 200ms.
    assert.equal(at('total_blocking_time', 200), 'passes');
    assert.equal(at('total_blocking_time', 201), 'does_not_pass');
  });
});

/**
 * FR-331: three states, and the third never collapses into the second. A page we
 * did not measure is not a page that failed — that is the absence-is-not-failure
 * rule, applied to checks.
 */
describe('a check has three states and never reads absence as failure (FR-331)', () => {
  test('a metric that was never measured is not evaluated, not failed', () => {
    const partial = checksFor(reading({ largest_contentful_paint: 1900 }));
    const cls = partial.find((c: PlainCheck) => c.id === 'cumulative_layout_shift')!;
    assert.equal(cls.state, 'not_evaluated');
    assert.equal(cls.measured, undefined, 'there is no number to show, and none is invented');
    assert.match(cls.detail, /not measured|no reading|nothing/i);
  });

  test('a check that could not run is not evaluated for every check', () => {
    const failed = checksFor(reading({}, {
      outcome: 'check_failed', check_failure: 'NO_FCP: page did not paint',
    }));
    assert.ok(failed.length > 0, 'the checks are still listed — a reader sees what was not answered');
    assert.ok(failed.every((c: PlainCheck) => c.state === 'not_evaluated'));
    assert.ok(failed.some((c: PlainCheck) => /NO_FCP|did not paint/.test(c.detail)),
      'and why: a blank column is not an explanation');
  });

  test('the three states are exactly these, with no fourth for "sort of"', () => {
    const states = new Set(checksFor(reading(FAST)).map((c: PlainCheck) => c.state));
    for (const state of states) {
      assert.ok(['passes', 'does_not_pass', 'not_evaluated'].includes(state), state);
    }
  });
});

/**
 * FR-332 as amended by D3: a composite is permitted as analysis, but the parts
 * must stay visible wherever it appears — so the reader can disagree with the
 * weighting rather than having to accept it.
 */
describe('the parts stay visible (FR-332, D3)', () => {
  test('every check is backed by a rule that is versioned and cited', () => {
    for (const id of CHECKS) {
      const rule = RULES[id];
      assert.ok(rule, `${id} must have a published rule, not an opinion`);
      assert.match(rule!.version, /\/\d+$/, `${id} must be versioned like presence/1`);
      assert.ok(rule!.source.length > 8, `${id} must cite where its threshold came from`);
    }
  });

  test('a measurement with no defensible published threshold gets no check', () => {
    // Page weight has no threshold anyone has published as a pass/fail line, so
    // inventing one would make an opinion indistinguishable from a measurement.
    const checks = checksFor(reading({ ...FAST, total_byte_weight: 4_000_000 }));
    assert.ok(!checks.some((c: PlainCheck) => c.id === 'total_byte_weight'));
  });

  test('the summary counts the checks without hiding which ones', () => {
    const checks = checksFor(reading({ ...FAST, largest_contentful_paint: 6000 }));
    const passed = checks.filter((c: PlainCheck) => c.state === 'passes').length;
    const failed = checks.filter((c: PlainCheck) => c.state === 'does_not_pass');
    assert.equal(failed.length, 1);
    assert.equal(failed[0]!.id, 'largest_contentful_paint');
    assert.ok(passed >= 5);
  });
});
