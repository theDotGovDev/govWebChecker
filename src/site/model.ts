import type { Observation } from '../record/types.js';
import type { Target } from '../targets/load.js';

export interface RunRow {
  run_id: string;
  started_at: string;
  finished_at: string;
  targets_attempted: number;
  targets_succeeded: number;
  all_targets_failed: boolean;
  vantage: string;
}

/** What the site shows for one site's most recent measurement. */
export interface LatestView {
  checked_at: string;
  outcome: string;
  status_code?: number;
  /** Absent when nothing was measured. Never zero standing in for absence. */
  median_ms?: number;
  min_ms?: number;
  max_ms?: number;
  samples: number;
  vantage: string;
}

export interface SiteView {
  id: string;
  host: string;
  url: string;
  agency: string;
  suborganization?: string;
  visits?: number;
  observationCount: number;
  latest?: LatestView;
}

export interface SiteModel {
  sites: SiteView[];
  summary: {
    targets: number;
    withData: number;
    withoutData: number;
    observations: number;
    firstObserved?: string;
    lastObserved?: string;
    vantages: string[];
  };
  /** Runs excluded because nothing in them succeeded. Shown, not hidden. */
  discardedRuns: number;
}

export interface ModelInput {
  targets: Target[];
  observations: Observation[];
  runs: RunRow[];
}

/**
 * Turns the stored record into what the site displays.
 *
 * Two rules do most of the work, and both come straight from the constitution.
 * Nothing is collapsed into a verdict — the outcome is shown as recorded,
 * because whether `blocked` counts as "down" is an argument the reader is
 * entitled to have with the data rather than one we settle on their behalf. And
 * absence stays absence: a site with no measurement has no figure, never a zero.
 */
export function buildSiteModel({ targets, observations, runs }: ModelInput): SiteModel {
  // A run where nothing succeeded is more likely our own network than every site
  // at once. Presenting its rows as site behavior would repeat exactly the
  // misattribution the FR-024 marker exists to prevent.
  const discarded = new Set(runs.filter((r) => r.all_targets_failed).map((r) => r.run_id));
  const usable = observations.filter((o) => !discarded.has(o.run_id));

  const byTarget = new Map<string, Observation[]>();
  for (const o of usable) {
    const list = byTarget.get(o.target_id);
    if (list) list.push(o);
    else byTarget.set(o.target_id, [o]);
  }

  const sites: SiteView[] = targets.map((t) => {
    const rows = (byTarget.get(t.id) ?? [])
      .slice()
      .sort((a, b) => a.checked_at.localeCompare(b.checked_at));
    const last = rows[rows.length - 1];

    return {
      id: t.id,
      host: t.host,
      url: t.url,
      agency: t.agency,
      ...(t.suborganization ? { suborganization: t.suborganization } : {}),
      ...(typeof t.traffic_evidence.visits === 'number' ? { visits: t.traffic_evidence.visits } : {}),
      observationCount: rows.length,
      ...(last
        ? {
            latest: {
              checked_at: last.checked_at,
              outcome: last.outcome,
              ...(last.status_code !== undefined ? { status_code: last.status_code } : {}),
              ...(last.latency.median_ms !== undefined ? { median_ms: last.latency.median_ms } : {}),
              ...(last.latency.min_ms !== undefined ? { min_ms: last.latency.min_ms } : {}),
              ...(last.latency.max_ms !== undefined ? { max_ms: last.latency.max_ms } : {}),
              samples: last.latency.samples,
              vantage: last.method.vantage,
            },
          }
        : {}),
    };
  });

  // Ordered by the traffic that earned each site its place, so the ordering is
  // the selection criterion rather than a ranking we invented.
  sites.sort((a, b) => (b.visits ?? -1) - (a.visits ?? -1));

  const timestamps = usable.map((o) => o.checked_at).sort();

  return {
    sites,
    summary: {
      targets: targets.length,
      withData: sites.filter((s) => s.latest).length,
      withoutData: sites.filter((s) => !s.latest).length,
      observations: usable.length,
      ...(timestamps.length > 0
        ? { firstObserved: timestamps[0]!, lastObserved: timestamps[timestamps.length - 1]! }
        : {}),
      vantages: [...new Set(usable.map((o) => o.method.vantage))].sort(),
    },
    discardedRuns: discarded.size,
  };
}
