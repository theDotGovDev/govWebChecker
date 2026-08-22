import { randomUUID } from 'node:crypto';
import type { Observation } from '../record/types.js';
import { RateLimiter } from '../politeness/rate-limiter.js';
import { appendObservation, appendRunSummary } from '../record/writer.js';
import { sampleTarget } from '../checker/sample.js';
import { fetchTextForEvaluation } from '../checker/check.js';
import { parseRobots, isAllowed } from '../checker/robots.js';
import {
  classifyName,
  systemResolver,
  ResolutionCache,
  pinnedLookup,
  type NameResolver,
  type NameResolution,
} from '../checker/resolve.js';
import { domainsInSlice, type Frame, type FrameEntry } from './frame.js';
import { canonicalUrl, URL_RULE } from './url.js';
import { presenceOf } from './presence.js';
import { cycleOf } from './slice.js';

const SCHEMA = '1';
const DIMENSION = 'availability';

export interface CensusConfig {
  timeoutMs: number;
  maxRedirects: number;
  hostIntervalMs: number;
  domainIntervalMs: number;
  addressIntervalMs: number;
  maxConcurrentHosts: number;
  vantage: string;
  toolVersion: string;
  dryRun?: boolean;
}

export interface CensusInput {
  frame: Frame;
  slice: number;
  dataDir: string;
  config: CensusConfig;
  /** Injected so no test resolves a real name. */
  resolver?: NameResolver;
  /** Test seam: where a derived URL actually points. Production derives and uses it. */
  urlOverride?: (domain: string) => string;
  now?: Date;
}

export interface CensusSummary {
  run_id: string;
  started_at: string;
  finished_at: string;
  targets_attempted: number;
  targets_succeeded: number;
  all_targets_failed: boolean;
  outcome_breakdown: Record<string, number>;
  presence_breakdown: Record<string, number>;
  vantage: string;
  tier: 'broad';
  cycle: string;
  slice: number;
  frame_digest: string;
  frame_size: number;
  slice_size: number;
}

const SUCCEEDED = new Set(['success']);

/**
 * One broad-tier slice.
 *
 * Reuses the checker's limiter, resolution and sampling rather than duplicating
 * them: the census decides *what* to check and *when*, the checker decides *how*.
 * That boundary matters because the checker is the code the constitution
 * constrains most tightly, and the census should not be able to change how a
 * government server is contacted by changing its own mind about scope.
 *
 * The order of operations is the feature. Resolution comes first and decides
 * everything after it — whether a request is sent at all, which URL form it goes
 * to, and what the record is allowed to claim. A domain that publishes no web
 * address receives no request, because sending one would spend a jurisdiction's
 * resources to learn something DNS already told us, and would produce a failure
 * that reads as a broken website.
 */
export async function executeCensus(input: CensusInput): Promise<CensusSummary> {
  const { frame, slice, dataDir, config } = input;
  const resolver = input.resolver ?? systemResolver;
  const now = input.now ?? new Date();

  const entries = domainsInSlice(frame, slice);
  if (entries.length === 0) {
    // FR-115. A run that recorded a successful sweep of nothing is the one shape
    // that makes a gap in the record look like coverage.
    throw new Error(
      `slice ${slice} is empty in a frame of ${frame.domains.length} domains — ` +
        'refusing to record a successful sweep of nothing',
    );
  }

  const started_at = now.toISOString();
  const run_id = `${started_at}/${DIMENSION}/${randomUUID().slice(0, 8)}`;
  const cycle = cycleOf(now);
  const limiter = new RateLimiter({
    hostIntervalMs: config.hostIntervalMs,
    domainIntervalMs: config.domainIntervalMs,
    addressIntervalMs: config.addressIntervalMs,
  });
  const backends = new ResolutionCache();

  const observations: Observation[] = [];
  let answered = 0;
  let next = 0;

  const worker = async (): Promise<void> => {
    for (let i = next++; i < entries.length; i = next++) {
      const observation = await checkOne(entries[i]!, input, limiter, backends, resolver, {
        run_id,
        cycle,
        slice,
      });
      observations.push(observation);
      if (SUCCEEDED.has(observation.outcome)) answered++;
      if (!config.dryRun) await appendObservation(dataDir, observation);
    }
  };

  const workers = Math.max(1, Math.min(config.maxConcurrentHosts, entries.length));
  await Promise.all(Array.from({ length: workers }, worker));

  observations.sort(
    (a, b) =>
      entries.findIndex((e) => e.domain === a.target_id) -
      entries.findIndex((e) => e.domain === b.target_id),
  );

  const summary: CensusSummary = {
    run_id,
    started_at,
    finished_at: new Date().toISOString(),
    targets_attempted: entries.length,
    targets_succeeded: answered,
    all_targets_failed: entries.length > 0 && answered === 0,
    outcome_breakdown: tally(observations.map((o) => o.outcome)),
    // Alongside outcomes, because at census scale the interesting shape is how
    // much of the frame has no website at all — and a reader should not have to
    // recompute it to notice it moved.
    presence_breakdown: tally(observations.map((o) => o.presence?.state ?? 'unknown')),
    vantage: config.vantage,
    tier: 'broad',
    cycle,
    slice,
    frame_digest: frame.digest,
    frame_size: frame.domains.length,
    slice_size: entries.length,
  };

  if (!config.dryRun) await appendRunSummary(dataDir, summary);
  return summary;
}

function tally(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, v) => {
    counts[v] = (counts[v] ?? 0) + 1;
    return counts;
  }, {});
}

async function checkOne(
  entry: FrameEntry,
  input: CensusInput,
  limiter: RateLimiter,
  backends: ResolutionCache,
  resolver: NameResolver,
  ids: { run_id: string; cycle: string; slice: number },
): Promise<Observation> {
  const { config } = input;
  const resolution = await classifyName(entry.domain, resolver);
  const derived = canonicalUrl(entry.domain, resolution);

  const method = {
    vantage: config.vantage,
    timeout_ms: config.timeoutMs,
    sample_count: 1,
    tool_version: config.toolVersion,
    source: 'self_run' as const,
  };

  const base = {
    schema: SCHEMA,
    run_id: ids.run_id,
    target_id: entry.domain,
    dimension: DIMENSION,
    tier: 'broad' as const,
    cycle: ids.cycle,
    slice: ids.slice,
    url_rule: URL_RULE,
    resolution,
    method,
  };

  // No web address, or none we could establish: nothing is requested. The record
  // says what DNS said and declines to claim more (FR-123, FR-121).
  //
  // The two reasons are different facts and get different outcomes. A resolver
  // that failed us is `dns_failure`, because it did. A resolver that answered —
  // mail only, no service, or no such name — did not fail: it told us there is no
  // website to request, and nothing was requested, which is what `skipped` means.
  // Calling that a DNS failure is this feature's own central error moved into the
  // outcome field, and it published: the first real slice reported 282 DNS
  // failures across 2,360 domains where roughly 36 were real.
  if (derived === undefined) {
    const ourFailure = resolution.status === 'resolver_error';
    const partial: Observation = {
      ...base,
      host: entry.domain,
      url: `https://${entry.domain}/`,
      checked_at: new Date().toISOString(),
      ...(ourFailure
        ? { outcome: 'dns_failure' as const }
        : {
            outcome: 'skipped' as const,
            skip_reason: `no web address published (${resolution.status})`,
          }),
      redirect_chain: [],
      latency: { samples: 0 },
      presence: { state: 'undetermined', rule: 'presence/1' },
    };
    return { ...partial, presence: presenceOf(partial) };
  }

  const url = input.urlOverride ? input.urlOverride(entry.domain) : derived;
  const host = new URL(url).hostname;

  const robots = await robotsAllows(url, host, config, limiter, backends);
  if (!robots.allowed) {
    const partial: Observation = {
      ...base,
      host,
      url,
      checked_at: robots.requestedAt,
      outcome: 'skipped',
      skip_reason: 'robots.txt disallows this path',
      redirect_chain: [],
      latency: { samples: 0 },
      presence: { state: 'undetermined', rule: 'presence/1' },
    };
    return { ...partial, presence: presenceOf(partial) };
  }

  const result = await sampleTarget(url, {
    samples: 1,
    timeoutMs: config.timeoutMs,
    maxRedirects: config.maxRedirects,
    limiter,
    backends,
    // Asking permission and then acting on the answer is one visit. The backend
    // budget still charges — that is the limit protecting a shared machine — but
    // the name-keyed interval does not, because it exists to space two
    // *independent* readings and this is not two (R8a).
    visiting: [robots.contacted],
  });

  const partial: Observation = {
    ...base,
    host,
    url,
    checked_at: result.requestedAt,
    ...(result.address !== undefined ? { address: result.address } : {}),
    outcome: result.outcome,
    ...(result.statusCode !== undefined ? { status_code: result.statusCode } : {}),
    redirect_chain: result.redirectChain,
    latency: result.latency,
    presence: { state: 'undetermined', rule: 'presence/1' },
  };

  // Computed from the finished row, never alongside it. That is what keeps the
  // reading a pure function of stored facts, and FR-119 with it.
  return { ...partial, presence: presenceOf(partial) };
}

interface RobotsDecision {
  allowed: boolean;
  requestedAt: string;
  /** The host this request contacted, so the page fetch continues the same visit. */
  contacted: string;
}

async function robotsAllows(
  url: string,
  host: string,
  config: CensusConfig,
  limiter: RateLimiter,
  backends: ResolutionCache,
): Promise<RobotsDecision> {
  const robotsUrl = new URL('/robots.txt', url).toString();
  const backend = await backends.get(host);
  const granted = await limiter.acquire(host, backend.address);
  const requestedAt = new Date(granted).toISOString();
  const body = await fetchTextForEvaluation(robotsUrl, {
    timeoutMs: config.timeoutMs,
    maxRedirects: config.maxRedirects,
    ...(backend.address !== undefined && backend.family !== undefined
      ? { lookup: pinnedLookup(backend.address, backend.family) }
      : {}),
  });

  if (body === undefined) return { allowed: true, requestedAt, contacted: host };
  return {
    allowed: isAllowed(parseRobots(body), new URL(url).pathname),
    requestedAt,
    contacted: host,
  };
}

export type { NameResolution };
