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
    cadence: 'hourly' as const,
    population: 58,
    window: { from: '2026-08-01T00:00:00Z', to: '2026-08-24T00:00:00Z' },
    samples: 2955,
    vantage: 'github-actions/ubuntu-24.04',
  };

  test('constructs when every part of the method is present', () => {
    const f = figure(whole);
    assert.equal(f.value, 99.2);
    assert.equal(f.cadence, 'hourly');
    assert.equal(f.vantage, 'github-actions/ubuntu-24.04');
  });

  for (const missing of ['cadence', 'population', 'window', 'samples', 'vantage'] as const) {
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
    cadence: 'hourly',
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

/**
 * The deep-check metrics brought two units the site had never published: a ratio
 * with no unit at all (layout shift) and a size in bytes. Both are measurements
 * and both must go through the same choke point — a quantity that could not be a
 * Figure would be a quantity published without its method.
 */
describe('the units the deep readings measure in', () => {
  const base = {
    cadence: 'hourly' as const,
    population: 1,
    window: { from: '2026-08-25T00:00:00Z', to: '2026-08-25T00:00:00Z' },
    samples: 1,
    vantage: 'github-actions/test',
  };

  test('a unitless ratio keeps the precision that makes it meaningful', () => {
    const html = formatFigure(figure({ ...base, value: 0.021, unit: 'unitless' }));
    assert.match(html, /0\.021/, 'rounding a layout-shift score to a whole number erases it entirely');
    assert.match(html, /class="method"/, 'and it still carries its method');
  });

  test('a size in bytes is published in units a reader thinks in', () => {
    const html = formatFigure(figure({ ...base, value: 2_400_000, unit: 'bytes' }));
    assert.match(html, /2\.3 MB|2\.4 MB/, `bytes should read as megabytes: ${html}`);
  });

  test('a small size still reads sensibly', () => {
    assert.match(formatFigure(figure({ ...base, value: 1426, unit: 'bytes' })), /1\.4 KB/);
  });
});

/**
 * A figure states the cadence it was taken at, and the deep quality readings are
 * not taken hourly.
 *
 * Found on the first real build: every quality figure read "checked hourly"
 * because the model constructed it with the hourly tier, when the deep check
 * runs once a day. D4 made cadence a property of the reading precisely so a
 * figure's meaning could not drift from how it was collected — a daily reading
 * described as hourly is a false method, which Principle V forbids more plainly
 * than it forbids almost anything else.
 */
describe('a figure cannot claim a cadence it was not taken at (Principle V, D4)', () => {
  const base = {
    population: 1,
    window: { from: '2026-08-25T00:00:00Z', to: '2026-08-25T00:00:00Z' },
    samples: 1,
    vantage: 'github-actions/test',
  };

  test('a daily reading says daily, not hourly', () => {
    const html = formatFigure(figure({ ...base, value: 6512, unit: 'milliseconds', cadence: 'daily' }));
    assert.match(html, /daily target/);
    assert.doesNotMatch(html, /hourly|weekly/,
      'a deep quality reading is taken once a day; saying hourly overstates it 24-fold');
  });

  test('the cadences stay distinct from one another', () => {
    const cadences = (['hourly', 'weekly', 'daily'] as const).map((cadence) =>
      formatFigure(figure({ ...base, value: 1, unit: 'count', cadence })).match(/\w+ target/)![0],
    );
    assert.equal(new Set(cadences).size, 3,
      `two populations sharing a cadence phrase would read as one: ${cadences.join(', ')}`);
  });
});

/**
 * A cadence is what we aim for, not what we achieved.
 *
 * The site said "checked hourly" as a bare fact. It was never a fact: it was a
 * cron expression, and GitHub delivers scheduled events on a best-effort basis.
 * Over 2026-08-26/27 the hourly schedule fired twice in fifteen hours, and for
 * eight hours it fired not at all — while the page went on telling readers each
 * site was checked hourly.
 *
 * This is the same defect as the one below it in this file, one level up: there
 * the *field* was misnamed and a daily reading claimed hourly; here the field is
 * right and the *world* does not comply. Both publish a number whose stated
 * method is not the method that produced it, which Principle V forbids.
 *
 * The fix is that the label reports rather than asserts. The observed interval
 * is computed from the figure's own published parts — window, samples,
 * population — so it cannot drift from the readings it describes, and a reader
 * can check it with arithmetic on numbers already in front of them.
 */
describe('a cadence is a target, and the figure says what actually happened', () => {
  const base = {
    value: 99.2,
    unit: 'percent' as const,
    population: 58,
    vantage: 'github-actions/ubuntu-24.04',
  };

  test('never states a cadence as an accomplished fact', () => {
    const html = formatFigure(
      figure({
        ...base,
        cadence: 'hourly',
        window: { from: '2026-08-01T00:00:00Z', to: '2026-08-02T00:00:00Z' },
        samples: 58 * 25,
      }),
    );
    assert.doesNotMatch(
      html,
      /checked hourly/,
      'the schedule is a request to GitHub, not a description of what happened',
    );
    assert.match(html, /hourly target/, 'the reader still needs to know what was aimed at');
  });

  test('reports the interval the readings actually arrived at', () => {
    // 58 sites, 3 readings each, across 15 hours: 2 gaps per site, 7h30m apart.
    const html = formatFigure(
      figure({
        ...base,
        cadence: 'hourly',
        window: { from: '2026-08-27T05:00:00Z', to: '2026-08-27T20:00:00Z' },
        samples: 58 * 3,
      }),
    );
    assert.match(html, /a reading every 7h 30m/, html);
  });

  test('an interval close to the target still reports what it measured', () => {
    // 58 sites, 25 readings each across 24h — 23 gaps, ~62m apart.
    const html = formatFigure(
      figure({
        ...base,
        cadence: 'hourly',
        window: { from: '2026-08-01T00:00:00Z', to: '2026-08-02T00:00:00Z' },
        samples: 58 * 25,
      }),
    );
    assert.match(html, /a reading every 1h 0m/, html);
  });

  test('states no interval when there is only one reading per site to space', () => {
    // The census: one reading per domain per cycle. There is no gap to measure,
    // and inventing one from a single reading would be reading absence as data.
    const html = formatFigure(
      figure({
        ...base,
        cadence: 'weekly',
        population: 16535,
        window: { from: '2026-08-20T00:00:00Z', to: '2026-08-27T00:00:00Z' },
        samples: 16535,
      }),
    );
    assert.match(html, /weekly target/);
    assert.doesNotMatch(html, /a reading every/, 'one reading per site spaces nothing');
  });
});

/**
 * The largest gap, because a mean interval hides exactly the failure it should
 * expose.
 *
 * The figures report "a reading every 1h 26m", computed as window ÷ gaps. On the
 * real record the median gap is 1h02 and the largest is 41h — a mean that reads
 * as healthy hourly sampling while a site went unmeasured for the better part of
 * two days. Sampling quality is judged on the worst gap, not the average one, so
 * the average alone is a method that flatters the measurement.
 */
describe('a figure reports its worst gap, not just its average one', () => {
  const base = {
    value: 99.2,
    unit: 'percent' as const,
    cadence: 'hourly' as const,
    population: 58,
    vantage: 'github-actions/ubuntu-24.04',
    window: { from: '2026-08-01T00:00:00Z', to: '2026-08-02T00:00:00Z' },
    samples: 58 * 25,
  };

  test('names the longest gap when the model knows it', () => {
    const html = formatFigure(figure({ ...base, largestGapMs: 41 * 3_600_000 }));
    assert.match(html, /longest gap 41h/, html);
  });

  test('a bursty sampler cannot hide behind its average', () => {
    // The average says hourly; the worst gap says a day and a half went
    // unmeasured. Both are true and only one of them is the warning.
    const html = formatFigure(figure({ ...base, largestGapMs: 41 * 3_600_000 }));
    assert.match(html, /a reading every 1h 0m/, 'the typical interval still shows');
    assert.match(html, /longest gap/, 'and so does the tail it conceals');
  });

  test('says nothing about gaps it was not given', () => {
    // Absence of the field is absence of the question, not a gap of zero.
    const html = formatFigure(figure(base));
    assert.doesNotMatch(html, /longest gap/);
  });

  test('a gap no larger than the typical interval is not worth naming', () => {
    // Evenly spaced readings have a worst gap equal to their average, and
    // printing it twice tells a reader nothing.
    const html = formatFigure(figure({ ...base, largestGapMs: 3_600_000 }));
    assert.doesNotMatch(html, /longest gap/, 'even sampling has no tail to report');
  });
})
