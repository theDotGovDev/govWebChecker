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
 * The comparison is a difference hash: the view reduced to a 17×17 greyscale
 * grid, each cell compared with its right-hand neighbour and with the one below
 * it. That measures where the *edges* are — which is what layout is — and is
 * deliberately blind to overall brightness and to fine detail.
 *
 * Both directions are needed, and the second was added after a desktop view
 * hashed to all zeroes. Comparing left to right finds vertical edges: columns,
 * sidebars, cards. A full-width banner has none — and a government page at
 * desktop width is mostly full-width bands, so half the layout was invisible.
 *
 * An average hash was tried first and does not work here. Government pages are
 * mostly white, so nearly every cell sits above the mean and the hash collapses:
 * on a local fixture a complete redesign scored a distance of zero. A method
 * that returns "unchanged" for a redesign is worse than no method, because it
 * reports having checked.
 *
 * Versioned because it is a threshold we drew rather than one anybody published,
 * and a threshold nobody published is one that has to be visible when it moves.
 */
export const CHANGE_RULE = {
  version: 'capture-change/1',
  /** A 17×17 greyscale grid, each cell compared with the one to its right and the one below. */
  bits: 512,
  threshold: 10,
  what:
    'the view reduced to a 17×17 greyscale grid, each cell compared with the one to its right ' +
    'and the one below it; more than ten of the 512 comparisons flipping counts as a change',
  /**
   * Why ten, stated because we drew this line rather than citing one.
   *
   * Measured against local fixtures, distance out of 512. On the phone profile,
   * noise — a re-render, a date changing in the strapline, a heading reworded —
   * reached 3; signal started at 33, for one image swapped, with a banner at 109
   * and a redesign at 89. On the desktop profile noise was 0 and signal started
   * at 37.
   *
   * Two corrections got here. The first threshold was set from a fixture where
   * the smallest visible change scored 18 out of 256; on a second fixture the
   * same kind of change scored 9, which that threshold would have called
   * unchanged. The second came from adding the vertical pass, which widened the
   * gap on both profiles and made the desktop view measurable at all.
   *
   * The failure modes are not symmetric, and that decides the direction of the
   * error. A spurious re-store costs bytes. A missed change leaves a picture
   * published as current that is no longer true — a claim about someone else's
   * site that we would keep making. So this sits nearer the noise floor than the
   * middle of the gap.
   */
  basis:
    'measured on local fixtures, out of 512: re-renders and text-only edits reach 3, the smallest ' +
    'visible change measured (one image swapped) reaches 33; set near the noise floor because a ' +
    'missed change publishes a view that is no longer true',
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
