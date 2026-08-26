import type { RateLimiter } from '../politeness/rate-limiter.js';
import type { CaptureFinding } from './capture.js';

/**
 * A deep quality check: one emulated visitor loading one page, once.
 *
 * The availability check asks whether the server answered. This asks what
 * happened afterwards — how long until something was readable, whether the
 * layout moved under the reader, how much the page weighed on a slow phone.
 * Those are the questions people actually have, and they are not answerable
 * from a status code.
 *
 * Two things follow from that and shape everything here.
 *
 * The reading is only meaningful with its emulation attached. "2.4 seconds" is
 * not a property of a site; it is a property of a site loaded on a stated screen
 * over a stated connection. So the device and network travel with the number and
 * a reading that cannot state them is not produced at all (FR-321, Principle V).
 *
 * And a fuller page load is still one page load. It is more bytes than a single
 * request by an order of magnitude, and it is still exactly what one visitor
 * costs, which is the line Principle I draws. What stays prohibited is repeating
 * it: no second run to build a sample, no retry against a page that just failed.
 */

/** One measured value from the tool, with the unit the tool reported it in. */
export interface Metric {
  value: number;
  unit: string;
}

/** The emulated screen. Part of the method, not a setting. */
export interface DeviceEmulation {
  form_factor: string;
  width: number;
  height: number;
  scale: number;
  mobile: boolean;
}

/** The emulated connection and CPU. Also part of the method. */
export interface NetworkEmulation {
  rtt_ms: number;
  throughput_kbps: number;
  cpu_slowdown: number;
  /** How the throttling was applied — simulated, devtools, or provided. */
  method: string;
}

export interface DeepMethod {
  tool: string;
  tool_version: string;
  /** The tool's own preset name, so a reading is comparable to the same tool run elsewhere (FR-320). */
  preset: string;
  device: DeviceEmulation;
  network: NetworkEmulation;
  vantage: string;
  source: 'self_run';
}

/**
 * Whether the *check* produced a reading — never whether the *site* was up.
 *
 * A tool that could not measure a page has said nothing about the page's
 * availability, and merging the two would let a Chrome crash be published as a
 * government website being down (FR-324).
 *
 * `skipped` is the third state and is not a failure of either kind: it is a page
 * we were asked not to fetch, and the record says so rather than leaving a gap a
 * reader would have to guess at.
 */
export type DeepOutcome = 'measured' | 'check_failed' | 'skipped';

export interface DeepReading {
  schema: string;
  run_id: string;
  target_id: string;
  host: string;
  url: string;
  dimension: 'quality';
  checked_at: string;
  outcome: DeepOutcome;
  /** Why the tool could not produce a reading. Present only when it could not. */
  check_failure?: string;
  /** Why no check was attempted. Present only on a skipped reading. */
  skip_reason?: string;
  /** The final URL the tool settled on, when it got that far. */
  final_url?: string;
  /**
   * Measured values only.
   *
   * The tool also reports category scores — a weighted composite of these very
   * numbers. Those belong to the analysis layer (D3): they are reproducible from
   * what is stored here plus a published weighting, which is precisely why
   * storing them would put a derived figure in the layer that holds observations.
   */
  metrics: Record<string, Metric>;
  /**
   * What the page looked like, described rather than shown.
   *
   * The images live where build artifacts live and are regenerated into each
   * deploy; these are the findings, which is what the record keeps forever
   * (constitution 2.1.0). At most one per device profile — with nowhere for a
   * history to accumulate, latest-only holds by construction.
   */
  views?: CaptureFinding[];
  method: DeepMethod;
}

export interface ReadingContext {
  run_id: string;
  target_id: string;
  host: string;
  url: string;
  vantage: string;
  preset: string;
}

/**
 * The subset of a Lighthouse result a reading is built from.
 *
 * Structural rather than imported: the tool is a development dependency that
 * runs in the collection workflow, and the record's shape should not become a
 * function of a library version.
 */
export interface ToolResult {
  lighthouseVersion?: string;
  fetchTime?: string;
  finalDisplayedUrl?: string;
  configSettings?: {
    formFactor?: string;
    screenEmulation?: { width?: number; height?: number; deviceScaleFactor?: number; mobile?: boolean };
    throttling?: { rttMs?: number; throughputKbps?: number; cpuSlowdownMultiplier?: number };
    throttlingMethod?: string;
  };
  audits?: Record<string, { numericValue?: number; numericUnit?: string }>;
}

/**
 * Runs the tool against one URL.
 *
 * `onPage` is invoked once the tool has finished and before the page is closed,
 * so a rendered view can be taken from the navigation that already happened.
 * That is the difference between a capture costing nothing and a capture costing
 * someone else's server another page load.
 */
export type ToolRun = (url: string, onPage?: () => Promise<void>) => Promise<ToolResult>;

export const SCHEMA = 'govwebchecker/quality/1';

/**
 * The audits carried into the record, and the names they are stored under.
 *
 * A fixed list rather than everything the tool emits: the record is a published
 * product, and a field that appears because a tool version started emitting it
 * is a field nobody decided to publish. Each of these is a Core Web Vital or a
 * lab metric PageSpeed Insights reports, so a reader can compare a stored number
 * to one they ran themselves.
 */
const METRICS: Record<string, string> = {
  'largest-contentful-paint': 'largest_contentful_paint',
  'cumulative-layout-shift': 'cumulative_layout_shift',
  'total-blocking-time': 'total_blocking_time',
  'speed-index': 'speed_index',
  'first-contentful-paint': 'first_contentful_paint',
  'interactive': 'time_to_interactive',
  'server-response-time': 'server_response_time',
  'total-byte-weight': 'total_byte_weight',
};

function utc(at: Date): string {
  return `${at.toISOString().slice(0, 19)}Z`;
}

function emulation(result: ToolResult): { device: DeviceEmulation; network: NetworkEmulation } {
  const settings = result.configSettings ?? {};
  const screen = settings.screenEmulation;
  const throttling = settings.throttling;
  // A reading whose emulation is unknown is not comparable to anything, so it is
  // refused rather than published with the method half-stated (Principle V).
  if (!screen || !throttling || screen.width === undefined || throttling.rttMs === undefined) {
    throw new Error(
      'the run reported no screen or network emulation; a deep reading without its emulation is not comparable',
    );
  }
  return {
    device: {
      form_factor: settings.formFactor ?? 'unknown',
      width: screen.width,
      height: screen.height ?? 0,
      scale: screen.deviceScaleFactor ?? 1,
      mobile: screen.mobile ?? false,
    },
    network: {
      rtt_ms: throttling.rttMs,
      throughput_kbps: throttling.throughputKbps ?? 0,
      cpu_slowdown: throttling.cpuSlowdownMultiplier ?? 1,
      method: settings.throttlingMethod ?? 'unknown',
    },
  };
}

/**
 * Builds a reading from a completed run. Throws if the run cannot state its method.
 *
 * `checkedAt` is the moment the limiter released this check, not the tool's own
 * `fetchTime` — a different clock in a different process. Dating a reading to the
 * grant is what makes the record's spacing checkable by a reader rather than
 * taken on trust, and it is what the availability record already does.
 */
export function readingFromRun(result: ToolResult, context: ReadingContext, checkedAt = new Date()): DeepReading {
  const { device, network } = emulation(result);

  const metrics: Record<string, Metric> = {};
  for (const [auditId, name] of Object.entries(METRICS)) {
    const audit = result.audits?.[auditId];
    // A pass/fail audit has no number, and an audit the tool skipped has none
    // either. Both are absences, and an absence is shown as one — never as zero.
    if (!audit || typeof audit.numericValue !== 'number' || !audit.numericUnit) continue;
    metrics[name] = { value: audit.numericValue, unit: audit.numericUnit };
  }

  return {
    schema: SCHEMA,
    run_id: context.run_id,
    target_id: context.target_id,
    host: context.host,
    url: context.url,
    dimension: 'quality',
    checked_at: utc(checkedAt),
    outcome: 'measured',
    ...(result.finalDisplayedUrl ? { final_url: result.finalDisplayedUrl } : {}),
    metrics,
    method: {
      tool: 'lighthouse',
      tool_version: result.lighthouseVersion ?? 'unknown',
      preset: context.preset,
      device,
      network,
      vantage: context.vantage,
      source: 'self_run',
    },
  };
}

export interface DeepCheckOptions {
  run: ToolRun;
  /** Called on the tool's own page, after it finishes and before it closes. */
  onPage?: () => Promise<void>;
  limiter: RateLimiter;
  /** The backend the navigation will reach, when it is known. */
  address?: string;
}

/**
 * Runs one deep check: take a slot, navigate once, record what came back.
 *
 * There is no retry and no second sample, and that is the whole design. A page
 * that failed to render is a page under strain or a page that is broken; either
 * way the answer is to write down what happened and leave, which is what
 * Principle IV asks and what Principle I requires.
 */
export async function deepCheck(context: ReadingContext, options: DeepCheckOptions): Promise<DeepReading> {
  const granted = new Date(await options.limiter.acquire(context.host, options.address));
  try {
    return readingFromRun(await options.run(context.url, options.onPage), context, granted);
  } catch (error) {
    return {
      schema: SCHEMA,
      run_id: context.run_id,
      target_id: context.target_id,
      host: context.host,
      url: context.url,
      dimension: 'quality',
      checked_at: utc(granted),
      outcome: 'check_failed',
      check_failure: error instanceof Error ? error.message : String(error),
      metrics: {},
      method: {
        tool: 'lighthouse',
        tool_version: 'unknown',
        preset: context.preset,
        device: { form_factor: 'unknown', width: 0, height: 0, scale: 0, mobile: false },
        network: { rtt_ms: 0, throughput_kbps: 0, cpu_slowdown: 0, method: 'unknown' },
        vantage: context.vantage,
        source: 'self_run',
      },
    };
  }
}
