# Implementation Plan: User Story 1 — uptime and speed, sampled continuously

**Branch**: `claude/govwebchecker-agents-md-qn43ag` | **Date**: 2026-07-31 |
**Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-record-availability/spec.md`

**Scope**: User Story 1 only. Stories 2–4 (transport security, the standard
quality audit, technology fingerprinting) are out of scope for this plan and are
designed *around* rather than *for* — see [Designed-for extension](#designed-for-extension).

## Summary

Build the smallest thing that is genuinely the product: a scheduled job that
checks a curated list of federal `.gov` hosts, records whether each responded and
how quickly, and appends the result to a durable, human-readable record.

Everything else in the spec — certificates, audits, fingerprints, the public site
— is another dimension written into the same record by the same machinery. This
story is the one that proves the machinery.

## Technical Context

**Language/Version**: TypeScript on Node.js (current LTS), compiled with `tsc`

**Primary Dependencies**: none at runtime. Dev-only: `typescript`, `@types/node`

**Storage**: newline-delimited JSON committed to the repository, one file per
dimension per month (`data/availability/YYYY-MM.jsonl`)

**Testing**: `node:test` (built in), with local HTTP servers as fixtures

**Target Platform**: GitHub Actions `ubuntu-latest`; the CLI also runs locally

**Project Type**: single project — a CLI tool plus a scheduled workflow

**Performance Goals**: not a goal. The system is deliberately slow: rate limits
and inter-sample spacing dominate wall-clock time, and that is the design working
rather than a problem to solve

**Constraints**: no network access in tests (SC-006); total scheduled compute
within the free tier for a public repository (SC-008); no credentials of any kind
in this release

**Scale/Scope**: order of 200 federal hosts, sampled daily, a few samples per
check — roughly 20 MB of record per year

See [research.md](./research.md) for how each was decided and what was rejected.

## Constitution Check

*GATE: passed for Phase 0. Re-checked after Phase 1 design — see below.*

| Principle | How this plan satisfies it | Where |
| --- | --- | --- |
| **I. Measurement, not load** (NON-NEGOTIABLE) | Sequential samples spaced by the per-host interval; no concurrency against a host; a second limiter per registrable domain closes the shared-backend gap; failure lengthens the wait | R4, R5, `contracts/checker-cli.md` |
| **II. Only the public surface** | Plain GET of a public URL. No credentials exist in this release — nothing to misuse | Technical Context |
| **III. Politeness is structural** | Limits live in the checker and cannot be passed around; identifying User-Agent is not overridable | `contracts/checker-cli.md` |
| **IV. An observation is a fact** | Append-only JSONL; failures recorded as outcomes rather than raised as errors; git history makes mutation visible | R2, `data-model.md` |
| **V. A published number carries its method** | Every record carries its method inline — vantage, timeout, sample count, spread. No summary is stored without it | `data-model.md` |

**Quality gates from the constitution**:

- Politeness limits get tests that fail if a limit is loosened — planned as
  timestamp assertions, the same evidence an outside reader would use (R7).
- No test contacts a real government site — enforced by fixtures only (R7).
- `ARCHITECTURE.md` does not exist yet and is created in the first
  implementation change, per the repository's own instructions.

**No violations. Complexity Tracking is therefore empty and omitted.**

## Project Structure

### Documentation (this feature)

```text
specs/001-record-availability/
├── spec.md              # Feature specification
├── plan.md              # This file
├── research.md          # Phase 0 — decisions and rejected alternatives
├── data-model.md        # Phase 1 — the record's shape
├── quickstart.md        # Phase 1 — how to run and verify it
├── contracts/
│   ├── checker-cli.md   # The command surface
│   └── observation.md   # The stored record contract
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # NOT created by /speckit-plan
```

### Source Code (repository root)

```text
src/
├── targets/           # Loading and validating the target list
├── checker/           # One check: request, timing, outcome classification
├── politeness/        # Rate limiters, backoff, User-Agent — the enforceable part
├── record/            # Appending observations, partitioning by month
└── cli/               # Entry point

tests/
├── fixtures/          # Local servers: fast, slow, refusing, bad cert, blocking
├── unit/              # Outcome classification, median, domain derivation
└── integration/       # Whole check against fixtures, including limit assertions

data/
└── availability/      # YYYY-MM.jsonl — the record

targets/
└── federal.json       # The target list, as data

.github/workflows/
└── check.yml          # Scheduled run, commit-back, concurrency-guarded
```

**Structure Decision**: single project. `politeness/` is deliberately its own
module rather than a utility folded into `checker/` — the constitution requires
those limits to be enforceable and independently testable, and a module boundary
is what makes "a caller cannot forget them" true in code review rather than only
in prose.

## Designed-for extension

Out of scope, but the design must not foreclose them:

- **US2 (certificates)** — TLS negotiation already exposes certificate detail;
  US1 discards it. Adding US2 means recording what the handshake already saw.
- **US3 (audits)** — a different dimension writing to `data/audit/`, sharing the
  target list, politeness layer, and record writer. The tier separation in FR-008
  is why the workflow is per-dimension rather than one job checking everything.
- **US4 (fingerprints)** — response headers are available at the same moment;
  storing them is additive.
- **The public site** — reads `data/` directly. Nothing in this plan generates
  HTML, and the record format is chosen so the site build needs no intermediary.

The shared seam is the record writer plus the politeness layer. If a later
dimension needs to bypass either, that is a design smell to stop and reconsider.

## Phase 1 outputs

- [data-model.md](./data-model.md) — Target, Observation, Run, and how the
  property mapping stays out of the stored record
- [contracts/observation.md](./contracts/observation.md) — the stored record,
  field by field, with the compatibility rules that let US2–US4 extend it
- [contracts/checker-cli.md](./contracts/checker-cli.md) — the command surface,
  including which knobs deliberately do not exist
- [quickstart.md](./quickstart.md) — running it, and verifying the politeness
  guarantees from the record alone

## Post-design Constitution re-check

Re-evaluated after Phase 1. Still passing, with two things the design surfaced:

1. **The record carries its method on every row**, which is redundant across
   millions of rows but makes any extracted subset self-describing. Principle V is
   about a number never being separable from its method; deduplicating this into a
   side table would break exactly that. Accepted deliberately.
2. **The CLI has no flag to weaken a limit** — no `--concurrency`, no
   `--no-rate-limit`, not even for local runs. Principle III says a caller must
   not be able to forget the limits; an override flag is how that erodes. Tests
   construct the checker directly with a test configuration rather than going
   through the CLI, so the escape hatch exists where it cannot ship.

## Open decision before implementation

**R1, the runtime choice, should get a yes before code is written.** Everything
else in this plan follows from it cheaply, and it is the one decision that is
expensive to reverse after `tasks.md` is generated.
