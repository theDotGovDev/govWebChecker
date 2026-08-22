# Specification Quality Checklist: A census of US `.gov` domains, checked in two tiers

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-21
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Validation notes

Three issues were found on the first pass and fixed before this checklist was
marked complete:

1. **Implementation detail in success criteria.** SC-105 originally named a
   six-hour job cap and a worker count. Both are properties of the current
   hosting choice, not of the feature. Reworded to "the hosted runner's per-job
   limit" and "the order of a dozen", with the concrete figures left in the
   *Known gap* rationale where they are evidence rather than requirement.

2. **Unfalsifiable coverage requirement.** FR-114 originally said coverage "MUST
   be verifiable". Verifiable by whom, against what, was unstated, so it could
   not fail a test. Rewritten to name the reader, the input (the stored record
   alone), and the two outputs (whether the frame was covered, and which domains
   were missed), which SC-102 then measures.

3. **Record volume stated as a bare number.** An earlier draft carried a
   megabytes-per-year budget. That figure depends on packing behaviour this spec
   should not assume, so SC-106 now constrains growth relative to the current
   record and to whether an ordinary clone stays usable — both checkable without
   predicting a compression ratio.

## Second pass — after the DNS survey (2026-08-22)

The absence/failure design (FR-116 to FR-125) and the canonical-URL rule
(FR-126 to FR-130) were rewritten once the survey supplied real proportions,
rather than left as open problems. Three checklist items changed status:

1. **"Requirements are testable"** — FR-116 previously required distinguishing
   absence from failure without saying how a test would know the distinction had
   been drawn. It now names the fields and SC-103 measures it against the
   survey's 1,807-domain baseline, so a regression is countable.

2. **"Success criteria are measurable"** — SC-103 was a yes/no property. It now
   carries the measured baseline, and SC-103a and SC-103b were added for the
   `www` rule and for recomputability.

3. **"Scope is clearly bounded"** — parked-page detection was implied as
   in-scope by an earlier acceptance scenario. It cannot be done without
   retaining page bodies, which the project forbids, so FR-124 declines it
   explicitly instead of leaving a requirement nobody can satisfy.

One prose claim was **corrected against the data**: User Story 2 asserted the
risk fell on "thousands of small county, city and tribal governments". The
survey shows cities have the lowest no-web-address rate of any large category
(9.6%, below Federal Executive at 10.1%). The magnitude of the risk stands —
1,807 false claims per cycle — but its distribution was wrong, and the story now
says volume rather than bias is the danger.

## Deliberate deviations, called out for review

- **Numbered `003`, not `002`.** Sequential numbering would assign `002`, but
  `001`'s scope boundary and `AGENTS.md` both reserve `002` for analysis and
  presentation. Taking the number would falsify existing cross-references, so the
  number is skipped and the reason recorded at the top of `spec.md`.

- **A known gap is carried rather than closed.** The shared-hosting rate-limit
  gap touches Principle I, which is NON-NEGOTIABLE. It is deferred by explicit
  decision of the project owner, and the spec carries it as a named section with
  a binding interim mitigation (FR-125) and a block on the change that would make
  it dangerous (FR-126) — rather than omitting it. A reviewer should confirm they
  are content with that trade.

- **`001` requires revision.** FR-001a and FR-009 are contradicted by this
  feature and are listed under *Requirements changed in `001`*. Per the project's
  own rule that specs must never silently disagree, `001` must be edited in the
  same change that implements this — not afterwards.

## Notes

- Items marked incomplete require spec updates before `/speckit-clarify` or `/speckit-plan`
