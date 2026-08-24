---
description: "Task list for feature 002 — analysis and presentation"
---

# Tasks: analysis and presentation

**Input**: Design documents from `specs/002-analysis-presentation/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md),
[research.md](./research.md), [data-model.md](./data-model.md),
[contracts/site-build.md](./contracts/site-build.md),
[quickstart.md](./quickstart.md)

**Tests**: Included and non-optional. The constitution makes test-first the
default, and this feature's central claim — a figure cannot be published without
its method — is exactly the kind of stated constraint this project has twice
found unenforced. Every guarantee lands as a failing test first, and the ones
that guard against silent regression get sabotage-verified.

**The record is the only input.** Tasks that validate against real data read the
committed record under `data/`. No task sends traffic to any target; the build
has no network path, and the tests run against fixtures or the committed record.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story the task belongs to
- Every task names its file path

---

## Phase 1: Setup

**Purpose**: nothing structural — the project builds and ships. One seam is
needed before the stories.

- [ ] T101 Extract the current `build-site` entry (`src/cli/build-site.ts`) into
  a thin shell over `src/site/pages.ts` so page-writing logic is testable without
  the CLI; behavior unchanged, existing site-render tests still pass

---

## Phase 2: Foundational — the Figure choke point

**Purpose**: the type every story renders through. Blocking: US1–US5 all publish
quantities, and the plan's core decision is that a quantity is representable only
as a `Figure`.

- [ ] T102 Failing test in `tests/unit/figure.test.ts`: `figure()` refuses
  construction with any of tier, population, window, samples or vantage missing;
  refuses a window whose `from` exceeds `to`; refuses `samples: 0` with a value
  (a measured nothing is absence, not a figure)
- [ ] T103 Implement `Figure` and its constructor in `src/site/figure.ts`; test
  from T102 passes
- [ ] T104 Failing test in `tests/unit/figure.test.ts`: `formatFigure()` renders
  the value with its method adjacent — tier, population, window, samples, vantage
  all present in the emitted string — and renders `undefined` as an explicit
  absence marker, never `0`, never blank
- [ ] T105 Implement `formatFigure()` in `src/site/figure.ts`; extend
  `src/site/render.ts` signatures so quantity-rendering helpers accept `Figure`,
  never `number` (compile-time: no public render function takes a bare number)

**Checkpoint**: the only way to put a quantity on a page carries its method.

---

## Phase 3: US1 — a figure carries its method (P1) 🎯 MVP

**Goal**: every figure on the site states what it counts, when, from where, on
how many readings — and a figure that cannot is a build failure, not a footnote.

**Independent test**: build the site from the committed record; follow every
rendered figure to its stated method; delete a method field in a fixture and
watch the build fail.

- [ ] T106 [P] [US1] Failing test in `tests/unit/site-model.test.ts`: every
  quantity in `SiteModel` is a `Figure`; a model built from fixture rows carries
  vantage taken from the rows' `method.vantage`, never from configuration
- [ ] T107 [P] [US1] Failing test in `tests/integration/site-guarantees.test.ts`
  (new file): render the site from fixture rows, extract every numeric token from
  the HTML, and assert each one is accounted for by a `Figure` the model emitted —
  the output-level check from research R1
- [ ] T108 [US1] Extend `src/site/model.ts` so every emitted quantity is a
  `Figure` (T106 passes); wire `src/site/render.ts` through `formatFigure`
  (T107 passes)
- [ ] T109 [US1] Failing test in `tests/integration/site-guarantees.test.ts`: a
  fixture row whose `method.vantage` is `local` causes the build to refuse
  (FR-253), and a period with no rows renders as absence, not zero (FR-204)
- [ ] T110 [US1] Implement both refusals in `src/site/model.ts`; tests pass
- [ ] T111 [US1] Failing test in `tests/integration/site-guarantees.test.ts`: the
  built site links the record and the verification tool (FR-206); implement in
  `src/site/render.ts`

**Checkpoint**: US1 shippable. A site of one honest page would already be worth
deploying.

---

## Phase 4: US2 — absence, uncertainty and failure never merge (P1)

**Goal**: `no_website`, `undetermined` and request failure are three states in
every view, with denominators stated.

**Independent test**: assert over rendered output that no category combines two
of the three states, and that each aggregate's denominator is recoverable.

- [ ] T112 [P] [US2] Failing test in `tests/unit/site-model.test.ts`: the census
  view exposes the three presence counts separately, each as a `Figure` sharing
  one stated denominator; no field in any view type combines two states (assert
  by name over the emitted object graph, the way the no-combined-availability
  test already does)
- [ ] T113 [US2] Failing test in `tests/integration/site-guarantees.test.ts`:
  rendered output never places a `no_website` or `undetermined` site under any
  heading containing failure vocabulary; a 500 renders as a website that is
  broken, distinct from both (FR-213, FR-214)
- [ ] T114 [US2] Extend `src/site/model.ts` and `src/site/render.ts` to pass
  T112–T113; run the census section against the committed record and confirm the
  three counts match `data/runs/` summaries (readable check, no traffic)

**Checkpoint**: US1+US2 together are the honest-aggregates site.

---

## Phase 5: US3 — tiers never blend (P2)

**Goal**: no figure spans both tiers; each names its population and cadence.

**Independent test**: type-level — no model function accepts observations of
more than one tier; output-level — every figure's stated population is one
tier's.

- [ ] T115 [P] [US3] Failing test in `tests/unit/site-model.test.ts`: model
  functions partition by tier before computing anything; feeding mixed-tier rows
  to a tier view throws rather than silently filtering (silent filtering is how a
  blended figure sneaks back as a "convenience")
- [ ] T116 [US3] Failing test in `tests/integration/site-guarantees.test.ts`: the
  rendered tier sections each state population and cadence adjacent to every
  figure; a domain present in both tiers renders two separable histories (FR-222)
- [ ] T117 [US3] Implement in `src/site/model.ts` / `src/site/render.ts`; both
  tests pass. Include the FR-223 statement of what each tier cannot answer

---

## Phase 6: US4 — change over time, at two cadences (P2)

**Goal**: hourly draws as a series; weekly draws as discrete marks with nothing
between them; incomplete cycles are visibly incomplete.

**Independent test**: render a census series from fixtures; assert no path
element spans two cycle marks; assert a 3-of-7-slice cycle is marked in progress
and its figure not presented as movement.

- [ ] T118 [P] [US4] Failing tests in `tests/unit/series.test.ts` (new file): the
  discrete series type carries per-mark `complete`, `slicesRan`, `slicesInFrame`;
  building it from fixture cycles computes completeness from run summaries'
  frame digest and slice counts, not from row counts
- [ ] T119 [US4] Implement `src/site/series.ts`; T118 passes
- [ ] T120 [US4] Failing test in `tests/integration/site-guarantees.test.ts`: the
  rendered census series contains one mark per cycle and no connecting path; an
  in-progress cycle renders its in-progress marker; a collection gap renders as a
  gap (FR-230–FR-233, including the frame-change disclosure of FR-232)
- [ ] T121 [US4] Render the series in `src/site/render.ts`; T120 passes; check by
  eye against the committed record's two real cycles (both in progress — the
  common case ships first)

---

## Phase 7: US5 — a listing for every site (P2)

**Goal**: D2/D3 delivered — one listing per site, keyed on host, undetermined
listings leading with what is unknown, correction route one step away.

**Independent test**: build from the committed record; count listings against
frame + targets; open `www.ssa.gov` (no rate, not zero), `secure.login.gov`
(robots, stated), and any undetermined census domain (leads with the unknown).

- [ ] T122 [P] [US5] Failing tests in `tests/unit/standings.test.ts` (new file):
  a `Standing` is figure XOR no-rate-reason; a host answering only 403 yields
  `refused`, a robots-skipped host yields `not_checked`; no ordering includes a
  no-rate host; no composite field exists (D1, FR-260–FR-262)
- [ ] T123 [US5] Implement `src/site/standings.ts`; T122 passes; validate against
  the committed record that exactly the four known hosts carry no rate
- [ ] T124 [P] [US5] Failing tests in `tests/unit/listing.test.ts` (new file):
  listings are keyed on host with `target_id`s joined as provenance — fixture
  reproducing the real `www.irs.gov` split asserts ONE listing whose sample count
  sums both ids (research R7); an undetermined listing's template leads with the
  unknown, states when and what was tried, and never places the jurisdiction
  name beside a failure state (FR-246); a mail-only domain's listing says no
  website, never broken (FR-213)
- [ ] T125 [US5] Implement `src/site/listing.ts`; T124 passes
- [ ] T126 [US5] Failing test in `tests/unit/listing.test.ts`: the domain group
  page states which of its sites were checked and does not imply the rest
  (FR-245b); no listing or group emits any individual's name or the registry's
  security-contact email (FR-244, SC-208)
- [ ] T127 [US5] Implement `DomainGroup` in `src/site/listing.ts`; T126 passes
- [ ] T128 [US5] Failing test in `tests/integration/site-guarantees.test.ts`:
  built from a fixture frame, every site has a listing file, every listing
  carries last-checked, cadence and the correction route, and an excluded
  domain's listing is absent while its rows remain in the record (FR-245,
  FR-247, FR-248)
- [ ] T129 [US5] Implement `src/site/pages.ts` — streaming one pass grouped by
  host (research R2), writing index, tier pages, domain groups and listings;
  T128 passes
- [ ] T130 [US5] Extend `src/cli/build-site.ts` to the contract — `--data`,
  `--out`, `--frame`, `--targets`, refusal exit codes — and update
  `.github/workflows/pages.yml` inputs; build the full site from the committed
  record and record the wall time and file count in the PR (the ~16,600-page
  feasibility claim gets a measured number)

---

## Phase 8: Polish

- [ ] T131 [P] Sabotage pass: bypass `formatFigure` with a raw number in a
  template literal → T107 must fail; merge two presence counts → T112 must fail;
  add a path between census marks → T120 must fail; key listings on `target_id`
  → T124 must fail. Restore each. Any sabotage that survives becomes a new test
  before this task closes
- [ ] T132 [P] Update `ARCHITECTURE.md`: `src/site`'s new shape (figure,
  standings, series, listing, pages), the Figure choke point, and the build's
  place in the data flow — same change, not a later pass
- [ ] T133 Update `specs/002-analysis-presentation/spec.md` where implementation
  revealed intended behavior differs; keep FR numbering stable
- [ ] T134 Run the quickstart end to end on the committed record: build, open the
  three named cases (`www.ssa.gov`, `secure.login.gov`, one undetermined
  listing), reproduce one figure by hand from the record per the quickstart's
  recipe, and confirm `pages.yml` deploys the built site green

---

## Dependencies

```text
Setup (T101)
  └─> Foundational (T102–T105)  ← blocks all stories
        ├─> US1 (T106–T111)  ← MVP
        │     └─> US2 (T112–T114)   [extends the same views]
        │           └─> US3 (T115–T117)
        │                 └─> US4 (T118–T121)
        ├─> US5 standings/listing types (T122–T127)  [parallel with US2–US4]
        │     └─> US5 pages (T128–T130)  [needs US1–US4 views to render]
        └─> Polish (T131–T134)  [after all stories]
```

US5's model work (T122–T127) touches only new files and can proceed in parallel
with US2–US4; its page-writing tail (T128–T130) renders the other stories' views
and lands last.

## Implementation strategy

**MVP is US1**: a site whose every figure carries its method, built from the
live record. Deployable on its own — it replaces the current site with an honest
one before any new page kind exists.

Then US2 (the census aggregates), US3–US4 (tier separation and time), and US5
(the 16,600 listings) as independently shippable increments. T131's sabotage
pass is the same discipline that caught the R8a seed hole and the unasserted
concurrency bound: every guarantee here was chosen because a stated-but-untested
version of it has already failed once in this project.
