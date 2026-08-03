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

/** build-site <targets.json> <data-dir> <out-dir> */
async function main(): Promise<number> {
  const [targetsPath, dataDir, outDir] = process.argv.slice(2);
  if (!targetsPath || !dataDir || !outDir) {
    console.error('usage: build-site <targets.json> <data-dir> <out-dir>');
    return 1;
  }

  const model = buildSiteModel({
    targets: parseTargets(await fs.readFile(targetsPath, 'utf8')),
    observations: await readJsonl<Observation>(path.join(dataDir, 'availability')),
    runs: await readJsonl<RunRow>(path.join(dataDir, 'runs')),
  });

  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(
    path.join(outDir, 'index.html'),
    renderSite(model, new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC'),
    'utf8',
  );
  // .nojekyll so Pages serves the directory as-is.
  await fs.writeFile(path.join(outDir, '.nojekyll'), '', 'utf8');

  console.log(`site written to ${outDir}`);
  console.log(`  sites:        ${model.summary.targets}`);
  console.log(`  with data:    ${model.summary.withData}`);
  console.log(`  without data: ${model.summary.withoutData}`);
  console.log(`  observations: ${model.summary.observations}`);
  console.log(`  runs discarded (nothing succeeded): ${model.discardedRuns}`);
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(`cannot build site: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
