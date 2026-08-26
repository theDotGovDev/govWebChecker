import { randomUUID } from 'node:crypto';
import { RateLimiter } from '../politeness/rate-limiter.js';
import { ResolutionCache } from '../checker/resolve.js';
import { robotsAllows } from '../checker/permission.js';
import { appendQualityReading, appendRunSummary } from '../record/writer.js';
import { deepCheck, SCHEMA, type DeepReading, type ToolRun } from './deep-check.js';
import {
  CAPTURE_PROFILES, CHANGE_RULE, hasMeaningfullyChanged,
  type CaptureFinding, type CaptureProfile,
} from './capture.js';
import fs from 'node:fs/promises';
import path from 'node:path';

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

/** One taken view, before it becomes a finding. */
export interface TakenView {
  hash: string;
  bytes: number;
  image: Uint8Array;
}

export interface DeepRunInput {
  targets: DeepTarget[];
  dataDir: string;
  config: DeepRunConfig;
  run: ToolRun;
  /**
   * Takes a view from the deep check's own page, once the tool has finished.
   *
   * This is what makes the phone view free: the navigation already happened, and
   * the profile matching the tool's preset is photographed from it rather than
   * from a page load of its own.
   */
  captureView?: (profile: CaptureProfile, page: unknown, scratch: unknown) => Promise<TakenView>;
  /**
   * Takes a view that cannot ride the deep check — a different form factor needs
   * a different viewport, and that means its own navigation. It is a page load
   * like any other and goes through the limiter.
   */
  captureStandalone?: (url: string, profile: CaptureProfile) => Promise<TakenView>;
  /** Where images are written. Absent means take and hash but store nothing. */
  viewsDir?: string;
  /** The hash last seen for this host and profile, if the record holds one. */
  previousHash?: (host: string, profile: string) => string | undefined;
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
 * Which profiles the deep check's own navigation can speak for.
 *
 * Two things have to match, and the engine is the one that is easy to forget.
 * The tool renders at its preset's form factor, so a view at that form factor is
 * the page it already loaded — but it renders in Blink, so a WebKit profile
 * photographed from that page would be a Chromium picture filed under Safari.
 * That is exactly the claim the WebKit profile exists to avoid making, and
 * matching on form factor alone made it: both phone profiles are phones.
 *
 * Anything that cannot ride is a different rendering and needs its own page
 * load, which is a real cost paid deliberately rather than hidden.
 */
function ridesTheDeepCheck(profile: CaptureProfile, preset: string): boolean {
  if (profile.engine !== 'blink') return false;
  return preset.endsWith('/mobile') ? profile.formFactor === 'phone' : profile.formFactor === 'desktop';
}

async function storeView(
  viewsDir: string | undefined,
  host: string,
  profile: CaptureProfile,
  view: TakenView,
  changed: boolean,
): Promise<void> {
  // An unchanged view is left exactly where it is. Rewriting an identical file
  // would spend the saving the change check exists to buy, and would touch a
  // build artifact for no reason.
  if (!viewsDir || !changed) return;
  const file = path.join(viewsDir, host, `${profile.id}.webp`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, view.image);
}

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
  captureView,
  captureStandalone,
  viewsDir,
  previousHash,
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

    const taken: { profile: CaptureProfile; view: TakenView }[] = [];

    const reading: DeepReading = permission.allowed
      ? await deepCheck(context, {
          run,
          limiter,
          ...(captureView
            ? {
                onPage: async (page: unknown, scratch: unknown) => {
                  for (const profile of CAPTURE_PROFILES) {
                    if (!ridesTheDeepCheck(profile, config.preset)) continue;
                    taken.push({ profile, view: await captureView(profile, page, scratch) });
                  }
                },
              }
            : {}),
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

    // A page that did not load has nothing to photograph, and asking again would
    // be a second request to a site that just failed.
    if (reading.outcome === 'measured' && captureStandalone) {
      for (const profile of CAPTURE_PROFILES) {
        if (ridesTheDeepCheck(profile, config.preset)) continue;
        // Its own navigation, so its own slot. A second page load is still a
        // page load, and the limiter is where that is accounted for.
        await limiter.acquire(target.host, (await backends.get(target.host)).address);
        taken.push({ profile, view: await captureStandalone(target.url, profile) });
      }
    }

    if (taken.length > 0) {
      const views: CaptureFinding[] = [];
      for (const { profile, view } of taken) {
        const changed = hasMeaningfullyChanged(previousHash?.(target.host, profile.id), view.hash);
        await storeView(viewsDir, target.host, profile, view, changed);
        views.push({
          profile: profile.id,
          width: profile.width,
          height: profile.height,
          scale: profile.scale,
          engine: profile.engine,
          captured_at: reading.checked_at,
          hash: view.hash,
          rule: CHANGE_RULE.version,
          bytes: view.bytes,
          changed,
        });
      }
      // "We looked and it was the same" is a measurement. Recording only the
      // changes would make an unchanged page indistinguishable from one nobody
      // ever photographed.
      reading.views = views;
    }

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
