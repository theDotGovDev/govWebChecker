import fs from 'node:fs/promises';
import path from 'node:path';
import { parseTargets } from '../targets/load.js';
import { buildSiteModel, type RunRow } from '../site/model.js';
import { writePages, type WrittenPages } from '../site/pages.js';
import type { Frame } from '../census/frame.js';
import type { Observation } from '../record/types.js';

async function readJsonl<T>(dir: string): Promise<T[]> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const rows: T[] = [];
  for (const name of names.filter((n) => n.endsWith('.jsonl')).sort()) {
    const text = await fs.readFile(path.join(dir, name), 'utf8');
    for (const line of text.split('\n')) {
      if (line.trim() !== '') rows.push(JSON.parse(line) as T);
    }
  }
  return rows;
}

export interface BuildOptions {
  data: string;
  out: string;
  frame?: string;
  targets: string;
  exclusions?: string;
  now?: Date;
}

/**
 * Reads the record, builds the model, writes the whole site — index, tier
 * pages, one listing per site, one page per registered domain.
 *
 * Refusals are the contract's point, not an inconvenience: a build that cannot
 * attach a method to a figure fails here rather than publishing (FR-251), which
 * is the same reasoning that makes check.yml discard a run that violated its
 * own guarantees.
 */
export async function buildSite(options: BuildOptions): Promise<WrittenPages> {
  const observations = await readJsonl<Observation>(path.join(options.data, 'availability'));
  const runs = await readJsonl<RunRow>(path.join(options.data, 'runs'));

  const frame = options.frame
    ? (JSON.parse(await fs.readFile(options.frame, 'utf8')) as Frame)
    : undefined;
  const excluded = options.exclusions
    ? (JSON.parse(await fs.readFile(options.exclusions, 'utf8')) as {
        excluded: { domain: string }[];
      }).excluded.map((e) => e.domain)
    : [];

  const model = buildSiteModel({
    targets: parseTargets(await fs.readFile(options.targets, 'utf8')),
    observations,
    runs,
    ...(frame ? { frame } : {}),
  });

  return writePages({
    model,
    observations,
    ...(frame ? { frame } : {}),
    outDir: options.out,
    generatedAt:
      (options.now ?? new Date()).toISOString().replace('T', ' ').slice(0, 16) + ' UTC',
    excluded,
  });
}

/** build-site [--data <dir>] [--out <dir>] [--frame <path>] [--targets <path>] */
async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const options: BuildOptions = {
    data: 'data',
    out: 'docs',
    frame: 'targets/dotgov-frame.json',
    targets: 'targets/federal.json',
    exclusions: 'targets/excluded.json',
  };
  // The old positional form is still accepted so pages.yml history stays
  // replayable: build-site <targets.json> <data-dir> <out-dir>.
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--data') options.data = argv[++i] ?? options.data;
    else if (arg === '--out') options.out = argv[++i] ?? options.out;
    else if (arg === '--frame') { const v = argv[++i]; if (v !== undefined) options.frame = v; }
    else if (arg === '--targets') options.targets = argv[++i] ?? options.targets;
    else if (arg === '--exclusions') { const v = argv[++i]; if (v !== undefined) options.exclusions = v; }
    else positional.push(arg);
  }
  if (positional.length === 3) {
    options.targets = positional[0]!;
    options.data = positional[1]!;
    options.out = positional[2]!;
  } else if (positional.length !== 0) {
    console.error('usage: build-site [--data <dir>] [--out <dir>] [--frame <path>] [--targets <path>] [--exclusions <path>]');
    return 1;
  }

  // Absent optional inputs are absent questions, not errors.
  for (const key of ['frame', 'exclusions'] as const) {
    const file = options[key];
    if (file !== undefined) {
      try {
        await fs.access(file);
      } catch {
        delete options[key];
      }
    }
  }

  const written = await buildSite(options);
  console.log(`site written to ${options.out}`);
  console.log(`  listings:      ${written.listings} (${written.pending} awaiting a first reading)`);
  console.log(`  domain pages:  ${written.domains}`);
  console.log(`  excluded:      ${written.excluded}`);
  return 0;
}

// Run only when invoked as a program. A test importing buildSite must not
// trigger a CLI parse of the test runner's argv.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      console.error(`cannot build site: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    });
}
