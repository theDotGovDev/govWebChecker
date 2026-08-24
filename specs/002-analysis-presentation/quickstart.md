# Quickstart — analysis and presentation

**Feature**: `002-analysis-presentation` | **Date**: 2026-08-24

How to build the site and satisfy yourself the guarantees hold. Nothing here
sends a request to any government site; the build has no network path.

## Prerequisites

```bash
npm ci
npm run build          # tsc
```

The record must be present under `data/`. It is committed, so a fresh clone has
it — 10,748 observations across two tiers as of 2026-08-24.

## Build the site

```bash
node dist/src/cli/index.js build-site
```

Writes `docs/`: an index, a page per tier, a page per registered domain, and one
listing per site. Expect roughly 16,600 files.

**A failure here is the feature working.** If the build refuses, it is because a
figure could not state its method, a figure spanned two tiers, or a view merged
two presence states — see [contracts/site-build.md](./contracts/site-build.md).

## Check the guarantees

```bash
npm test -- tests/integration/site-guarantees.test.ts
```

Asserts over the rendered output rather than the model, so the verdict does not
depend on trusting the code that produced it:

- every numeric token traces to a `Figure`
- no category merges two of the three presence states
- no figure's observations span two tiers
- a census series has one mark per cycle and no path between them
- no individual is named

## Look at the cases that matter

The three worth opening by hand, because they are where this feature earns its
requirements:

```bash
# A host that refuses automated traffic. Must show no rate — not zero.
open docs/sites/www.ssa.gov.html

# A host robots.txt tells us not to check. Same: no rate, and a stated reason.
open docs/sites/secure.login.gov.html

# A census domain we could not reach. Must lead with what is unknown, and must
# not read as a finding about the jurisdiction. One listing in seven looks like
# this — 359 of slice 1's 2,310 domains.
grep -rl 'could not establish' docs/sites/ | head -1 | xargs open
```

## Check a figure against the record yourself

Any figure on the site should be reproducible from the published record. For a
tier's availability over a window:

```bash
node -e "
const fs=require('fs');
const rows=fs.readFileSync('data/availability/2026-08.jsonl','utf8')
  .trim().split('\n').map(JSON.parse)
  .filter(r => (r.tier ?? 'hot') === 'hot');
const answered = rows.filter(r => r.outcome === 'success').length;
console.log(answered, '/', rows.length, '=', (100*answered/rows.length).toFixed(1) + '%');
"
```

If that disagrees with the site, the site is wrong — the record is the product,
and the site is a reading of it.

## What you cannot do from here

Run a check. This feature reads; `check.yml` and `census.yml` collect, on
runners, on a schedule. Exercising the checker is `workflow_dispatch`, never a
local run against a real government site.
