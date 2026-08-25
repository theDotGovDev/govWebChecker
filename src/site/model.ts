import type { Observation } from '../record/types.js';
import type { Target } from '../targets/load.js';
import { figure, type Figure } from './figure.js';
import { censusSeries, type CensusSeries } from './series.js';
import type { Frame } from '../census/frame.js';

export interface RunRow {
  run_id: string;
  started_at: string;
  finished_at: string;
  targets_attempted: number;
  targets_succeeded: number;
  all_targets_failed: boolean;
  vantage: string;
  /** Census summaries carry their coverage accounting; hot-tier runs do not. */
  tier?: string;
  cycle?: string;
  slice?: number;
  frame_digest?: string;
  frame_size?: number;
  slice_size?: number;
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

/**
 * A site's response time, computed across observations rather than within one
 * check. At hourly cadence each observation is a single reading, so the series
 * is what supplies the statistics (FR-011a).
 */
export interface TypicalView {
  /** The median across readings, carrying its full method (FR-201). */
  median: Figure;
  fastest_ms: number;
  slowest_ms: number;
}

export interface SiteView {
  id: string;
  host: string;
  url: string;
  agency: string;
  suborganization?: string;
  visits?: number;
  observationCount: number;
  /** How many of those observations got a response at all. */
  responded: number;
  /** Absent until there are at least two readings — one is not a response time. */
  typical?: TypicalView;
  latest?: LatestView;
}

/**
 * What one tier's rows say, computed from the rows alone.
 *
 * The two tiers are different populations, and the broad one will have a far
 * higher failure and absence rate than 58 curated federal hosts — because the
 * population differs, not because government websites got worse. A figure that
 * silently mixes them is a wrong headline about US government, and those are
 * hard to retract (FR-139, SC-107).
 *
 * Every field here is derived from observations. None consults a target list,
 * because a list can change after the fact and a historical figure that moves
 * when the list moves is not a measurement.
 */
export interface TierView {
  tier: string;
  /**
   * Share of observations that got a successful response, as a Figure — the
   * page's one headline rate per tier, carrying its method (FR-201). Absent
   * when the tier has no observations, never zero (FR-204).
   */
  answered?: Figure;
  /** When this tier last read anything — how current the page is (FR-252). */
  latestReading?: string;
  /** Stated in words, so a figure never travels without the population it covers. */
  population: string;
  observations: number;
  /** Distinct targets, which is not the same as observations at any cadence. */
  domains: number;
  responded: number;
  outcomes: Record<string, number>;
  /** Only meaningful for the census; absent readings stay absent, not zero. */
  presence: { website: number; no_website: number; undetermined: number };
  /**
   * The same three counts as Figures — each carrying the shared denominator as
   * its population, the versioned rule that derived the reading (FR-205), and
   * the rest of its method. Three figures, never a merged one (FR-210).
   */
  presenceFigures?: { website: Figure; no_website: Figure; undetermined: Figure };
}

export interface CensusCycleView {
  cycle: string;
  domains: number;
  slices: number[];
  presence: { website: number; no_website: number; undetermined: number };
}

export interface CensusView {
  cycles: CensusCycleView[];
}

export interface SiteModel {
  sites: SiteView[];
  /** Daily answered-rate and latency for the hourly monitoring (FR-283). */
  answeredTrend?: TrendChart;
  latencyTrend?: TrendChart;
  /** Presence composition across kinds of government (FR-282). */
  ecosystem?: EcosystemView;
  /** Agencies on the one stated measure, no-rate carve-out intact (FR-284). */
  agencies: AgencyView[];
  /** Present when the record holds census rows: the discrete, cadence-aware series. */
  censusSeries?: CensusSeries;
  /** One entry per tier present in the record. Never summed into one figure. */
  tiers: TierView[];
  /** Present only when the record holds census rows. */
  census?: CensusView;
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
  /** The census frame, for joining domains to their kind of government (D5). */
  frame?: Frame;
}

/**
 * A chart is a Figure at a different size (FR-281): the points are data within
 * one captioned figure, and the caption carries the full method. `caption` is a
 * real Figure — constructed through the same choke point, refusing the same
 * omissions — whose value is the window-wide aggregate the chart details.
 */
export interface TrendChart {
  caption: Figure;
  points: { date: string; value: number; samples: number }[];
}

/** One kind of government's presence composition (FR-282). */
export interface TypeComposition {
  type: string;
  judged: number;
  website: number;
  no_website: number;
  undetermined: number;
}

export interface EcosystemView {
  /** Registry types by judged count, election variants folded into their parent. */
  types: TypeComposition[];
  caption: Figure;
}

/** One agency's standing on the single stated measure (FR-284). */
export interface AgencyView {
  agency: string;
  sites: number;
  figure?: Figure;
  /** Every one of the agency's sites declines automation or is robots-excluded. */
  declinesAutomation?: boolean;
}

const POPULATIONS: Record<string, string> = {
  hot: 'federal hosts selected by measured public traffic, checked hourly',
  broad: 'all registered US .gov domains, checked on a rolling weekly cycle',
  untiered: 'observations recorded before the record distinguished tiers',
};

function emptyPresence(): { website: number; no_website: number; undetermined: number } {
  return { website: 0, no_website: 0, undetermined: 0 };
}

/**
 * One view per tier, and deliberately no total.
 *
 * There is no field here a caller could mistake for "availability across all of
 * .gov". Anything that reads like one has to be assembled from these parts,
 * which makes mixing populations a decision somebody takes visibly rather than
 * one the model makes for them.
 */
function tierViews(rows: Observation[]): TierView[] {
  const byTier = new Map<string, Observation[]>();
  for (const o of rows) {
    // Rows written before the record distinguished tiers are counted and named,
    // not dropped and not guessed at. Dropping them would understate history;
    // inferring a tier would invent provenance.
    const tier = o.tier ?? 'untiered';
    const list = byTier.get(tier);
    if (list) list.push(o);
    else byTier.set(tier, [o]);
  }

  return [...byTier.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tier, list]) => {
      const presence = emptyPresence();
      for (const o of list) {
        if (o.presence) presence[o.presence.state] += 1;
      }
      const stamps = list.map((o) => o.checked_at).sort();
      const succeeded = list.filter((o) => o.outcome === 'success').length;
      const vantage = [...new Set(list.map((o) => o.method.vantage))].sort().join(', ');
      const answered =
        list.length > 0
          ? figure({
              value: (100 * succeeded) / list.length,
              unit: 'percent',
              tier: (tier === 'broad' ? 'broad' : 'hot') as 'hot' | 'broad',
              population: new Set(list.map((o) => o.target_id)).size,
              window: { from: stamps[0]!, to: stamps[stamps.length - 1]! },
              samples: list.length,
              vantage,
            })
          : undefined;

      // The reading is a judgement, so its figures carry the rule that made it.
      // One denominator for all three: rows that carry a presence at all.
      const judged = list.filter((o) => o.presence !== undefined);
      const rules = [...new Set(judged.map((o) => o.presence!.rule))].sort();
      const presenceFigures =
        judged.length > 0
          ? (Object.fromEntries(
              (['website', 'no_website', 'undetermined'] as const).map((state) => [
                state,
                figure({
                  value: judged.filter((o) => o.presence!.state === state).length,
                  unit: 'count',
                  tier: (tier === 'broad' ? 'broad' : 'hot') as 'hot' | 'broad',
                  population: judged.length,
                  window: { from: stamps[0]!, to: stamps[stamps.length - 1]! },
                  samples: judged.length,
                  vantage,
                  rule: rules.join(', '),
                }),
              ]),
            ) as { website: Figure; no_website: Figure; undetermined: Figure })
          : undefined;
      return {
        tier,
        ...(answered ? { answered } : {}),
        ...(presenceFigures ? { presenceFigures } : {}),
        ...(stamps.length > 0 ? { latestReading: stamps[stamps.length - 1]! } : {}),
        population: POPULATIONS[tier] ?? 'population not stated in the record',
        observations: list.length,
        domains: new Set(list.map((o) => o.target_id)).size,
        responded: list.filter((o) => o.outcome === 'success').length,
        outcomes: list.reduce<Record<string, number>>((counts, o) => {
          counts[o.outcome] = (counts[o.outcome] ?? 0) + 1;
          return counts;
        }, {}),
        presence,
      };
    });
}

/** Coverage per cycle, read from the rows rather than from our run summaries. */
function censusView(rows: Observation[]): CensusView {
  const byCycle = new Map<string, Observation[]>();
  for (const o of rows) {
    if (o.tier !== 'broad' || o.cycle === undefined) continue;
    const list = byCycle.get(o.cycle);
    if (list) list.push(o);
    else byCycle.set(o.cycle, [o]);
  }

  return {
    cycles: [...byCycle.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([cycle, list]) => {
        const presence = emptyPresence();
        for (const o of list) if (o.presence) presence[o.presence.state] += 1;
        return {
          cycle,
          domains: new Set(list.map((o) => o.target_id)).size,
          slices: [...new Set(list.map((o) => o.slice).filter((s): s is number => s !== undefined))].sort(),
          presence,
        };
      }),
  };
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
export function buildSiteModel({ targets, observations, runs, frame }: ModelInput): SiteModel {
  // A run where nothing succeeded is more likely our own network than every site
  // at once. Presenting its rows as site behavior would repeat exactly the
  // misattribution the FR-024 marker exists to prevent.
  const discarded = new Set(runs.filter((r) => r.all_targets_failed).map((r) => r.run_id));
  const usable = observations.filter((o) => !discarded.has(o.run_id));

  // A row whose vantage is `local` measures a developer machine's network, not
  // the target (FR-253). Refusing beats filtering: silently dropping it would
  // hide that development data reached the record at all.
  const local = usable.find((o) => o.method.vantage === 'local');
  if (local) {
    throw new Error(
      `refusing to build: observation ${local.run_id}/${local.target_id} has vantage "local" — ` +
        'a local reading is a development artefact, not a measurement of a target',
    );
  }

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

    // Only successful readings carry a timing. A timeout is not a slow response,
    // and folding one in as a large number would invent a measurement.
    const timings = rows
      .map((o) => o.latency.median_ms)
      .filter((ms): ms is number => typeof ms === 'number')
      .sort((a, b) => a - b);

    const stamps = rows.map((o) => o.checked_at).sort();
    const typical =
      timings.length >= 2
        ? {
            median: figure({
              value: timings[Math.floor(timings.length / 2)]!,
              unit: 'milliseconds' as const,
              tier: 'hot' as const,
              population: 1,
              window: { from: stamps[0]!, to: stamps[stamps.length - 1]! },
              samples: timings.length,
              vantage: [...new Set(rows.map((o) => o.method.vantage))].sort().join(', '),
            }),
            fastest_ms: timings[0]!,
            slowest_ms: timings[timings.length - 1]!,
          }
        : undefined;

    return {
      id: t.id,
      host: t.host,
      url: t.url,
      agency: t.agency,
      ...(t.suborganization ? { suborganization: t.suborganization } : {}),
      ...(typeof t.traffic_evidence.visits === 'number' ? { visits: t.traffic_evidence.visits } : {}),
      observationCount: rows.length,
      responded: rows.filter((o) => o.outcome === 'success').length,
      ...(typical ? { typical } : {}),
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

  const broadRows = usable.filter((o) => o.tier === 'broad');

  // The hourly monitoring process, whatever the rows are labeled: rows written
  // before the record distinguished tiers came from the same 58-host hourly
  // machinery, so the trend over time may include them — one population, one
  // process, some rows predating the label. This is not cross-population
  // blending (FR-220): the census never enters.
  const monitoring = usable
    .filter((o) => (o.tier ?? 'hot') !== 'broad')
    .sort((a, b) => a.checked_at.localeCompare(b.checked_at));

  function monitoringMeta(rows: Observation[]): {
    window: { from: string; to: string };
    vantage: string;
    population: number;
  } {
    return {
      window: { from: rows[0]!.checked_at, to: rows[rows.length - 1]!.checked_at },
      vantage: [...new Set(rows.map((o) => o.method.vantage))].sort().join(', '),
      population: new Set(rows.map((o) => o.host)).size,
    };
  }

  function answeredTrend(): TrendChart | undefined {
    if (monitoring.length === 0) return undefined;
    const byDay = new Map<string, { n: number; ok: number }>();
    for (const o of monitoring) {
      const d = o.checked_at.slice(0, 10);
      const cell = byDay.get(d) ?? { n: 0, ok: 0 };
      cell.n += 1;
      if (o.outcome === 'success') cell.ok += 1;
      byDay.set(d, cell);
    }
    const points = [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, c]) => ({ date, value: (100 * c.ok) / c.n, samples: c.n }));
    const ok = monitoring.filter((o) => o.outcome === 'success').length;
    return {
      caption: figure({
        value: (100 * ok) / monitoring.length,
        unit: 'percent',
        tier: 'hot',
        samples: monitoring.length,
        ...monitoringMeta(monitoring),
      }),
      points,
    };
  }

  function latencyTrend(): TrendChart | undefined {
    const timed = monitoring.filter((o) => typeof o.latency.median_ms === 'number');
    if (timed.length < 2) return undefined;
    const byDay = new Map<string, number[]>();
    for (const o of timed) {
      const d = o.checked_at.slice(0, 10);
      const list = byDay.get(d) ?? [];
      list.push(o.latency.median_ms!);
      byDay.set(d, list);
    }
    const med = (v: number[]): number => v.sort((a, b) => a - b)[Math.floor(v.length / 2)]!;
    const points = [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, value: med(v), samples: v.length }));
    return {
      caption: figure({
        value: med(timed.map((o) => o.latency.median_ms!)),
        unit: 'milliseconds',
        tier: 'hot',
        samples: timed.length,
        ...monitoringMeta(timed),
      }),
      points,
    };
  }

  function ecosystemView(frameIn?: Frame): EcosystemView | undefined {
    if (!frameIn || broadRows.length === 0) return undefined;
    // Election variants fold into their parent kind: "City - Election" is a
    // city's election site, and sixteen rows would bury the shape the reader
    // came for. The registry's own names are preserved in the fold's parent.
    const typeOf = new Map<string, string>();
    for (const d of frameIn.domains) typeOf.set(d.domain, d.type.replace(/ - Election$/, ''));
    const latest = new Map<string, Observation>();
    for (const o of broadRows) {
      const prev = latest.get(o.target_id);
      if (!prev || prev.checked_at < o.checked_at) latest.set(o.target_id, o);
    }
    const byType = new Map<string, TypeComposition>();
    for (const [domain, o] of latest) {
      if (!o.presence) continue;
      const type = typeOf.get(domain) ?? 'Unlisted in frame';
      const cell = byType.get(type) ?? { type, judged: 0, website: 0, no_website: 0, undetermined: 0 };
      cell.judged += 1;
      cell[o.presence.state] += 1;
      byType.set(type, cell);
    }
    const types = [...byType.values()].sort((a, b) => b.judged - a.judged);
    const stamps = broadRows.map((o) => o.checked_at).sort();
    return {
      types,
      caption: figure({
        value: latest.size,
        unit: 'count',
        tier: 'broad',
        population: latest.size,
        window: { from: stamps[0]!, to: stamps[stamps.length - 1]! },
        samples: broadRows.length,
        vantage: [...new Set(broadRows.map((o) => o.method.vantage))].sort().join(', '),
        rule: [...new Set(broadRows.map((o) => o.presence?.rule).filter(Boolean))].sort().join(', '),
      }),
    };
  }

  function agencyViews(): AgencyView[] {
    const byAgency = new Map<string, { hosts: Set<string>; rows: Observation[] }>();
    const agencyOf = new Map<string, string>(targets.map((t) => [t.host, t.agency]));
    for (const o of monitoring) {
      const agency = agencyOf.get(o.host);
      if (agency === undefined) continue;
      const cell = byAgency.get(agency) ?? { hosts: new Set<string>(), rows: [] };
      cell.hosts.add(o.host);
      cell.rows.push(o);
      byAgency.set(agency, cell);
    }
    const views: AgencyView[] = [];
    for (const [agency, { hosts, rows }] of byAgency) {
      const ok = rows.filter((o) => o.outcome === 'success').length;
      if (ok === 0) {
        // The carve-out at agency altitude (FR-284, FR-261): every reading
        // refused or skipped is a posture toward automation, not a rate.
        views.push({ agency, sites: hosts.size, declinesAutomation: true });
        continue;
      }
      const stamps = rows.map((o) => o.checked_at).sort();
      views.push({
        agency,
        sites: hosts.size,
        figure: figure({
          value: (100 * ok) / rows.length,
          unit: 'percent',
          tier: 'hot',
          population: hosts.size,
          window: { from: stamps[0]!, to: stamps[stamps.length - 1]! },
          samples: rows.length,
          vantage: [...new Set(rows.map((o) => o.method.vantage))].sort().join(', '),
        }),
      });
    }
    const rated = views.filter((v) => v.figure).sort((a, b) => b.figure!.value - a.figure!.value);
    const unrated = views.filter((v) => !v.figure).sort((a, b) => a.agency.localeCompare(b.agency));
    return [...rated, ...unrated];
  }
  const censusRuns = runs.filter(
    (r): r is RunRow & { cycle: string; slice: number; frame_digest: string } =>
      r.tier === 'broad' && r.cycle !== undefined && r.slice !== undefined && r.frame_digest !== undefined,
  );

  const aTrend = answeredTrend();
  const lTrend = latencyTrend();
  const eco = ecosystemView(frame);
  return {
    sites,
    ...(aTrend ? { answeredTrend: aTrend } : {}),
    ...(lTrend ? { latencyTrend: lTrend } : {}),
    ...(eco ? { ecosystem: eco } : {}),
    agencies: agencyViews(),
    tiers: tierViews(usable),
    ...(broadRows.length > 0
      ? {
          censusSeries: censusSeries(
            broadRows,
            censusRuns.map((r) => ({
              tier: 'broad',
              cycle: r.cycle,
              slice: r.slice,
              frame_digest: r.frame_digest,
              frame_size: r.frame_size ?? 0,
              slice_size: r.slice_size ?? 0,
            })),
            7,
          ),
        }
      : {}),
    ...(usable.some((o) => o.tier === 'broad') ? { census: censusView(usable) } : {}),
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
