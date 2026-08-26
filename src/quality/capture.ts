/**
 * Rendered views of a public page: what a visitor actually sees.
 *
 * Constitution 2.1.0 permits these because a picture at a stated viewport is
 * evidence a reader can check, where "this site is unusable on a phone" is a
 * claim they must take on trust. The bounds are the principle, and two of them
 * are enforced here:
 *
 * - **A view never enters the record.** What is stored is the *finding* — the
 *   view's hash, dimensions, profile and capture time. Small, permanent, and
 *   enough to answer "this page changed on the 14th" forever. The image itself
 *   is a build artifact, regenerated into each deploy.
 * - **One view per page per profile.** Not a policy but a consequence: with
 *   nowhere for a history to accumulate, latest-only holds by construction.
 */

export type Engine = 'blink' | 'webkit';

export interface CaptureProfile {
  id: string;
  formFactor: 'phone' | 'desktop';
  engine: Engine;
  width: number;
  height: number;
  scale: number;
  /** The share of traffic that justified this profile's place. */
  share: number;
  /** Where that share came from. Never us. */
  source: string;
  /** In words a reader recognises, for the caption under the view. */
  label: string;
}

/**
 * The profiles, chosen from published traffic share rather than preference (D5).
 *
 * StatCounter Global Stats, July 2026: Mobile 52.57% and Desktop 45.93% of
 * platform traffic, so both are covered; Tablet is 1.50%, which does not justify
 * a third of the capture cost, and its absence is the data's call rather than a
 * preference. Chrome is 68.22% of browsers and Safari 16.47%, so Blink and
 * WebKit between them speak for about 94%. Firefox's 3.34% is uncovered, and
 * that is stated rather than papered over.
 *
 * `scale: 1` is deliberate. A 2× capture of the phone viewport measured 103 KB
 * against 38 KB at 1×, and at census scale that difference is the whole storage
 * argument. The view is evidence of layout, not of typography.
 */
export const CAPTURE_PROFILES: CaptureProfile[] = [
  {
    id: 'phone-blink',
    formFactor: 'phone',
    engine: 'blink',
    // The tool's own preset viewport, because this capture rides the deep
    // check's navigation rather than paying for one of its own. Two pixels
    // narrower than the most common phone viewport, which is not worth a second
    // page load against someone else's server.
    width: 412,
    height: 823,
    scale: 1,
    share: 13.24,
    source: 'StatCounter Global Stats, July 2026 — 414×896 is the most common mobile viewport at 13.24%',
    label: 'Phone',
  },
  {
    id: 'desktop-blink',
    formFactor: 'desktop',
    engine: 'blink',
    width: 1920,
    height: 1080,
    scale: 1,
    share: 22.41,
    source: 'StatCounter Global Stats, July 2026 — 1920×1080 is the most common desktop viewport at 22.41%',
    label: 'Desktop',
  },
];

/**
 * What the record keeps of a view. Never the view.
 */
export interface CaptureFinding {
  profile: string;
  width: number;
  height: number;
  scale: number;
  engine: Engine;
  captured_at: string;
  /** The perceptual hash, so a later run can tell whether the page changed. */
  hash: string;
  /** The versioned rule that decided whether it changed. */
  rule: string;
  /** Size of the stored image, which is what the storage argument is about. */
  bytes: number;
  /** Whether this view differed from the one before it. */
  changed: boolean;
}

/**
 * When a view counts as having changed.
 *
 * "Meaningfully" is the load-bearing word in the instruction this implements. A
 * page whose only difference is an antialiasing wobble, a rotating banner
 * photograph or a date in the corner has not changed in any sense a reader cares
 * about, and re-storing it would spend exactly the saving this check exists to
 * buy.
 *
 * The comparison is an average hash: the view reduced to 8×8 greyscale, each
 * cell above or below the mean. That measures *layout* — where the dark and
 * light regions sit — which is what a view is evidence of. It is deliberately
 * blind to colour and to fine detail.
 *
 * Versioned because it is a threshold we drew rather than one anybody published,
 * and a threshold nobody published is one that has to be visible when it moves.
 */
export const CHANGE_RULE = {
  version: 'capture-change/1',
  threshold: 6,
  what:
    'the view reduced to an 8×8 greyscale average hash; more than six of the 64 cells ' +
    'flipping counts as a change, which is layout moving rather than pixels wobbling',
} as const;

/** Hamming distance between two equal-length bit strings. */
export function distance(a: string, b: string): number {
  // Comparing hashes of different lengths yields a number that means nothing,
  // and would mean nothing loudly enough to be believed.
  if (a.length !== b.length) {
    throw new Error(`cannot compare hashes of different length: ${a.length} vs ${b.length}`);
  }
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

/**
 * Whether a new view should replace the stored one.
 *
 * A first view is always a change: there is nothing to compare it to, and
 * treating "unknown" as "unchanged" is reading absence as a finding.
 */
export function hasMeaningfullyChanged(previous: string | undefined, next: string): boolean {
  if (!previous) return true;
  if (previous.length !== next.length) return true;
  return distance(previous, next) > CHANGE_RULE.threshold;
}
