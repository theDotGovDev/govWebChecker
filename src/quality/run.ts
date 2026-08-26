import { randomUUID } from 'node:crypto';
import { RateLimiter } from '../politeness/rate-limiter.js';
import { ResolutionCache } from '../checker/resolve.js';
import { robotsAllows } from '../checker/permission.js';
import { appendQualityReading, appendRunSummary } from '../record/writer.js';
import { deepCheck, SCHEMA, type DeepReading, type ToolRun } from './deep-check.js';

export interface DeepTarget {
  id: string;
  host: string;
  url: string;
}

export interface DeepRunConfig {
  timeoutMs: number;
  maxRedirects: number;
  hostIntervalMs: number;
  domainIntervalMs: number;
  addressIntervalMs: number;
  vantage: string;
  /** The tool preset every reading in this pass was taken at. */
  preset: string;
  /** When true, produce readings but write nothing. Traffic is unchanged. */
  dryRun?: boolean;
}

export interface DeepRunInput {
  targets: DeepTarget[];
  dataDir: string;
  config: DeepRunConfig;
  run: ToolRun;
}

export interface DeepRunSummary {
  run_id: string;
  dimension: 'quality';
  started_at: string;
  finished_at: string;
  targets_attempted: number;
  targets_measured: number;
  all_targets_failed: boolean;
  outcome_breakdown: Record<string, number>;
  vantage: string;
  preset: string;
  /**
   * How many page loads ran at once. One, and recorded so that stays checkable.
   */
  concurrency: 1;
  readings: DeepReading[];
}

const DIMENSION = 'quality';

/**
 * One deep pass: ask permission, load the page once, write down what happened.
 *
 * **Serial, deliberately.** The availability pass checks different hosts
 * concurrently because politeness is a property of what we do to one server. A
 * deep pass cannot borrow that reasoning, and the reason is measurement validity
 * rather than politeness: two browsers competing for the same runner CPU inflate
 * blocking time and time-to-interactive on both. The numbers would describe our
 * scheduling rather than the page, which is the same failure mode as measuring
 * from a sandbox and publishing it as a fact about an agency.
 *
 * So this trades wall-clock for numbers that mean something, and records the
 * concurrency in the run summary so a reader does not have to take it on trust.
 *
 * A target that fails is recorded and the pass continues. Nothing here throws
 * because a page did not render — that is data (Principle IV).
 */
export async function executeDeepRun({
  targets,
  dataDir,
  config,
  run,
}: DeepRunInput): Promise<DeepRunSummary> {
  const started_at = new Date().toISOString();
  const run_id = `${started_at}/${DIMENSION}/${randomUUID().slice(0, 8)}`;
  const limiter = new RateLimiter({
    hostIntervalMs: config.hostIntervalMs,
    domainIntervalMs: config.domainIntervalMs,
    addressIntervalMs: config.addressIntervalMs,
  });
  const backends = new ResolutionCache();

  const readings: DeepReading[] = [];
  let measured = 0;

  for (const target of targets) {
    const context = {
      run_id,
      target_id: target.id,
      host: target.host,
      url: target.url,
      vantage: config.vantage,
      preset: config.preset,
    };

    const permission = await robotsAllows(
      target.url,
      target.host,
      { timeoutMs: config.timeoutMs, maxRedirects: config.maxRedirects },
      limiter,
      backends,
    );

    const reading: DeepReading = permission.allowed
      ? await deepCheck(context, {
          run,
          limiter,
          ...((await backends.get(target.host)).address !== undefined
            ? { address: (await backends.get(target.host)).address! }
            : {}),
        })
      : {
          schema: SCHEMA,
          ...context,
          dimension: DIMENSION,
          // The robots fetch was the only request this target received, so it is
          // the moment this check ran.
          checked_at: `${permission.requestedAt.slice(0, 19)}Z`,
          outcome: 'skipped',
          skip_reason: 'robots.txt disallows this path',
          metrics: {},
          method: {
            tool: 'lighthouse',
            tool_version: 'not-run',
            preset: config.preset,
            device: { form_factor: 'not-run', width: 0, height: 0, scale: 0, mobile: false },
            network: { rtt_ms: 0, throughput_kbps: 0, cpu_slowdown: 0, method: 'not-run' },
            vantage: config.vantage,
            source: 'self_run',
          },
        };

    readings.push(reading);
    if (reading.outcome === 'measured') measured++;
    // Appended inside the loop so a crash mid-pass leaves the readings already
    // taken on disk rather than losing the whole run.
    if (!config.dryRun) await appendQualityReading(dataDir, reading);
  }

  const summary: DeepRunSummary = {
    run_id,
    dimension: DIMENSION,
    started_at,
    finished_at: new Date().toISOString(),
    targets_attempted: targets.length,
    targets_measured: measured,
    // Every page failing at once is more likely our runner — a browser that did
    // not start, a network that refuses — than every agency at once (FR-024).
    all_targets_failed: targets.length > 0 && measured === 0,
    outcome_breakdown: readings.reduce<Record<string, number>>((counts, r) => {
      counts[r.outcome] = (counts[r.outcome] ?? 0) + 1;
      return counts;
    }, {}),
    vantage: config.vantage,
    preset: config.preset,
    concurrency: 1,
    readings,
  };

  if (!config.dryRun) {
    // The rows are already on disk; duplicating them here would make the run
    // file grow with content it does not own.
    const { readings: _omitted, ...persisted } = summary;
    await appendRunSummary(dataDir, persisted);
  }

  return summary;
}
