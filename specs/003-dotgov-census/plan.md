# Implementation Plan: a census of US `.gov` domains, checked in two tiers

**Branch**: `claude/govwebchecker-shared-hosting-limits-ukxevy` | **Date**: 2026-08-22 |
**Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/003-dotgov-census/spec.md`

**Scope**: the census. FR-140 to FR-142 — the shared-hosting backend limit that
FR-133 blocked the first sweep on — are **already built and merged**, so this plan
treats them as existing machinery rather than work.

## Summary

Widen the frame from 58 traffic-selected federal hosts to all 16,535 registered
`.gov` domains, checked as a rolling one-seventh slice per day, while keeping the
hourly cadence for the hosts the public actually uses.

Three things make that more than a bigger loop, and they are where the work is:

1. **One registered `.gov` in nine publishes no web address at all.** Checked
   naively, the census would assert 1,807 broken government websites every cycle.
   Absence has to be modelled as absence, and the reading kept separable from the
   protocol facts so a better rule can be applied to history later.
2. **Coverage has to be provable from the record**, not asserted. That means the
   frame is committed and each observation says which cycle and slice produced it.
3. **A census supplies a domain, not a URL.** The rule that derives one is stated,
   versioned, and recorded, because 348 domains answer only at `www` and 567 only
   at the apex — and the split is wildly uneven by jurisdiction type.

## Technical Context

**Language/Version**: TypeScript on Node.js 22, compiled with `tsc` — unchanged

**Primary Dependencies**: none at runtime. Dev-only: `typescript`, `@types/node`.
This feature adds none

**Storage**: newline-delimited JSON committed to the repository, unchanged.
The census frame is a committed JSON file under `targets/`

**Testing**: `node:test`, with local HTTP servers and DNS stubs as fixtures.
No test resolves a real name or contacts a real site

**Target Platform**: GitHub Actions `ubuntu-latest`

**Project Type**: single project — a CLI tool plus scheduled workflows

**Performance Goals**: not a goal, with one hard ceiling: a slice must complete
inside the hosted runner's per-job limit (SC-105). The limits dominate wall-clock
and that is the design working

**Constraints**: hosts in flight stay at 6 (FR-132); no test touches the network;
no credentials; the record stays append-only and `verify`-checkable at census
scale (FR-137, FR-138)

**Scale/Scope**: 16,535 domains, ~2,364 per daily slice, of which ~2,045 publish a
web address and therefore receive a request. About 860,000 rows a year

See [research.md](./research.md) for how each was decided and what was rejected.

## Constitution Check

*GATE: passed for Phase 0. Re-checked after Phase 1 design — see below.*

| Principle | How this plan satisfies it | Where |
| --- | --- | --- |
| **I. Measurement, not load** (NON-NEGOTIABLE) | One reading per broad-tier check. Concurrency stays at 6. The backend limit that made this scale safe is already merged. Resolution costs targets nothing — queries go to resolvers. FR-130 stops the second URL form being requested when resolution already shows it has no address | R4, R8, `contracts/census-cli.md` |
| **II. Only the public surface** | A plain GET of a domain's public front page. No credentials exist. `robots.txt` is honored per target as now | `contracts/census-cli.md` |
| **III. Politeness is structural** | No new limit is introduced and none is weakened, with one deliberate exception argued in R8: redirect hops within one check charge the backend limit but not the name-keyed intervals, because a redirect is one visit continuing rather than a second reading | R8 |
| **IV. An observation is a fact** | `outcome` stays a protocol fact. Whether a website exists moves to a separate versioned field, recomputable over stored history without re-checking anything | R3, `data-model.md` |
| **V. A published number carries its method** | Every row carries `tier`, `cycle`, `slice` and `url_rule`, so a per-tier figure is computable without a target list that may since have changed. Absence is recorded as absence; a resolution failure that may be ours reads `undetermined`, never `no_website` | R3, `data-model.md` |

**Quality gates from the constitution**:

- Politeness limits keep tests that fail if a limit is loosened. R8 changes one
  limit's scope, so it gets a test asserting the new boundary precisely: hops
  charge the backend, and hops to a new host still charge everything.
- No test contacts a real government site, and none resolves a real name — DNS is
  injected, the same way `lookup` already is.
- `ARCHITECTURE.md`, `spec.md` and the site are updated in the same change as the
  code that affects them.

**One risk carried, not solved** (R5): the two tiers are separate processes with
separate limiters, so where they overlap on a host, domain or backend they do not
in fact share a budget. It is mitigated by scheduling them apart and bounded by
the concurrency cap, and `verify` makes any violation visible after the fact from
the record. Recorded here rather than claimed as solved, because a scheduling
convention is the kind of politeness-by-convention the constitution distrusts.

**No violations requiring justification. Complexity Tracking is therefore empty
and omitted.**

## Project Structure

### Documentation (this feature)

```text
specs/003-dotgov-census/
├── plan.md              # This file
├── research.md          # Phase 0 — decisions and what was rejected
├── data-model.md        # Phase 1 — the frame, the observation additions
├── quickstart.md        # Phase 1 — how to prove it works without touching a target
├── contracts/
│   └── census-cli.md    # Phase 1 — the command surface and its guarantees
├── checklists/
└── tasks.md             # Phase 2 — /speckit-tasks, not created here
```

### Source code

```text
src/
├── census/                  # new
│   ├── frame.ts             # build the frame from the registry, apply exclusions
│   ├── slice.ts             # deterministic slice assignment (R1)
│   ├── presence.ts          # the versioned absence-vs-failure reading (R3)
│   └── url.ts               # the canonical URL rule (R4)
├── checker/
│   ├── resolve.ts           # exists — gains the classification FR-120 needs
│   ├── check.ts             # exists — redirect hop limit scope (R8)
│   ├── run.ts               # exists — carries tier/cycle/slice through
│   └── ...
├── record/
│   ├── types.ts             # exists — additive fields only
│   └── validate.ts          # exists — validates them
├── cli/
│   ├── index.ts             # exists — gains `census` and `build-frame`
│   └── verify.ts            # exists — coverage check
└── targets/                 # exists — hot tier, unchanged

targets/
├── federal.json             # exists — the hot tier
├── dotgov-frame.json        # new — the census frame, generated
└── excluded.json            # new — removal requests, data with reasons

.github/workflows/
├── check.yml                # exists — becomes explicitly the hot tier
├── census.yml               # new — daily, one slice
└── refresh-frame.yml        # new — opens a PR when the registry drifts
```

**Structure Decision**: a new `src/census/` alongside the existing directories
rather than inside `checker/`. The census is *what to check and when*; the checker
is *how to check it*. Keeping that boundary means the census can change its frame,
its tiers and its cadence without touching the code that talks to a government
server — which is the code the constitution constrains most tightly.

## Constitution re-check, after Phase 1 design

The design surfaced two things worth recording rather than quietly absorbing.

**One gate tightened.** Designing the frame builder made a Principle V failure
mode concrete that the pre-design check had not: a truncated registry download
would produce a small frame, and a small frame produces a cycle that looks like a
coverage collapse across US government rather than a failed HTTP request on our
side. `build-frame` therefore refuses a frame that is empty or more than 20%
smaller than the one it replaces (`contracts/census-cli.md`). This is the same
class of error as the 403-blocked run that would have asserted federal agencies
refuse automated traffic, and it is caught the same way — by refusing to publish
rather than by hoping someone notices.

**One design constraint became a testable requirement.** FR-119 asks that the
presence reading be recomputable over stored observations. Writing
`data-model.md` made the sharper form of that obvious: `presence` must be a *pure
function of a stored `Observation` and nothing else*. Anything reaching outside
the row — a live lookup, a cache, the frame — would make history unrecomputable
the moment that outside thing changed. It is therefore implemented as such and
tested against rows the test wrote by hand rather than rows a check produced.

Principle I is unaffected by the design: no new traffic is introduced, resolution
goes to resolvers rather than targets, FR-130 removes a request rather than adding
one, and the single change to a limit's scope (R8) is argued in research and gets
a test that pins the new boundary in both directions.

**Still no violations requiring justification.**

## Designed-for extension

`002` (analysis and presentation) is unwritten and will read this record. Two
choices exist for its benefit and are worth naming so they are not later mistaken
for over-engineering:

- `presence` carries its rule version, so `002` can present a corrected reading
  over historical rows without a re-collection.
- `tier` is on every row, so `002` can refuse to mix populations — the
  near-certain misreading FR-139 and SC-107 exist to prevent.

## Phasing

The user stories are independently deliverable and land in priority order:

1. **US1 + US2 together** (both P1). The frame, slices, coverage, and the
   absence-vs-failure model. These ship together because a census that cannot tell
   absence from failure should not be published at all, so US1 without US2 is not
   a releasable increment.
2. **US3** (P2). The hot tier keeps its cadence; the record distinguishes tiers.
   Largely a matter of not breaking what exists.
3. **US4** (P2). Per-tier figures computable from the record alone.
