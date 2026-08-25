import type { Figure } from './figure.js';

/**
 * Turning a measurement into something a reader can act on.
 *
 * "482 ms" is not information for most people — they do not know whether it is
 * good. But the fix is not to hide the number behind a word: it is to say what
 * the number means, name the threshold that decided it, and cite where that
 * threshold came from. A band we invented would be an opinion wearing the
 * costume of a measurement, which is the thing this project exists not to do.
 *
 * So every rule here is versioned (recomputable over stored readings, exactly as
 * `presence/1` is), carries its source, and travels with the exact figure it
 * interprets rather than replacing it (FR-301 to FR-304).
 */
export type Band = 'good' | 'fair' | 'poor';

export interface BandRule {
  /** Versioned, so a threshold change is visible rather than an unexplained shift. */
  version: string;
  /** What is being measured, in words a non-technical reader knows. */
  what: string;
  /** Where the thresholds come from. Never us. */
  source: string;
  /** Ordered best-to-worst; `upTo` is inclusive, the last band is the remainder. */
  bands: { band: Band; upTo?: number; label: string; plain: string }[];
}

export interface Interpretation {
  band: Band;
  label: string;
  plain: string;
  threshold: string;
  source: string;
  version: string;
  what: string;
  /** The measurement itself — an interpretation adds, never replaces (FR-303). */
  figure: Figure;
}

/**
 * Thresholds are taken from published web-performance guidance rather than
 * chosen by us. Server response time uses Google's Time to First Byte
 * guidance, which is the closest published standard to what this project
 * currently measures: the time until the server started answering.
 */
export const RULES: Record<string, BandRule> = {
  server_response: {
    version: 'response-band/1',
    what: 'how long the site took to start answering',
    source: "Google's Time to First Byte guidance (web.dev/ttfb): good under 800 ms, poor over 1,800 ms",
    bands: [
      {
        band: 'good',
        upTo: 800,
        label: 'Fast',
        plain: 'The site starts responding fast enough that a visitor should not notice a wait.',
      },
      {
        band: 'fair',
        upTo: 1800,
        label: 'Slow',
        plain: 'A visitor will notice a pause before the page starts loading, though it does get there.',
      },
      {
        band: 'poor',
        label: 'Very slow',
        plain: 'A visitor waits long enough that many people give up before the page appears.',
      },
    ],
  },
};

export function interpret(figure: Figure, measure: keyof typeof RULES): Interpretation | undefined {
  const rule = RULES[measure];
  // No defensible published threshold means no band. Inventing one would make an
  // opinion indistinguishable from a measurement (FR-302).
  if (!rule) return undefined;

  const chosen =
    rule.bands.find((b) => b.upTo !== undefined && figure.value <= b.upTo) ??
    rule.bands[rule.bands.length - 1]!;

  const i = rule.bands.indexOf(chosen);
  const lower = i > 0 ? rule.bands[i - 1]!.upTo : undefined;
  const threshold =
    chosen.upTo !== undefined
      ? lower !== undefined
        ? `over ${lower.toLocaleString('en-US')} and up to ${chosen.upTo.toLocaleString('en-US')} ms`
        : `up to ${chosen.upTo.toLocaleString('en-US')} ms`
      : `over ${lower!.toLocaleString('en-US')} ms`;

  return {
    band: chosen.band,
    label: chosen.label,
    plain: chosen.plain,
    threshold,
    source: rule.source,
    version: rule.version,
    what: rule.what,
    figure,
  };
}
