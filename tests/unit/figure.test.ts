import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { figure, formatFigure, absence } from '../../src/site/figure.js';

/**
 * The Figure is the choke point for Principle V. There is no other numeric type
 * in the view model, and the renderer accepts nothing else — so the only way to
 * publish a quantity is to state its method, and the unmethodded case is
 * unrepresentable rather than discouraged.
 *
 * This shape is a response to this project's own history: twice a stated
 * constraint had no test and had already drifted. A convention is obeyed until
 * someone is in a hurry.
 */
describe('a Figure cannot exist without its method (FR-201, FR-251)', () => {
  const whole = {
    value: 99.2,
    unit: 'percent' as const,
    tier: 'hot' as const,
    population: 58,
    window: { from: '2026-08-01T00:00:00Z', to: '2026-08-24T00:00:00Z' },
    samples: 2955,
    vantage: 'github-actions/ubuntu-24.04',
  };

  test('constructs when every part of the method is present', () => {
    const f = figure(whole);
    assert.equal(f.value, 99.2);
    assert.equal(f.tier, 'hot');
    assert.equal(f.vantage, 'github-actions/ubuntu-24.04');
  });

  for (const missing of ['tier', 'population', 'window', 'samples', 'vantage'] as const) {
    test(`refuses construction without ${missing}`, () => {
      const partial: Record<string, unknown> = { ...whole };
      delete partial[missing];
      assert.throws(
        () => figure(partial as never),
        new RegExp(missing),
        `a figure without its ${missing} is a number without a method — an accusation`,
      );
    });
  }

  test('refuses an empty vantage', () => {
    // An empty string satisfies a type checker and says nothing. The vantage
    // must come from the rows, and rows always carry one.
    assert.throws(() => figure({ ...whole, vantage: '' }), /vantage/);
  });

  test('refuses a window running backwards', () => {
    assert.throws(
      () => figure({ ...whole, window: { from: whole.window.to, to: whole.window.from } }),
      /window/,
    );
  });

  test('refuses a value carried by zero samples', () => {
    // A measured nothing is absence, not a figure. Zero samples with a value
    // would be a number conjured from no readings at all.
    assert.throws(() => figure({ ...whole, samples: 0 }), /samples/);
  });

  test('refuses a population of zero', () => {
    assert.throws(() => figure({ ...whole, population: 0 }), /population/);
  });
});

describe('rendering a figure keeps the method adjacent (FR-201)', () => {
  const f = figure({
    value: 99.2,
    unit: 'percent',
    tier: 'hot',
    population: 58,
    window: { from: '2026-08-01T00:00:00Z', to: '2026-08-24T00:00:00Z' },
    samples: 2955,
    vantage: 'github-actions/ubuntu-24.04',
  });

  test('the emitted string carries every part of the method', () => {
    const html = formatFigure(f);
    assert.match(html, /99\.2/);
    for (const part of ['58', 'hourly|hot', '2955', 'github-actions', '2026-08-01', '2026-08-24']) {
      assert.match(html, new RegExp(part), `method part ${part} must appear with the number`);
    }
  });

  test('absence renders as absence — never zero, never blank (FR-204)', () => {
    const html = formatFigure(absence('no readings in this period'));
    assert.doesNotMatch(html, /\b0(\.0)?%/, 'zero reads as "measured, and it was nothing"');
    assert.match(html, /no readings/i);
    assert.notEqual(html.trim(), '');
  });
});
