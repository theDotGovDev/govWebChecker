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

  /**
   * The deep-check measures, keyed by the metric names the record stores.
   *
   * Every threshold below is Google's, published for these exact metrics, and
   * that is the point: a band this project invented would be an opinion wearing
   * the costume of a measurement. Where nobody has published a defensible line —
   * total page weight is the case in hand — there is no rule here and therefore
   * no band, rather than a number we made up (FR-302).
   */
  largest_contentful_paint: {
    version: 'lcp-band/1',
    what: 'how long until the main thing on the page appears',
    source: "Google's Core Web Vitals (web.dev/lcp): good at or under 2.5 s, poor over 4 s",
    bands: [
      { band: 'good', upTo: 2500, label: 'Appears quickly',
        plain: 'The main content shows up fast enough that the page feels ready almost immediately.' },
      { band: 'fair', upTo: 4000, label: 'Slow to appear',
        plain: 'A visitor stares at a mostly empty page for a noticeable moment before the content arrives.' },
      { band: 'poor', label: 'Very slow to appear',
        plain: 'The page stays blank or half-drawn long enough that many visitors give up first.' },
    ],
  },

  cumulative_layout_shift: {
    version: 'cls-band/1',
    what: 'how much the page jumps around while it loads',
    source: "Google's Core Web Vitals (web.dev/cls): good at or under 0.1, poor over 0.25",
    bands: [
      { band: 'good', upTo: 0.1, label: 'Stays put',
        plain: 'The page holds still as it loads, so nothing moves out from under a reader mid-tap.' },
      { band: 'fair', upTo: 0.25, label: 'Shifts a little',
        plain: 'Parts of the page move as it finishes loading, which can make a reader lose their place.' },
      { band: 'poor', label: 'Jumps around',
        plain: 'The page moves enough while loading that a visitor can tap the wrong thing entirely.' },
    ],
  },

  total_blocking_time: {
    version: 'tbt-band/1',
    what: 'how long the page ignores taps and clicks while it loads',
    source: "Google's Lighthouse metric scoring (developer.chrome.com/docs/lighthouse/performance/lighthouse-total-blocking-time): good at or under 200 ms, poor over 600 ms",
    bands: [
      { band: 'good', upTo: 200, label: 'Responds right away',
        plain: 'The page answers taps and typing as soon as it appears.' },
      { band: 'fair', upTo: 600, label: 'Slow to respond',
        plain: 'Taps and typing are ignored for a moment while the page finishes working.' },
      { band: 'poor', label: 'Frozen while loading',
        plain: 'The page looks ready but does not respond, which reads as broken rather than slow.' },
    ],
  },

  first_contentful_paint: {
    version: 'fcp-band/1',
    what: 'how long until anything at all appears',
    source: "Google's Lighthouse metric scoring (web.dev/fcp): good at or under 1.8 s, poor over 3 s",
    bands: [
      { band: 'good', upTo: 1800, label: 'Something appears fast',
        plain: 'A visitor sees the page starting to draw almost as soon as they ask for it.' },
      { band: 'fair', upTo: 3000, label: 'Blank for a moment',
        plain: 'The screen stays empty for long enough to notice before anything appears.' },
      { band: 'poor', label: 'Blank for a long time',
        plain: 'A visitor waits at a blank screen with no sign that anything is happening.' },
    ],
  },

  speed_index: {
    version: 'speed-index-band/1',
    what: 'how quickly the page fills in overall',
    source: "Google's Lighthouse metric scoring (developer.chrome.com/docs/lighthouse/performance/speed-index): good at or under 3.4 s, poor over 5.8 s",
    bands: [
      { band: 'good', upTo: 3400, label: 'Fills in quickly',
        plain: 'The page becomes readable in one smooth go rather than in slow pieces.' },
      { band: 'fair', upTo: 5800, label: 'Fills in slowly',
        plain: 'The page arrives in visible stages, so a reader waits for the part they came for.' },
      { band: 'poor', label: 'Fills in very slowly',
        plain: 'The page takes long enough to become readable that a visitor may leave first.' },
    ],
  },

  time_to_interactive: {
    version: 'tti-band/1',
    what: 'how long until the page is fully usable',
    source: "Google's Lighthouse metric scoring (web.dev/tti): good at or under 3.8 s, poor over 7.3 s",
    bands: [
      { band: 'good', upTo: 3800, label: 'Usable quickly',
        plain: 'Search boxes, menus and links work almost as soon as the page appears.' },
      { band: 'fair', upTo: 7300, label: 'Slow to become usable',
        plain: 'The page looks finished before it actually works, so early taps do nothing.' },
      { band: 'poor', label: 'Very slow to become usable',
        plain: 'A visitor can see what they need for several seconds before they can act on it.' },
    ],
  },
};

/**
 * The metric the availability record already publishes, under the name the deep
 * record uses for the same thing. Both are the time until the server started
 * answering, so they share one rule rather than drifting into two.
 */
RULES['server_response_time'] = RULES['server_response']!;

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
