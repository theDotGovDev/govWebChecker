import type { DeepReading } from '../quality/deep-check.js';
import { RULES, interpret, type Band } from './interpret.js';
import { figure, type Figure } from './figure.js';

/**
 * Turning readings into the plain checks a reader can scan.
 *
 * A check here is never a rating this project assigns. It is a line somebody
 * else published, applied to a number we took, with both shown — which is the
 * only form in which "this site does not pass" is a claim rather than an opinion
 * (FR-330).
 *
 * Three states, and the third does not collapse into the second. A page we did
 * not measure is not a page that failed; that distinction is the whole of
 * Principle V's absence rule, applied to a checkbox where it is easiest to lose.
 */
export type CheckState = 'passes' | 'does_not_pass' | 'not_evaluated';

export interface PlainCheck {
  /** The metric this check reads, which is also the rule's key. */
  id: string;
  /** What is being asked, in words a reader recognises. Never the metric's name. */
  question: string;
  state: CheckState;
  /** The published line this was judged against. Empty when nothing was judged. */
  threshold: string;
  /** Who drew that line. Never us. */
  source: string;
  /** The versioned rule, so a threshold change is visible rather than a silent shift. */
  rule: string;
  /** A sentence saying what the state means for a visitor, or why nothing was judged. */
  detail: string;
  /** The measurement itself. Absent when there was none — never a zero. */
  measured?: Figure;
  band?: Band;
}

/**
 * The measures published as checks, in the order a reader meets them.
 *
 * Page weight is deliberately absent: nobody has published a pass/fail line for
 * it that we could cite, and inventing one would make an opinion
 * indistinguishable from a measurement (FR-302). It is still measured, still
 * stored, and still shown as a number — just not as a verdict.
 */
export const CHECKS = [
  'first_contentful_paint',
  'largest_contentful_paint',
  'speed_index',
  'cumulative_layout_shift',
  'total_blocking_time',
  'time_to_interactive',
  'server_response_time',
] as const;

/**
 * The reader-facing question each check answers.
 *
 * Phrased as a question rather than a metric name because that is the actual
 * translation: "Largest Contentful Paint: 2,412 ms" tells most people nothing,
 * and "Does the page appear quickly?" tells them what was asked before they see
 * how it came out.
 */
const QUESTIONS: Record<string, string> = {
  first_contentful_paint: 'Does anything appear quickly?',
  largest_contentful_paint: 'Does the main content appear quickly?',
  speed_index: 'Does the page fill in quickly?',
  cumulative_layout_shift: 'Does the page hold still while it loads?',
  total_blocking_time: 'Does the page respond to taps right away?',
  time_to_interactive: 'Is the page usable quickly?',
  server_response_time: 'Does the server answer quickly?',
};

/** The tool's unit names, mapped to the ones the site publishes in. */
const METRIC_UNITS: Record<string, 'milliseconds' | 'unitless' | 'bytes'> = {
  millisecond: 'milliseconds',
  unitless: 'unitless',
  byte: 'bytes',
};

function unevaluated(id: string, detail: string): PlainCheck {
  const rule = RULES[id];
  return {
    id,
    question: QUESTIONS[id] ?? id,
    state: 'not_evaluated',
    threshold: '',
    source: rule?.source ?? '',
    rule: rule?.version ?? '',
    detail,
  };
}

/**
 * Builds the checks for one deep reading.
 *
 * A reading that failed still produces the full list, every entry not evaluated
 * and carrying the reason. Dropping the rows instead would leave a reader
 * looking at a shorter list with no way to tell a check that passed from a check
 * that never ran — which is the same error as reading absence as zero, just
 * spelled with whitespace.
 */
export function checksFor(reading: DeepReading): PlainCheck[] {
  return CHECKS.map((id) => {
    if (reading.outcome !== 'measured') {
      const why =
        reading.outcome === 'skipped'
          ? (reading.skip_reason ?? 'no check was attempted')
          : (reading.check_failure ?? 'the check produced no reading');
      return unevaluated(id, `Nothing was measured: ${why}.`);
    }

    const metric = reading.metrics[id];
    if (!metric) {
      return unevaluated(id, 'This was not measured on this page, so nothing is claimed about it.');
    }

    const measured = figure({
      value: metric.value,
      // The tool names units in the singular; the Figure names them as the site
      // reads them out. Anything else the tool reports is refused rather than
      // guessed at, because a mislabelled unit is a wrong number.
      unit: METRIC_UNITS[metric.unit] ?? 'unitless',
      tier: 'hot',
      population: 1,
      window: { from: reading.checked_at, to: reading.checked_at },
      samples: 1,
      vantage: reading.method.vantage,
    });

    const reader = interpret(measured, id);
    if (!reader) {
      return unevaluated(id, 'No published threshold exists for this, so nothing is claimed about it.');
    }

    return {
      id,
      question: QUESTIONS[id] ?? id,
      // A band has three levels; a check has two. "Fair" is not a pass: the
      // published line for passing is the good band, and softening that here
      // would quietly move a threshold we did not draw.
      state: reader.band === 'good' ? 'passes' : 'does_not_pass',
      threshold: reader.threshold,
      source: reader.source,
      rule: reader.version,
      detail: reader.plain,
      measured,
      band: reader.band,
    } satisfies PlainCheck;
  });
}
