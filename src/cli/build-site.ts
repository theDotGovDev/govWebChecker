import fs from 'node:fs/promises';
import path from 'node:path';
import { parseTargets } from '../targets/load.js';
import { buildSiteModel, type RunRow } from '../site/model.js';
import { writePages, type WrittenPages } from '../site/pages.js';
import type { Frame } from '../census/frame.js';
import type { Observation } from '../record/types.js';
import type { DeepReading } from '../quality/deep-check.js';
import type { CaptureFinding } from '../quality/capture.js';

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
  /** Where the rendered views live. Copied into the site; never committed. */
  views?: string;
  now?: Date;
}

/**
 * The most recent view per host and device, from the record.
 *
 * The record is the authority on what was seen and when, exactly as it is for
 * every other figure — the images are build artifacts and may have come from a
 * cache that was evicted (constitution 2.1.0). A finding whose image is missing
 * is dropped rather than published as a broken picture.
 */
async function latestViews(readings: DeepReading[], viewsDir?: string): Promise<Map<string, CaptureFinding[]>> {
  const byHost = new Map<string, Map<string, CaptureFinding>>();
  for (const r of readings) {
    for (const view of r.views ?? []) {
      const forHost = byHost.get(r.host) ?? new Map<string, CaptureFinding>();
      const prev = forHost.get(view.profile);
      if (!prev || prev.captured_at < view.captured_at) forHost.set(view.profile, view);
      byHost.set(r.host, forHost);
    }
  }

  const result = new Map<string, CaptureFinding[]>();
  for (const [host, profiles] of byHost) {
    const present: CaptureFinding[] = [];
    for (const view of profiles.values()) {
      if (viewsDir) {
        const file = path.join(viewsDir, host, `${view.profile}.webp`);
        // A finding without its image would render as a broken picture, which
        // says nothing true about the site. Absence is shown as absence.
        if (!(await fs.stat(file).catch(() => null))) continue;
      }
      present.push(view);
    }
    if (present.length > 0) result.set(host, present.sort((a, b) => a.profile.localeCompare(b.profile)));
  }
  return result;
}

/** Copies the rendered views into the site, so they deploy with the pages that show them. */
async function copyViews(viewsDir: string, outDir: string, wanted: Map<string, CaptureFinding[]>): Promise<number> {
  let copied = 0;
  for (const [host, views] of wanted) {
    for (const view of views) {
      const from = path.join(viewsDir, host, `${view.profile}.webp`);
      const to = path.join(outDir, 'views', host, `${view.profile}.webp`);
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.copyFile(from, to);
      copied++;
    }
  }
  return copied;
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
  const quality = await readJsonl<DeepReading>(path.join(options.data, 'quality'));

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
    quality,
    ...(frame ? { frame } : {}),
  });

  // Only for hosts that will actually have a page. A view copied for a host with
  // no listing is a file nothing links to, and at census scale those accumulate
  // silently in a directory nobody reads.
  const listed = new Set(observations.map((o) => o.host));
  const views = new Map(
    [...(await latestViews(quality, options.views))].filter(([host]) => listed.has(host)),
  );
  if (options.views) await copyViews(options.views, options.out, views);

  return writePages({
    ...(views.size > 0 ? { views } : {}),
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
    else if (arg === '--views') {
      const value = argv[++i];
      if (value === undefined) throw new Error('--views requires a directory');
      options.views = value;
    }
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
    console.error('usage: build-site [--data <dir>] [--out <dir>] [--views <dir>] [--frame <path>] [--targets <path>] [--exclusions <path>]');
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
