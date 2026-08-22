import fs from 'node:fs/promises';
import path from 'node:path';
import { parseTargets, activeTargets } from '../targets/load.js';
import { executeRun } from '../checker/run.js';
import { verifyRecord, formatReport } from './verify.js';
import { executeCensus } from '../census/run.js';
import { buildFrame, DEFAULT_SOURCE, type Frame, type Exclusion } from '../census/frame.js';
import { sliceForDate, SLICES } from '../census/slice.js';

/**
 * The traffic limits. Constants, not options.
 *
 * `contracts/checker-cli.md` lists what deliberately does not exist here: no
 * `--concurrency`, no `--rate-limit`, no `--timeout`, not even for local runs — a
 * local run reaches the same government servers a scheduled one does. Principle
 * III says a caller must not be able to forget the limits, and an override flag
 * is how that erodes. Tests construct the checker directly with a test
 * configuration instead, so the escape hatch exists where it cannot ship.
 */
const LIMITS = {
  /**
   * One reading per check. Repeated samples seconds apart measure the same cache
   * in the same moment and are near-duplicates; hourly readings are independent,
   * so the series carries the statistics instead (FR-011a).
   */
  samples: 1,
  timeoutMs: 15_000,
  maxRedirects: 5,
  /**
   * Spacing between requests to one host. Three samples 15s apart is well within
   * what an ordinary visitor reloading a page produces, and gives readings far
   * enough apart to be independent.
   */
  hostIntervalMs: 15_000,
  domainIntervalMs: 5_000,
  /**
   * Spacing between requests to one backend, however many distinct names reach
   * it. Matches the per-domain interval, because it answers the same question
   * one level up: several names, one machine.
   *
   * The measured cost is negligible. The `.gov` hosting survey (run
   * 32548354070) found the worst single-slice cluster to be 89 domains on one
   * address, which this serialises to about 7 minutes against a job cap of 60 —
   * so there is no throughput reason to weaken it, and none to carve out
   * exemptions for large networks whose capacity we would only be guessing at.
   */
  addressIntervalMs: 5_000,
  /**
   * Distinct hosts in flight. Politeness is a property of what we do to one
   * server, so checking unrelated agencies in parallel is not less polite — and
   * serializing everything would put a few hundred targets beyond any sane
   * schedule (SC-008).
   *
   * Raised from 6 to 12 for the census, which is the change FR-133 blocked until
   * the shared-hosting gap was closed. The precondition is now met and is what
   * makes this safe rather than merely faster: the per-address limit means twelve
   * workers cannot pile onto one backend however many distinct names route there.
   * Without it, doubling this number would have doubled the burst any single
   * shared vendor could receive.
   *
   * Twelve is the ceiling, not a starting point. FR-132 fixes the bound at the
   * order of a dozen and a test fails if the shipped value goes past it — this is
   * the number governing how many separate government servers hear from us at the
   * same moment, and changing it is a change to what this project does to public
   * infrastructure rather than a tuning decision.
   *
   * Measured: a census slice of ~2,045 web-publishing domains spends ~91 minutes
   * waiting on the limits at 6 and ~46 at 12, against a 120-minute job cap the
   * first live sweep hit exactly.
   */
  maxConcurrentHosts: 12,
} as const;

const TOOL_VERSION = '0.1.0';

interface Args {
  command: string;
  targets: string;
  out: string;
  only?: string;
  dryRun: boolean;
  file?: string;
  frame: string;
  exclusions: string;
  source?: string;
  slice?: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    command: argv[0] ?? 'help',
    targets: 'targets/federal.json',
    out: 'data',
    dryRun: false,
    frame: 'targets/dotgov-frame.json',
    exclusions: 'targets/excluded.json',
  };

  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--targets') args.targets = argv[++i] ?? args.targets;
    else if (arg === '--out') args.out = argv[++i] ?? args.out;
    else if (arg === '--only') {
      const value = argv[++i];
      if (value === undefined) throw new Error('--only requires a target id');
      args.only = value;
    }
    else if (arg === '--frame') args.frame = argv[++i] ?? args.frame;
    else if (arg === '--exclusions') args.exclusions = argv[++i] ?? args.exclusions;
    else if (arg === '--source') {
      const value = argv[++i];
      if (value === undefined) throw new Error('--source requires a URL');
      args.source = value;
    }
    else if (arg === '--slice') {
      const value = Number(argv[++i]);
      if (!Number.isInteger(value) || value < 0 || value >= SLICES) {
        throw new Error(`--slice requires an integer in 0..${SLICES - 1}`);
      }
      args.slice = value;
    }
    else if (!arg.startsWith('--')) args.file = arg;
    else throw new Error(`unknown option: ${arg}`);
  }
  return args;
}

function vantage(): string {
  return process.env['GITHUB_ACTIONS'] === 'true'
    ? `github-actions/${process.env['RUNNER_OS'] ?? 'unknown'}`
    : 'local';
}

async function check(args: Args): Promise<number> {
  const targets = parseTargets(await fs.readFile(args.targets, 'utf8'));
  const selected = args.only
    ? activeTargets(targets).filter((t) => t.id === args.only)
    : activeTargets(targets);

  if (args.only && selected.length === 0) throw new Error(`no active target with id "${args.only}"`);

  const summary = await executeRun({
    targets: selected,
    dataDir: args.out,
    config: {
      ...LIMITS,
      vantage: vantage(),
      toolVersion: TOOL_VERSION,
      ...(args.dryRun ? { dryRun: true } : {}),
    },
  });

  if (args.dryRun) {
    for (const observation of summary.observations) console.log(JSON.stringify(observation));
  }

  const counts = new Map<string, number>();
  for (const o of summary.observations) counts.set(o.outcome, (counts.get(o.outcome) ?? 0) + 1);
  const breakdown = [...counts].map(([k, v]) => `${k}=${v}`).join(' ');

  console.error(
    `run ${summary.run_id}\n` +
      `  ${summary.targets_attempted} targets, ${breakdown}${args.dryRun ? ' (dry run, nothing written)' : ''}` +
      (summary.all_targets_failed ? '\n  WARNING: every target failed — suspect our own network' : ''),
  );

  // A down target is data, not a failure of this command (FR-025, Principle IV).
  // Exit non-zero only when the run itself could not proceed, which throws.
  return 0;
}

async function verify(args: Args): Promise<number> {
  if (!args.file) throw new Error('usage: verify <record.jsonl>');
  // The frame is optional: `verify` runs against records that predate the census,
  // and absence of a frame is absence of a question rather than a failed answer.
  const frame = await readFrame(args.frame).catch(() => undefined);
  const report = await verifyRecord(
    args.file,
    {
      hostIntervalMs: LIMITS.hostIntervalMs,
      domainIntervalMs: LIMITS.domainIntervalMs,
      addressIntervalMs: LIMITS.addressIntervalMs,
    },
    frame,
  );
  console.log(formatReport(report));
  return report.ok ? 0 : 1;
}

async function readFrame(path: string): Promise<Frame> {
  return JSON.parse(await fs.readFile(path, 'utf8')) as Frame;
}

/**
 * Rebuilds the census frame from the published registry.
 *
 * Makes exactly one HTTP request, to the registry. It contacts no government web
 * server, so the traffic rules that govern `check` do not bite here — but it
 * ships as a workflow all the same, because a frame recomputed only inside an
 * ephemeral session is a frame nobody can recompute later.
 */
async function buildFrameCommand(args: Args): Promise<number> {
  const source = args.source ?? DEFAULT_SOURCE;
  const response = await fetch(source);
  if (!response.ok) throw new Error(`registry fetch failed: ${response.status}`);
  const csv = await response.text();

  const exclusions = await fs
    .readFile(args.exclusions, 'utf8')
    .then((text) => (JSON.parse(text) as { excluded: Exclusion[] }).excluded)
    .catch(() => [] as Exclusion[]);

  const previous = await readFrame(args.frame)
    .then((f) => ({ size: f.domains.length }))
    .catch(() => undefined);

  const frame = buildFrame({
    csv,
    exclusions,
    retrievedAt: new Date().toISOString(),
    source,
    ...(previous ? { previous } : {}),
  });

  if (args.dryRun) {
    console.error(`${frame.domains.length} domains, digest ${frame.digest} (dry run)`);
    return 0;
  }

  await fs.writeFile(args.frame, JSON.stringify(frame, null, 2) + '\n', 'utf8');
  console.error(
    `frame: ${frame.domains.length} domains, ${exclusions.length} excluded, ` +
      `digest ${frame.digest}`,
  );
  return 0;
}

/** One broad-tier slice. */
async function census(args: Args): Promise<number> {
  const frame = await readFrame(args.frame);
  const slice = args.slice ?? sliceForDate(new Date());

  const summary = await executeCensus({
    frame,
    slice,
    dataDir: args.out,
    config: {
      ...LIMITS,
      vantage: vantage(),
      toolVersion: TOOL_VERSION,
      ...(args.dryRun ? { dryRun: true } : {}),
    },
  });

  const breakdown = Object.entries(summary.outcome_breakdown)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
  const presence = Object.entries(summary.presence_breakdown)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');

  console.error(
    `census ${summary.run_id}\n` +
      `  cycle ${summary.cycle} slice ${summary.slice}: ` +
      `${summary.slice_size}/${summary.frame_size} domains\n` +
      `  outcomes: ${breakdown}\n` +
      `  presence: ${presence}` +
      (summary.all_targets_failed ? '\n  WARNING: every target failed — suspect our own network' : ''),
  );

  return 0;
}

const USAGE = `govWebChecker

  check        [--targets <path>] [--out <dir>] [--only <id>] [--dry-run]
  census       [--frame <path>] [--slice <0-6>] [--out <dir>] [--dry-run]
  build-frame  [--frame <path>] [--exclusions <path>] [--source <url>] [--dry-run]
  verify       <record.jsonl> [--frame <path>]

There is deliberately no option to weaken a rate limit, shorten a timeout, change
the User-Agent, raise concurrency, skip resolution, fall back to http, or force a
frame past its size guard. See specs/001-record-availability/contracts/checker-cli.md
and specs/003-dotgov-census/contracts/census-cli.md.
`;

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  switch (args.command) {
    case 'check':
      return check(args);
    case 'census':
      return census(args);
    case 'build-frame':
      return buildFrameCommand(args);
    case 'verify':
      return verify(args);
    default:
      console.log(USAGE);
      return args.command === 'help' ? 0 : 1;
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    // Reaching here means the run could not proceed — an unreadable target list,
    // an unwritable record directory. Never a site being down.
    console.error(`cannot run: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });

export { parseArgs, LIMITS };
