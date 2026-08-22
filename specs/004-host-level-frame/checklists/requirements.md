# Specification Quality Checklist: a host-level frame

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-22
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [ ] No [NEEDS CLARIFICATION] markers remain — **Q1 is open**: whether this feature attempts local government subdomains
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

Every figure in *Measured evidence* comes from a dispatched workflow run and is
cited to it — `probe-data-sources` run 32598988975 for the source shape, census
run 32579108046 for throughput. Nothing is projected from assumption.

FR-410 is the requirement most worth checking in review, and the least obvious. It
came out of the numbers rather than the design: slicing by registered domain would
put `nasa.gov`'s 2,203 hosts in one slice, needing 184 minutes of per-domain
budget and exceeding the job cap on a single domain. Concurrency cannot help,
because the limit is per domain by design.

SC-404 deliberately requires a measured run rather than a projection. Two duration
projections have already been wrong on this project, both optimistic.

This feature is blocked in practice, not just on Q1: the census schedule is
disabled because a domain-level slice does not fit the cap with margin, and this
multiplies the frame twentyfold. R8a is the outstanding lever.
