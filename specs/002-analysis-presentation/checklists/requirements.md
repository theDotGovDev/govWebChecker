# Specification Quality Checklist: analysis and presentation

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-22
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain — both open questions decided (D1, D2)
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

Both open questions are decided by the project owner and recorded as D1 and D2
with their reasoning: per-dimension standings with no composite, and a listing for
every domain in the frame.

US5 rose from P3 to P2 as a consequence of D2. Naming every jurisdiction whether
or not anyone came looking makes the route by which one sees and challenges what
is published the thing that makes the naming defensible.

FR-246 carries the cost of D2 and should be checked hardest in review: roughly one
listing in seven will have nothing to report but our own failure.

The census schedule is disabled, so the census views specified here will show one
cycle until collection resumes. That constrains demonstration, not design.

## Plan review (2026-08-24)

Plan, research, data model, contract and quickstart are written. Two things from
planning are worth carrying into review:

- **R7 was found in the live record, not anticipated by the spec.** Three hosts
  carry two `target_id`s each, so keying a listing on `target_id` would split
  `www.irs.gov` across two pages, each stating half its sample count. The listing
  is keyed on host. This is the kind of thing that would have been discovered
  after rendering 16,535 pages.

- **FR-243 cannot be enforced by a type.** "Do not present a single observation
  as a characterisation of an institution" is a judgement about wording, covered
  by a template and by review. The plan says so rather than implying the test
  suite covers it.
