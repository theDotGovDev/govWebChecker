---
description: "Task list for feature 003 — a census of US .gov domains, in two tiers"
---

# Tasks: a census of US `.gov` domains, checked in two tiers

**Input**: Design documents from `specs/003-dotgov-census/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md),
[research.md](./research.md), [data-model.md](./data-model.md),
[contracts/census-cli.md](./contracts/census-cli.md),
[quickstart.md](./quickstart.md)

**Tests**: Included and non-optional. The constitution makes test-first the
default and requires the politeness limits to have tests that fail if a limit is
removed or loosened. Every behavior below starts from a failing test.

**Already built — generate no tasks for these**: FR-140 to FR-142, the
shared-hosting backend limit. The limiter keys on host, registrable domain and
resolved backend address; `src/checker/resolve.ts` resolves and pins; redirect
hops and `robots.txt` pass through the limiter; the observation carries `address`;
`verify` proves per-address spacing. Merged as `8798dda`. Tasks below extend that
machinery, never re-create it.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story the task belongs to
- Every task names its file path

## Path Conventions

Single project. `src/` and `tests/` at repository root, per plan.md § Project
Structure.

---

## Phase 1: Setup

**Purpose**: Nothing structural. The project builds and ships; this feature adds
directories to it.

- [ ] T001 Create `src/census/` and `tests/fixtures/dns.ts`, the injected-resolver fixture every test below depends on — no test may resolve a real name (SC-110)

---

## Phase 2: Foundational (blocks every user story)

**Purpose**: The record and resolution changes that both P1 stories sit on. Until
these land, nothing can be recorded about a census domain.

- [ ] T002 Add `tier`, `cycle`, `slice`, `url_rule`, `resolution` and `presence` as optional fields on `Observation` in `src/record/types.ts`, per data-model.md
- [ ] T003 Write failing tests in `tests/unit/record-shape.test.ts` for the new fields: each optional, each rejected when malformed, and a row written before this feature still valid (FR-136, FR-142)
- [ ] T004 Extend `validateObservation` in `src/record/validate.ts` to satisfy T003 — including rejecting a `presence.state` or `resolution.status` outside its enumeration, since an unknown value there is a verdict nobody can interpret
- [ ] T005 Write failing tests in `tests/unit/resolve-classify.test.ts` for classifying a name into `address` / `mail_only` / `no_service` / `nxdomain` / `resolver_error`, using the injected resolver from T001
- [ ] T006 Extend `src/checker/resolve.ts` to satisfy T005, returning the classification and the raw resolver codes. Keep `ENODATA` and `ENOTFOUND` distinct — collapsing them is the mistake the DNS survey exists to avoid
- [ ] T007 Write a failing test in `tests/unit/resolve-classify.test.ts` asserting a resolver failure classifies as `resolver_error` and never as `no_service` (FR-121)

**Checkpoint**: the record can hold a census observation and DNS can be classified.

---

## Phase 3: User Story 1 + User Story 2 (P1) — the census, telling absence from failure

**Goal**: Every registered `.gov` domain appears in the record on a rolling weekly
cycle, coverage is provable from the record, and a domain with no website is never
reported as a broken one.

**Why together**: plan.md § Phasing. A census that cannot tell absence from
failure publishes 1,807 accusations per cycle, so US1 without US2 is not a
releasable increment.

**Independent test**: run one cycle against a fixture registry and confirm every
domain produced exactly one observation, that a reader can reconstruct coverage
from the stored record alone, and that each fixture in quickstart.md § 3 lands in
its stated `resolution` and `presence` pair.

### Slices and the frame

- [ ] T008 [P] [US1] Write failing tests in `tests/unit/slice.test.ts`: assignment is deterministic per domain, independent of registry membership, and partitions the frame into exactly seven disjoint sets whose union is the frame (FR-112, FR-113)
- [ ] T009 [US1] Implement `sliceOf(domain)` in `src/census/slice.ts` to satisfy T008 — a pure function of the name, so a domain's slice cannot move when the registry changes
- [ ] T010 [P] [US1] Write failing tests in `tests/unit/frame.test.ts` for building a frame from a fixture registry: one entry per domain, exclusions removed, `slice` matching recomputation
- [ ] T011 [US1] Write failing tests in `tests/unit/frame.test.ts` for the refusals in contracts/census-cli.md — empty registry, a frame more than 20% smaller than its predecessor, and stored `slice` values disagreeing with the hash. Each must exit non-zero and write nothing
- [ ] T012 [US1] Implement `buildFrame` in `src/census/frame.ts` to satisfy T010 and T011, including the exclusions file and the frame digest
- [ ] T013 [P] [US1] Create `targets/excluded.json` with an empty list and a comment naming its purpose, so a removal request has somewhere to go before the first one arrives

### The canonical URL rule

- [ ] T014 [P] [US1] Write failing tests in `tests/unit/canonical-url.test.ts` for the rule in research.md R4: `https`, apex preferred when both resolve, the resolving form used when only one does, and the rule version recorded
- [ ] T015 [US1] Write a failing test in `tests/integration/canonical-url.test.ts` asserting the **absence** of a request to the second form when resolution shows it has no address (FR-130) — a fixture that counts requests, since this requirement is about what we do not send
- [ ] T016 [US1] Implement `canonicalUrl` in `src/census/url.ts` to satisfy T014 and T015

### Absence versus failure

- [ ] T017 [P] [US2] Write failing tests in `tests/unit/presence.test.ts` covering every row of the quickstart.md § 3 table, including the two that carry the feature's risk: a 500 reads `website`, a resolver error reads `undetermined`
- [ ] T018 [US2] Write a failing test in `tests/unit/presence.test.ts` proving recomputability — `presence` computed from a hand-written stored `Observation` matches what a check recorded, so a later rule applies to history without re-checking anything (FR-119)
- [ ] T019 [US2] Implement `presenceOf(observation)` in `src/census/presence.ts` as a pure function of a stored row and nothing else, satisfying T017 and T018, tagged `presence/1`
- [ ] T020 [US2] Write a failing test in `tests/integration/census-run.test.ts` asserting no census observation carries a presence reading inside `outcome` — `outcome` values stay exactly `001`'s protocol set (FR-117)

### Running a slice

- [ ] T021 [US1] Write failing tests in `tests/integration/census-run.test.ts`: one slice produces one observation per domain in that slice, each carrying `tier`, `cycle`, `slice`, `url_rule`, `resolution` and `presence`
- [ ] T022 [US1] Implement the census run in `src/census/run.ts`, reusing `executeRun`'s limiter, worker and append machinery rather than duplicating it — the checker is how to check, the census is what to check
- [ ] T023 [US1] Add `frame_digest`, `frame_size`, `slice_size`, `tier`, `cycle` and `slice` to the run summary in `src/checker/run.ts` per data-model.md § Run summary
- [ ] T024 [US1] Write a failing test in `tests/integration/census-run.test.ts` asserting an empty slice exits non-zero rather than recording a successful sweep of nothing (FR-115, contracts/census-cli.md)

### The redirect scope decision (research.md R8)

- [ ] T025 [US1] Write failing tests in `tests/integration/redirect-limits.test.ts` pinning the new boundary in **both** directions: a redirect hop charges the backend limit, and a hop to a host not yet contacted in this check charges the name-keyed intervals too
- [ ] T026 [US1] Implement the scope change in `src/checker/check.ts` and `src/checker/sample.ts` to satisfy T025, without adding any option that lets a caller widen or narrow it

### Coverage, provable from the record

- [ ] T027 [US1] Write failing tests in `tests/integration/verify.test.ts` for the coverage check: a complete cycle passes, a cycle missing a slice reports which, and a cycle whose slices ran against different frame digests is reported as incomplete rather than complete
- [ ] T028 [US1] Implement the coverage check in `src/cli/verify.ts` to satisfy T027, reading the record and the committed frame and nothing else
- [ ] T029 [US1] Add `census` and `build-frame` to `src/cli/index.ts` per contracts/census-cli.md, with none of the options listed as deliberately absent

### Shipping it

- [ ] T030 [P] [US1] Create `.github/workflows/refresh-frame.yml` — weekly, rebuilds the frame, opens a **pull request** when it changed, matching `refresh-targets.yml`
- [ ] T031 [US1] Create `.github/workflows/census.yml` — daily, one slice, `verify` before commit, scheduled at an hour `check.yml` does not occupy (research.md R5)
- [ ] T032 [US1] Dispatch `refresh-frame.yml` on a runner to generate the first real `targets/dotgov-frame.json`, and confirm its size against the registry's 16,535

**Checkpoint**: the census runs, covers the frame weekly, and never calls an
absent website a broken one.

---

## Phase 4: User Story 3 (P2) — outage detection survives

**Goal**: The hot tier keeps its hourly cadence and its statistical purpose; a
reader can tell which tier produced any observation.

**Independent test**: confirm hot-tier rows keep appearing hourly while broad-tier
rows appear on the cycle cadence, and that tier is readable on every row.

- [ ] T033 [P] [US3] Write a failing test in `tests/integration/run.test.ts` asserting every hot-tier observation carries `tier: "hot"` (FR-108)
- [ ] T034 [US3] Set the tier on hot-tier runs in `src/checker/run.ts` to satisfy T033
- [ ] T035 [P] [US3] Write a failing test in `tests/integration/run.test.ts` asserting a domain present in both tiers produces observations under both cadences, separable by tier and not double-counted per domain (FR-110)
- [ ] T036 [US3] Update `.github/workflows/check.yml` to state its tier explicitly in its header comment and its run summary

---

## Phase 5: User Story 4 (P2) — figures are not misread across tiers

**Goal**: A per-tier figure is computable from the record without a target list,
and a figure that mixes tiers is detectable as such.

**Independent test**: compute a naive combined availability figure across both
tiers and confirm the record carries what is needed to detect that it mixes
populations.

- [ ] T037 [P] [US4] Write a failing test in `tests/unit/site-model.test.ts` asserting a per-tier figure is computable from rows alone, with no target list consulted (FR-139, SC-107)
- [ ] T038 [US4] Update `src/site/model.ts` to satisfy T037, keeping tiers as a dimension rather than aggregating across them
- [ ] T039 [US4] Update `src/site/render.ts` so any published figure states the population it covers rather than implying it (Principle V, SC-107)

---

## Phase 6: Polish and cross-cutting

- [ ] T040 Update `ARCHITECTURE.md` with `src/census/`, the frame, the two tiers and the coverage check — in this change, not as a later pass
- [ ] T041 Update `specs/003-dotgov-census/spec.md` where implementation revealed intended behavior differs, and `specs/001-record-availability/spec.md` if anything further contradicts it. FR-001a and FR-009 are already revised
- [ ] T042 Update the published site with what the census is and how to read a per-tier figure, per the project's site rule
- [ ] T043 [P] Verify by sabotage that the politeness tests still bite: remove each limit in turn, confirm tests fail, restore. The constitution's one thing that cannot regress unnoticed
- [ ] T044 Run `verify` against a real dispatched census slice and confirm every guarantee holds at census scale (FR-138, SC-104)

---

## Dependencies

```text
Setup (T001)
    └─> Foundational (T002–T007)          ← blocks everything
            ├─> US1 + US2 (T008–T032)     ← the MVP; ships together
            │       ├─> US3 (T033–T036)
            │       └─> US4 (T037–T039)
            └─> Polish (T040–T044)
```

US3 and US4 are independent of each other and can proceed in either order once
US1+US2 land. Neither is required for the census to be publishable; both are
required before a figure drawn from it is.

## Parallel opportunities

Within Foundational: T003 and T005 are different files and can be written
together. Within US1+US2: T008, T010, T014 and T017 are four independent failing
test suites — slices, frame, URL rule, presence — and are the natural place to
parallelise. T013 and T030 touch nothing else.

## Implementation strategy

**MVP is Phase 3**, and it is deliberately larger than one story. The census
without the absence model is not a smaller release; it is a release that publishes
1,807 false claims about named jurisdictions every cycle. Ship them together or
not at all.

**Order within Phase 3**: slices and frame first, because nothing can be checked
until there is something to check; then the URL rule and presence, which are pure
functions and testable without any network; then the run that composes them. T025
and T026 can land any time after Foundational — they are a scope change to
existing machinery, not new behaviour.

**The first real sweep** (T032, T044) is the point of highest risk. A frame that
built wrong publishes as a finding about US government rather than as our bug,
which is why T011 exists and why `build-frame` refuses rather than warns.
