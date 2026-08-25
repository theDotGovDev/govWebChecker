import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { interpret, RULES, type Band } from '../../src/site/interpret.js';
import { figure } from '../../src/site/figure.js';

function ms(value: number) {
  return figure({
    value,
    unit: 'milliseconds',
    tier: 'hot',
    population: 1,
    window: { from: '2026-08-01T00:00:00Z', to: '2026-08-24T00:00:00Z' },
    samples: 100,
    vantage: 'github-actions/test',
  });
}

/**
 * "482 ms" tells a resident of Alamosa nothing. They do not know whether that is
 * good, and the page did not say. A number a reader cannot interpret is not
 * information — it is decoration shaped like information.
 *
 * The fix is not to hide the number. It is to say what it means, name the
 * threshold that decides it, and cite where the threshold came from — so the
 * reading is checkable rather than an opinion we assert (FR-301, FR-302).
 */
describe('a measurement is published with what it means (FR-301, FR-302)', () => {
  test('a fast server response reads as fast, with its threshold and source', () => {
    const r = interpret(ms(180), 'server_response')!;
    assert.equal(r.band, 'good');
    assert.match(r.label, /fast/i);
    assert.match(r.threshold, /800/, 'the number that decided the band is stated');
    assert.match(r.source, /web\.dev|Google|Core Web Vitals/i, 'the standard is cited, not invented');
  });

  test('the bands follow the published thresholds exactly at their boundaries', () => {
    // web.dev TTFB guidance: good <= 800ms, needs improvement <= 1800ms, poor above.
    assert.equal(interpret(ms(800), 'server_response')!.band, 'good');
    assert.equal(interpret(ms(801), 'server_response')!.band, 'fair');
    assert.equal(interpret(ms(1800), 'server_response')!.band, 'fair');
    assert.equal(interpret(ms(1801), 'server_response')!.band, 'poor');
  });

  test('every band carries a plain-language label a non-technical reader can act on', () => {
    for (const value of [100, 1000, 3000]) {
      const r = interpret(ms(value), 'server_response')!;
      assert.doesNotMatch(r.label, /\bms\b|millisecond|TTFB|latency/i,
        `the label must not restate the jargon it exists to replace: "${r.label}"`);
      assert.ok(r.label.length > 3);
      assert.ok(r.plain.length > 20, 'a sentence a reader can act on, not a word');
    }
  });

  test('a measure with no defensible standard gets no band rather than an invented one', () => {
    // FR-302: an invented threshold is indistinguishable from an opinion.
    const answered = figure({
      value: 79.6,
      unit: 'percent',
      tier: 'hot',
      population: 58,
      window: { from: '2026-08-01T00:00:00Z', to: '2026-08-24T00:00:00Z' },
      samples: 3538,
      vantage: 'github-actions/test',
    });
    assert.equal(interpret(answered, 'unbanded_measure' as never), undefined);
  });

  test('every rule is versioned and cites a source, so a band is recomputable and checkable', () => {
    for (const [name, rule] of Object.entries(RULES)) {
      assert.match(rule.version, /\/\d+$/, `${name} must be versioned like presence/1`);
      assert.ok(rule.source.length > 8, `${name} must cite where its threshold came from`);
      assert.ok(rule.what.length > 10, `${name} must say what it measures in plain words`);
      // Bands must be ordered and exhaustive.
      const bands: Band[] = rule.bands.map((b) => b.band);
      assert.deepEqual(bands, ['good', 'fair', 'poor'], `${name}: three bands, best first`);
    }
  });

  test('the interpretation never replaces the measurement (FR-303)', () => {
    const f = ms(482);
    const r = interpret(f, 'server_response')!;
    assert.equal(r.figure, f, 'the exact figure travels with its reading, always');
    assert.equal(r.figure.value, 482);
  });
});
