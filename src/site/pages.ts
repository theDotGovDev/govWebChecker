import fs from 'node:fs/promises';
import path from 'node:path';
import type { Observation } from '../record/types.js';
import type { Frame } from '../census/frame.js';
import type { SiteModel } from './model.js';
import { renderSite, sharedCss } from './render.js';
import {
  listings,
  domainGroups,
  renderListing,
  renderDomainGroup,
  type Listing,
  type DomainGroup,
} from './listing.js';

export interface WritePagesInput {
  model: SiteModel;
  observations: Observation[];
  /** The census frame — which domains a listing may exist for. */
  frame?: Frame;
  outDir: string;
  generatedAt: string;
  /** Domains withdrawn from current views; their rows stay in the record (FR-248). */
  excluded?: string[];
}

export interface WrittenPages {
  listings: number;
  /** Frame domains awaiting their first reading — pages that say so and no more. */
  pending: number;
  domains: number;
  excluded: number;
}

/** The shell every listing and domain page shares — same tokens as the index. */
function shell(title: string, body: string, generatedAt: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — govWebChecker</title>
<style>${sharedCss()}
  .wrap { max-width: 46rem; }
  article h1 { overflow-wrap: anywhere; }
  .lead { font-size: 1.05rem; }
  .correction { color: var(--muted); font-size: .85rem; border-top: 1px dashed var(--line);
    margin-top: 1.5rem; padding-top: .75rem; }
  .back { display: inline-block; margin: 1.25rem 0 .5rem; }
</style>
</head>
<body>
<div class="wrap">
<p><a class="back" href="../index.html">← All measurements</a></p>
${body}
<footer><p class="spread">Generated ${generatedAt}. Every reading here is in the
published record, and the record is the authority — not this page.</p></footer>
</div>
</body>
</html>
`;
}

/**
 * Writes the whole site: index, one listing per site, one page per registered
 * domain.
 *
 * Streams by host (research R2): one pass groups rows, and each listing renders
 * from its own group — never an index of all 16,535 histories held to render one
 * page. At today's scale this is comfort; at a year's scale it is the difference
 * between a build and an outage.
 */
export async function writePages(input: WritePagesInput): Promise<WrittenPages> {
  const { model, observations, outDir, generatedAt } = input;
  const excluded = new Set(input.excluded ?? []);

  await fs.mkdir(path.join(outDir, 'sites'), { recursive: true });
  await fs.mkdir(path.join(outDir, 'domains'), { recursive: true });

  await fs.writeFile(path.join(outDir, 'index.html'), renderSite(model, generatedAt), 'utf8');
  await fs.writeFile(path.join(outDir, '.nojekyll'), '', 'utf8');

  const all = listings(observations);
  // Withdrawal is from current views, never from the record (FR-248, FR-241).
  const current = all.filter((l) => !excluded.has(l.domain) && !excluded.has(l.host));

  let written = 0;
  for (const l of current) {
    await fs.writeFile(
      path.join(outDir, 'sites', `${l.host}.html`),
      shell(l.host, renderListing(l), generatedAt),
      'utf8',
    );
    written += 1;
  }

  // D2: a frame domain the census has not reached yet is still reachable. Its
  // page asserts nothing the record does not contain (FR-249) — it says only
  // that the rolling cycle has not arrived, because a missing page would itself
  // read as a statement about the jurisdiction.
  const known = new Set(current.map((l) => l.host));
  let pending = 0;
  for (const entry of input.frame?.domains ?? []) {
    if (known.has(entry.domain) || excluded.has(entry.domain)) continue;
    await fs.writeFile(
      path.join(outDir, 'sites', `${entry.domain}.html`),
      shell(
        entry.domain,
        `<article class="listing" data-host="${entry.domain}">
<h1>${entry.domain}</h1>
<p class="lead">This domain has not yet been checked.</p>
<p>The census covers one seventh of all registered .gov domains each day, so a
domain waits at most a week for its first reading. Nothing here is a statement
about ${entry.domain} — there are no readings to state.</p>`,
        generatedAt,
      ),
      'utf8',
    );
    pending += 1;
    written += 1;
  }

  const groups = domainGroups(current);
  for (const g of groups) {
    await fs.writeFile(
      path.join(outDir, 'domains', `${g.domain}.html`),
      shell(g.domain, renderDomainGroup(g), generatedAt),
      'utf8',
    );
  }

  return {
    listings: written,
    pending,
    domains: groups.length,
    excluded: all.length - current.length,
  };
}

export type { Listing, DomainGroup };
