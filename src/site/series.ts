import type { Observation } from '../record/types.js';
import { figure, type Figure } from './figure.js';

/**
 * The census run summary fields a coverage claim needs. Structural, not the
 * whole summary: completeness is slices-ran-against-one-digest, which rows alone
 * cannot establish — a cycle's rows do not say how many slices were *supposed*
 * to run.
 */
export interface CensusRunSummary {
  tier: string;
  cycle: string;
  slice: number;
  frame_digest: string;
  frame_size: number;
  slice_size: number;
}

/** One cycle's reading. A mark, not a point: nothing is drawn between marks. */
export interface CensusMark {
  cycle: string;
  /** Distinct slices that ran this cycle, whatever the digest. */
  slicesRan: number;
  slicesInFrame: number;
  /** Seven slices are a cycle only when they swept one frame. */
  complete: boolean;
  /** More than one frame digest inside the cycle — disclosed, not smoothed (FR-232). */
  frameChanged: boolean;
  /** The three states, one shared denominator, the rule named (FR-210, FR-205). */
  presence: { website: Figure; no_website: Figure; undetermined: Figure };
  domains: number;
}

/**
 * A census series is discrete BY TYPE. There is no `points` array and no
 * interpolation anywhere in this module: a line between two weekly readings
 * asserts knowledge of the six days between them, which is absence rendered as
 * data (FR-230, Principle V). The renderer for this type emits marks and no
 * path — a restyle cannot bring the line back, because there is nothing to
 * restyle.
 */
export interface CensusSeries {
  cadence: 'discrete';
  tier: 'broad';
  marks: CensusMark[];
}

export function censusSeries(
  rows: Observation[],
  runs: CensusRunSummary[],
  slicesInFrame: number,
): CensusSeries {
  const byCycle = new Map<string, Observation[]>();
  for (const o of rows) {
    if (o.tier !== 'broad' || o.cycle === undefined) continue;
    const list = byCycle.get(o.cycle);
    if (list) list.push(o);
    else byCycle.set(o.cycle, [o]);
  }

  const marks: CensusMark[] = [...byCycle.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cycle, list]) => {
      const cycleRuns = runs.filter((r) => r.tier === 'broad' && r.cycle === cycle);
      const digests = new Set(cycleRuns.map((r) => r.frame_digest));
      const slicesRan = new Set(cycleRuns.map((r) => r.slice)).size;
      // Complete means: every slice ran, and they all swept the same frame.
      // Slices against different digests covered neither frame completely.
      const complete =
        digests.size === 1 &&
        new Set(cycleRuns.map((r) => r.slice)).size === slicesInFrame;

      const stamps = list.map((o) => o.checked_at).sort();
      const vantage = [...new Set(list.map((o) => o.method.vantage))].sort().join(', ');
      const judged = list.filter((o) => o.presence !== undefined);
      const rules = [...new Set(judged.map((o) => o.presence!.rule))].sort().join(', ');
      const count = (state: 'website' | 'no_website' | 'undetermined'): Figure =>
        figure({
          value: judged.filter((o) => o.presence!.state === state).length,
          unit: 'count',
          tier: 'broad',
          population: judged.length,
          window: { from: stamps[0]!, to: stamps[stamps.length - 1]! },
          samples: judged.length,
          vantage,
          rule: rules,
        });

      return {
        cycle,
        slicesRan,
        slicesInFrame,
        complete,
        frameChanged: digests.size > 1,
        presence: {
          website: count('website'),
          no_website: count('no_website'),
          undetermined: count('undetermined'),
        },
        domains: new Set(list.map((o) => o.target_id)).size,
      };
    });

  return { cadence: 'discrete', tier: 'broad', marks };
}
