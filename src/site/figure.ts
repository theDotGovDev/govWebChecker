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
export interface Figure {
  readonly value: number;
  /**
   * `unitless` is a real unit for a ratio like layout shift, which has no
   * dimension but is very much a measurement; `bytes` is stored raw and read out
   * in KB or MB, because a reader thinks in those and the record should not.
   */
  readonly unit: 'percent' | 'milliseconds' | 'count' | 'unitless' | 'bytes';
  /** Never both. FR-220: no figure spans tiers, enforced by this being singular. */
  readonly tier: Tier;
  /** How many sites the figure covers. */
  readonly population: number;
  readonly window: { readonly from: string; readonly to: string };
  /** Readings behind the value. Zero readings cannot carry a value. */
  readonly samples: number;
  /** From the rows' `method.vantage`, never from configuration. */
  readonly vantage: string;
  /** The versioned rule that derived the reading, where one did (FR-205). */
  readonly rule?: string;
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
  if (parts.tier === undefined) throw new Error('a figure must state its tier');
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
const TIER_LABEL: Record<Tier, string> = {
  hot: 'checked hourly',
  broad: 'checked weekly',
};

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
  const method =
    `${TIER_LABEL[f.tier]} · ${f.population === 1 ? '1 site' : `${f.population} sites`} · ` +
    `${day(f.window.from)} to ${day(f.window.to)} · ` +
    `${f.samples} readings · from ${escapeHtml(f.vantage)}` +
    (f.rule ? ` · rule ${escapeHtml(f.rule)}` : '') +
    (opts?.note ? ` · ${escapeHtml(opts.note)}` : '');
  return `<span class="figure">${valueText(f)} <span class="method">${method}</span></span>`;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
