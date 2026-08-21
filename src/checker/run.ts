import { randomUUID } from 'node:crypto';
import type { Target } from '../targets/load.js';
import type { Observation } from '../record/types.js';
import { RateLimiter } from '../politeness/rate-limiter.js';
import { appendObservation, appendRunSummary } from '../record/writer.js';
import { sampleTarget } from './sample.js';
import { fetchTextForEvaluation } from './check.js';
import { parseRobots, isAllowed } from './robots.js';

export interface RunConfig {
  samples: number;
  timeoutMs: number;
  maxRedirects: number;
  hostIntervalMs: number;
  domainIntervalMs: number;
  /** How many distinct hosts may be in flight at once (FR-003). */
  maxConcurrentHosts: number;
  vantage: string;
  toolVersion: string;
  /** When true, produce observations but write nothing. Traffic is unchanged. */
  dryRun?: boolean;
}

export interface RunInput {
  targets: Target[];
  dataDir: string;
  config: RunConfig;
}

export interface RunSummary {
  run_id: string;
  started_at: string;
  finished_at: string;
  targets_attempted: number;
  targets_succeeded: number;
  all_targets_failed: boolean;
  /** How many targets landed on each outcome. Uniformity is the tell. */
  outcome_breakdown: Record<string, number>;
  vantage: string;
  observations: Observation[];
}

const SCHEMA = '1';
const DIMENSION = 'availability';

/**
 * Only a successful measurement counts toward a run being trustworthy.
 *
 * `blocked` deliberately does NOT count, and that distinction was learned the
 * hard way: run from a network whose egress refused the connections, every
 * target came back 403/blocked and the run looked healthy. The record would have
 * asserted that named federal agencies refuse automated traffic, when the fault
 * was entirely ours. We cannot tell a target refusing us from our own path
 * refusing us, so a run with no successes is marked and left for a reader to
 * discount.
 */
const SUCCEEDED = new Set(['success']);

interface RobotsDecision {
  allowed: boolean;
  /** UTC moment the limiter released the robots.txt fetch. */
  requestedAt: string;
}

async function robotsAllows(
  target: Target,
  config: RunConfig,
  limiter: RateLimiter,
): Promise<RobotsDecision> {
  const robotsUrl = new URL('/robots.txt', target.url).toString();
  const granted = await limiter.acquire(target.host);
  const requestedAt = new Date(granted).toISOString();
  const body = await fetchTextForEvaluation(robotsUrl, {
    timeoutMs: config.timeoutMs,
    maxRedirects: config.maxRedirects,
  });

  // Only an explicit, readable prohibition stops us. An unreachable robots.txt is
  // not consent, but neither is it a refusal — treating a fetch failure as a
  // block would silently stop measuring every site having a bad day.
  if (body === undefined) return { allowed: true, requestedAt };
  return { allowed: isAllowed(parseRobots(body), new URL(target.url).pathname), requestedAt };
}

/**
 * One pass over the targets.
 *
 * Different hosts are checked concurrently, up to a bound; one host is never
 * checked concurrently with itself. That distinction is the whole of FR-003:
 * politeness is a property of what we do to a single server, not of our total
 * throughput, and serializing everything would make a run take hours without
 * being any gentler on any individual site.
 *
 * The rate limiter is shared across the workers, so per-host and per-domain
 * spacing hold regardless of how the work is scheduled.
 *
 * A target that fails is recorded and the run continues (FR-023). Nothing here
 * throws because a site was down — that is data, not an error (FR-025).
 */
export async function executeRun({ targets, dataDir, config }: RunInput): Promise<RunSummary> {
  const started_at = new Date().toISOString();
  const run_id = `${started_at}/${DIMENSION}/${randomUUID().slice(0, 8)}`;
  const limiter = new RateLimiter({
    hostIntervalMs: config.hostIntervalMs,
    domainIntervalMs: config.domainIntervalMs,
  });

  const active = targets.filter((t) => t.active);
  const observations: Observation[] = [];
  let answered = 0;
  let next = 0;

  const worker = async (): Promise<void> => {
    for (let index = next++; index < active.length; index = next++) {
      const observation = await checkOne(active[index]!, config, limiter, run_id);
      observations.push(observation);
      if (SUCCEEDED.has(observation.outcome)) answered++;
      // Appends are awaited inside the worker so a crash mid-run leaves the
      // observations already taken on disk rather than losing the whole pass.
      if (!config.dryRun) await appendObservation(dataDir, observation);
    }
  };

  const workers = Math.max(1, Math.min(config.maxConcurrentHosts, active.length));
  await Promise.all(Array.from({ length: workers }, worker));

  // Restore list order so the record does not depend on scheduling.
  observations.sort(
    (a, b) =>
      active.findIndex((t) => t.id === a.target_id) - active.findIndex((t) => t.id === b.target_id),
  );

  const summary: RunSummary = {
    run_id,
    started_at,
    finished_at: new Date().toISOString(),
    targets_attempted: active.length,
    targets_succeeded: answered,
    // A run where nothing succeeded is more likely our network than every
    // government site at once. Marking it lets a reader discount it (FR-024).
    all_targets_failed: active.length > 0 && answered === 0,
    outcome_breakdown: observations.reduce<Record<string, number>>((counts, o) => {
      counts[o.outcome] = (counts[o.outcome] ?? 0) + 1;
      return counts;
    }, {}),
    vantage: config.vantage,
    observations,
  };

  if (!config.dryRun) {
    // `observations` is the in-process return value, not part of the record —
    // the rows are already on disk and duplicating them here would make the run
    // file grow with content it does not own.
    const { observations: _omitted, ...persisted } = summary;
    await appendRunSummary(dataDir, persisted);
  }

  return summary;
}

async function checkOne(
  target: Target,
  config: RunConfig,
  limiter: RateLimiter,
  run_id: string,
): Promise<Observation> {
  const method = {
    vantage: config.vantage,
    timeout_ms: config.timeoutMs,
    sample_count: config.samples,
    tool_version: config.toolVersion,
    source: 'self_run' as const,
  };

  const base = {
    schema: SCHEMA,
    run_id,
    target_id: target.id,
    host: target.host,
    url: target.url,
    dimension: DIMENSION,
    method,
  };

  const robots = await robotsAllows(target, config, limiter);
  if (!robots.allowed) {
    return {
      ...base,
      // The robots.txt fetch was the only request this target received, so it is
      // the moment this check ran.
      checked_at: robots.requestedAt,
      outcome: 'skipped',
      skip_reason: 'robots.txt disallows this path',
      redirect_chain: [],
      latency: { samples: 0 },
    };
  }

  const result = await sampleTarget(target.url, {
    samples: config.samples,
    timeoutMs: config.timeoutMs,
    maxRedirects: config.maxRedirects,
    limiter,
  });

  return {
    ...base,
    // The limiter's own grant moment, not a later clock read. A robots.txt fetch
    // sits between the two and its cost varies per site, so re-reading the clock
    // published gaps that drifted below the spacing the limiter had enforced.
    checked_at: result.requestedAt,
    outcome: result.outcome,
    ...(result.statusCode !== undefined ? { status_code: result.statusCode } : {}),
    redirect_chain: result.redirectChain,
    latency: result.latency,
  };
}
