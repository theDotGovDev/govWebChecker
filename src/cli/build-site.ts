import fs from 'node:fs/promises';
import path from 'node:path';
import { parseTargets } from '../targets/load.js';
import { buildSiteModel, type RunRow } from '../site/model.js';
import { renderSite } from '../site/render.js';
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

export interface BuildSummary {
  targets: number;
  withData: number;
  withoutData: number;
  observations: number;
  discardedRuns: number;
}

/**
 * Reads the record, builds the model, writes the site. The CLI below is a shell
 * over this so the whole build is exercisable from a test without spawning a
 * process — the seam the 002 page work grows through.
 */
export async function buildSite(
  targetsPath: string,
  dataDir: string,
  outDir: string,
  now: Date = new Date(),
): Promise<BuildSummary> {
  const model = buildSiteModel({
    targets: parseTargets(await fs.readFile(targetsPath, 'utf8')),
    observations: await readJsonl<Observation>(path.join(dataDir, 'availability')),
    runs: await readJsonl<RunRow>(path.join(dataDir, 'runs')),
  });

  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(
    path.join(outDir, 'index.html'),
    renderSite(model, now.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'),
    'utf8',
  );
  // .nojekyll so Pages serves the directory as-is.
  await fs.writeFile(path.join(outDir, '.nojekyll'), '', 'utf8');

  return {
    targets: model.summary.targets,
    withData: model.summary.withData,
    withoutData: model.summary.withoutData,
    observations: model.summary.observations,
    discardedRuns: model.discardedRuns,
  };
}

/** build-site <targets.json> <data-dir> <out-dir> */
async function main(): Promise<number> {
  const [targetsPath, dataDir, outDir] = process.argv.slice(2);
  if (!targetsPath || !dataDir || !outDir) {
    console.error('usage: build-site <targets.json> <data-dir> <out-dir>');
    return 1;
  }

  const summary = await buildSite(targetsPath, dataDir, outDir);
  console.log(`site written to ${outDir}`);
  console.log(`  sites:        ${summary.targets}`);
  console.log(`  with data:    ${summary.withData}`);
  console.log(`  without data: ${summary.withoutData}`);
  console.log(`  observations: ${summary.observations}`);
  console.log(`  runs discarded (nothing succeeded): ${summary.discardedRuns}`);
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
