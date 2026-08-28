import type { Tier } from '../record/types.js';

/**
 * The only way this site expresses a published quantity.
 *
 * Principle V is NON-NEGOTIABLE: a published number carries its method. Rather
 * than promising that, the view model has no numeric type other than Figure, and
 * a Figure cannot be constructed without its tier, population, window, sample
 * count and vantage. The renderer accepts Figure, never number — so publishing a
 * bare number requires adding a new code path, not forgetting an argument.
 *
 * This shape is a response to the project's own history: `maxConcurrentHosts`
 * was "a stated constraint, not a tuning parameter" with nothing asserting it,
 * and the R8a seed rule was a comment that sabotage showed no test enforced. A
 * convention is obeyed until someone is in a hurry; a constructor is not.
 */
/**
 * How often a reading is taken. The site speaks in cadences, never in the
 * collection tiers that produced them (D4, FR-286).
 */
export type Cadence = 'hourly' | 'daily' | 'weekly';

export interface Figure {
  readonly value: number;
  /**
   * `unitless` is a real unit for a ratio like layout shift, which has no
   * dimension but is very much a measurement; `bytes` is stored raw and read out
   * in KB or MB, because a reader thinks in those and the record should not.
   */
  readonly unit: 'percent' | 'milliseconds' | 'count' | 'unitless' | 'bytes';
  /**
   * How often the readings behind this figure are taken.
   *
   * Named for the cadence rather than for the collection tier that produced it,
   * because that is what it means to a reader and what the page prints (D4,
   * FR-286). It was `tier` once, and the mismatch between the field's name and
   * its rendering is exactly what let every deep quality figure claim "checked
   * hourly" when the deep check runs once a day — a daily reading overstated
   * twenty-four-fold, on the first real build.
   *
   * Singular by construction: FR-220's no-blend guarantee is that a figure names
   * exactly one of these.
   */
  readonly cadence: Cadence;
  /** How many sites the figure covers. */
  readonly population: number;
  readonly window: { readonly from: string; readonly to: string };
  /** Readings behind the value. Zero readings cannot carry a value. */
  readonly samples: number;
  /** From the rows' `method.vantage`, never from configuration. */
  readonly vantage: string;
  /** The versioned rule that derived the reading, where one did (FR-205). */
  readonly rule?: string;
  /**
   * The longest interval between two consecutive readings behind this figure.
   *
   * Published alongside the average because the average hides exactly the
   * failure it should expose: on the real record the median gap is 1h02 and the
   * largest is 41h, so a mean of 1h26 reads as healthy hourly sampling while a
   * site went unmeasured for the better part of two days. Sampling quality is
   * judged on the worst gap, not the typical one.
   *
   * Optional because not every figure's model knows its history. Absence is
   * absence of the question, never a gap of zero (FR-204).
   */
  readonly largestGapMs?: number;
}

/**
 * A period with nothing measured. Deliberately not a Figure with value 0 — zero
 * reads as "measured, and it was nothing", which is the exact confusion FR-204
 * exists to prevent.
 */
export interface Absence {
  readonly kind: 'absence';
  readonly reason: string;
}

export function absence(reason: string): Absence {
  return { kind: 'absence', reason };
}

export function figure(parts: Figure): Figure {
  if (parts.cadence === undefined) throw new Error('a figure must state its cadence');
  if (!parts.population || parts.population <= 0) {
    throw new Error('a figure must state the population it covers');
  }
  if (!parts.window?.from || !parts.window.to) {
    throw new Error('a figure must state the window it covers');
  }
  if (parts.window.from > parts.window.to) {
    throw new Error(`a figure's window must run forward: ${parts.window.from} > ${parts.window.to}`);
  }
  if (!parts.samples || parts.samples <= 0) {
    throw new Error('a value carried by zero samples is a number conjured from no readings');
  }
  if (!parts.vantage) throw new Error('a figure must state its vantage');
  if (typeof parts.value !== 'number' || Number.isNaN(parts.value)) {
    throw new Error('a figure must carry a real value');
  }
  return Object.freeze({ ...parts });
}

/**
 * How the reading was taken, in the reader's terms rather than ours.
 *
 * D4 removed tiers as a category: there is one frame, and how often a domain is
 * checked is a property of the reading, not a class the reader has to learn
 * (FR-286). The record still carries `tier` as provenance for rows already
 * written — history is not rewritten — but the page says what it means.
 *
 * These strings are still what keeps two populations from being read as one, so
 * they must stay distinguishable: a figure names exactly one of them, and a test
 * fails if one ever names both.
 */
/**
 * The cadence names what the schedule *asks for*, never what it achieved.
 *
 * It used to read "checked hourly", which was never a fact — it was a cron
 * expression, and GitHub delivers scheduled events on a best-effort basis. Over
 * 2026-08-26/27 the hourly schedule fired twice in fifteen hours, and for eight
 * hours not at all, while the page went on telling readers each site was checked
 * hourly. A published number carrying a method that did not produce it is
 * precisely what Principle V forbids, so the label reports the target and lets
 * `observedInterval` say what arrived.
 */
const CADENCE_LABEL: Record<Cadence, string> = {
  hourly: 'hourly target',
  daily: 'daily target',
  weekly: 'weekly target',
};

/**
 * How far apart the readings behind this figure actually landed.
 *
 * Computed from the figure's own published parts rather than plumbed in
 * alongside them, which is the point: window, samples and population are already
 * on the page, so a reader can check this with arithmetic on numbers in front of
 * them, and it cannot drift from the readings it describes the way an asserted
 * cadence did.
 *
 * `undefined` when there is at most one reading per site. A single reading
 * spaces nothing, and dividing the window by it would report a gap that no pair
 * of readings ever had — reading absence as data, which FR-204 exists to stop.
 */
function observedInterval(f: Figure): string | undefined {
  const perSite = f.samples / f.population;
  const gaps = perSite - 1;
  if (gaps < 1) return undefined;

  const span = Date.parse(f.window.to) - Date.parse(f.window.from);
  if (!Number.isFinite(span) || span <= 0) return undefined;

  const minutes = Math.round(span / gaps / 60_000);
  const hours = Math.floor(minutes / 60);
  // "a reading every ..." rather than "checked every ...": these are the readings
  // *behind this figure*, which for a latency is only the checks that produced a
  // usable number. A site we checked hourly and that answered rarely would
  // otherwise read as one we rarely visited.
  const gap = hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
  return `a reading every ${gap}`;
}

function duration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

/**
 * The tail, named only when it says something the average did not.
 *
 * Evenly spaced readings have a worst gap equal to their average, and printing
 * the same number twice tells a reader nothing. It is worth naming precisely
 * when it exceeds what the average implies.
 */
function largestGap(f: Figure): string | undefined {
  if (f.largestGapMs === undefined) return undefined;
  const perSite = f.samples / f.population;
  const gaps = perSite - 1;
  const span = Date.parse(f.window.to) - Date.parse(f.window.from);
  const average = gaps >= 1 && Number.isFinite(span) && span > 0 ? span / gaps : 0;
  if (f.largestGapMs <= average) return undefined;
  return `longest gap ${duration(f.largestGapMs)}`;
}

function day(iso: string): string {
  return iso.slice(0, 10);
}

export function valueText(f: Figure): string {
  switch (f.unit) {
    case 'percent':
      return `${f.value.toFixed(1)}%`;
    case 'milliseconds':
      return `${Math.round(f.value)} ms`;
    case 'count':
      return String(f.value);
    case 'unitless':
      // Rounding a layout-shift score to a whole number erases it: the entire
      // published scale sits between 0 and 0.25.
      return String(Number(f.value.toFixed(3)));
    case 'bytes':
      return byteText(f.value);
  }
}

function byteText(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  return `${Math.round(bytes)} bytes`;
}

/**
 * The number with its method adjacent — in the same emitted fragment, not in a
 * footnote (FR-201). This is the only path from a Figure to HTML.
 */
export function formatFigure(f: Figure | Absence, opts?: { note?: string }): string {
  if ('kind' in f) {
    return `<span class="absence">— <span class="method">${escapeHtml(f.reason)}</span></span>`;
  }
  const observed = observedInterval(f);
  const worst = largestGap(f);
  const method =
    `${CADENCE_LABEL[f.cadence]}${observed ? `, ${observed}` : ''}` +
    `${worst ? `, ${worst}` : ''} · ` +
    `${f.population === 1 ? '1 site' : `${f.population} sites`} · ` +
    `${day(f.window.from)} to ${day(f.window.to)} · ` +
    `${f.samples} readings · from ${escapeHtml(f.vantage)}` +
    (f.rule ? ` · rule ${escapeHtml(f.rule)}` : '') +
    (opts?.note ? ` · ${escapeHtml(opts.note)}` : '');
  return `<span class="figure">${valueText(f)} <span class="method">${method}</span></span>`;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
