import fs from 'node:fs/promises';
import path from 'node:path';
import { parseTargets, activeTargets } from '../targets/load.js';
import { executeRun } from '../checker/run.js';
import { verifyRecord, formatReport } from './verify.js';

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
   * Distinct hosts in flight. Politeness is a property of what we do to one
   * server, so checking unrelated agencies in parallel is not less polite — and
   * serializing everything would put a few hundred targets beyond any sane
   * schedule (SC-008).
   */
  maxConcurrentHosts: 6,
} as const;

const TOOL_VERSION = '0.1.0';

interface Args {
  command: string;
  targets: string;
  out: string;
  only?: string;
  dryRun: boolean;
  file?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    command: argv[0] ?? 'help',
    targets: 'targets/federal.json',
    out: 'data',
    dryRun: false,
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
  const report = await verifyRecord(args.file, {
    hostIntervalMs: LIMITS.hostIntervalMs,
    domainIntervalMs: LIMITS.domainIntervalMs,
  });
  console.log(formatReport(report));
  return report.ok ? 0 : 1;
}

const USAGE = `govWebChecker

  check  [--targets <path>] [--out <dir>] [--only <id>] [--dry-run]
  verify <record.jsonl>

There is deliberately no option to weaken a rate limit, shorten a timeout, or
change the User-Agent. See specs/001-record-availability/contracts/checker-cli.md.
`;

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  switch (args.command) {
    case 'check':
      return check(args);
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
