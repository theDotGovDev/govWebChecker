import type { Observation } from '../record/types.js';
import { figure, type Figure } from './figure.js';

/**
 * Why a host has no rate. A variant, not a sentinel value: a `0` for these
 * would publish Social Security at zero availability, and four of the 58 real
 * hosts are exactly this case (FR-261).
 */
export type NoRateReason =
  | { kind: 'refused'; statusCode: number }
  | { kind: 'not_checked'; rule: string };

/**
 * One host's place in a per-dimension ordering. `figure` and `noRate` are
 * mutually exclusive by construction, and a no-rate host is excluded from any
 * ordering rather than sorted to the bottom (FR-262).
 *
 * There is no composite here and no field to hold one (D1, FR-260). Any
 * grouping of measures is a decision a reader takes visibly, not one this type
 * takes for them.
 */
export interface Standing {
  host: string;
  figure?: Figure;
  noRate?: NoRateReason;
}

/**
 * Orders hosts by the one stated measure: share of readings answered.
 *
 * The carve-out is for hosts with no successful basis at all. A host that
 * refuses sometimes and answers sometimes has an honest rate — its refusals
 * count in the denominator because they were readings. A host that never once
 * answered has no rate: it is refusing automation or telling us not to check,
 * and neither is a fact about whether its website works.
 */
export function standings(rows: Observation[]): Standing[] {
  const byHost = new Map<string, Observation[]>();
  for (const o of rows) {
    const list = byHost.get(o.host);
    if (list) list.push(o);
    else byHost.set(o.host, [o]);
  }

  const result: Standing[] = [];
  for (const [host, list] of byHost) {
    const succeeded = list.filter((o) => o.outcome === 'success').length;

    if (succeeded === 0) {
      const skipped = list.find((o) => o.outcome === 'skipped');
      if (skipped) {
        result.push({
          host,
          noRate: { kind: 'not_checked', rule: skipped.skip_reason ?? 'skipped by rule' },
        });
        continue;
      }
      const blocked = list.find((o) => o.outcome === 'blocked');
      if (blocked) {
        result.push({
          host,
          noRate: { kind: 'refused', statusCode: blocked.status_code ?? 403 },
        });
        continue;
      }
      // Never answered and never refused: a genuine all-failure record. That IS
      // a rate — zero, honestly measured — not a carve-out.
    }

    const stamps = list.map((o) => o.checked_at).sort();
    result.push({
      host,
      figure: figure({
        value: (100 * succeeded) / list.length,
        unit: 'percent',
        tier: 'hot',
        population: 1,
        window: { from: stamps[0]!, to: stamps[stamps.length - 1]! },
        samples: list.length,
        vantage: [...new Set(list.map((o) => o.method.vantage))].sort().join(', '),
      }),
    });
  }

  // Descending by the single stated measure. No-rate hosts keep their entries —
  // with the reason — but never participate in the ordering.
  const rated = result.filter((s) => s.figure !== undefined);
  const unrated = result.filter((s) => s.figure === undefined);
  rated.sort((a, b) => b.figure!.value - a.figure!.value);
  return [...rated, ...unrated];
}
