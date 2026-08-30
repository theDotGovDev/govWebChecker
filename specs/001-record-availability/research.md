# Phase 0 Research: User Story 1 — uptime and speed

**Scope**: decisions needed to build US1 only. Where a choice would constrain
US2–US4, that is noted; where it would not, it is left open.

## R1 — Runtime and language

**Decision**: Node.js with TypeScript, compiled by `tsc`. No runtime dependencies
for US1.

**Rationale**: US1 is achievable with the standard library in any candidate, so it
does not decide this on its own — the tie is broken by what comes next. The
expensive future component is the browser audit (US3), and the standard tool for
it is Node-native. Choosing Python for the checker means either running a second
runtime for the audit tier or shelling out to Node anyway; one runtime is worth
more than any per-language ergonomics gap in an HTTP client.

Node's `node:https` gives socket-level events, which is what makes FR-013's
outcome discrimination possible: DNS, TCP, TLS, and HTTP failures are separable by
watching the request lifecycle rather than inferring from a wrapped error. The
higher-level `fetch` collapses these, so it is not used.

TypeScript earns its build step on the observation record, which is a persisted
contract that outlives every other decision here; a typo in a field name is
otherwise found by a reader in 2029.

**Dependencies**: zero runtime. Two dev-only: `typescript`, `@types/node`. Tests
use the built-in `node:test` runner rather than a framework, per the project
default against dependencies for what a few lines already do.

**Alternatives considered**:

- *Python*: cleanest stdlib for US1 and US2 — `ssl` makes certificate inspection
  pleasant. Rejected on the two-runtime cost once US3 arrives.
- *Go*: best single-binary story and excellent HTTP control. Rejected for the
  same reason, plus the audit tier would be entirely foreign.
- *Plain JavaScript, no build step*: genuinely tempting under "smallest change".
  Rejected because the stored record is a long-lived contract and this is exactly
  where type checking pays.

**Open**: this is the one decision in this plan that should be confirmed before
code is written. Everything else follows from it cheaply.

## R2 — Storage format

**Decision**: newline-delimited JSON, one file per dimension per month, committed
to this repository. Example: `data/availability/2026-07.jsonl`.

**Rationale**: FR-021 requires the record be readable without running our code —
JSONL is readable by `jq`, by a spreadsheet after trivial conversion, and by any
language's stdlib. Append-only writes produce clean git diffs, so history is
inspectable per commit, which is a free audit trail for FR-017's immutability.
Monthly partitioning bounds any single file and makes retention a matter of
whether a file is kept.

Volume is not a concern at this scale: roughly 200 targets sampled daily at a few
hundred bytes per record is on the order of 20 MB per year. A decade of history
stays smaller than most node_modules.

Nesting matters later — US3's findings are arrays — so a flat format would have to
be abandoned mid-project. JSONL handles both.

**Alternatives considered**:

- *CSV*: more universal still, and adequate for US1's flat records. Rejected
  because US3 would force a format change, and changing storage format
  mid-history is worse than a slightly less convenient format now.
- *SQLite committed to the repo*: real query language, single file. Rejected
  because a binary blob in git defeats diffability and bloats history on every
  write.
- *An external database*: rejected on FR-007 and the free-tier constraint
  (SC-008); it also puts the record somewhere it can disappear.

## R3 — Distinguishing failure kinds

**Decision**: classify from the request lifecycle, not from error message text.

| Outcome | Signal |
| --- | --- |
| DNS failure | Resolution error before a socket exists |
| Connection failure | Socket error before TLS negotiation |
| TLS failure | Error during negotiation, or certificate rejection |
| Timeout | Our own timer fires; record the time waited |
| HTTP error | A response arrived with a non-success status |
| Blocked | A response arrived that indicates automated traffic was refused |
| Success | A response arrived with a success status |

**Rationale**: FR-013 requires these be distinct, and SC-006 requires testing them
without external network access — both are satisfiable by attaching to socket
events against local servers scripted to fail in each way. Matching on error
strings is brittle across Node versions and untestable in any durable way.

**Note for US2**: certificate detail is deliberately not collected here even
though TLS negotiation exposes it. US1 records only that TLS succeeded or failed.

## R4 — Rate limiting

**Decision**: two independent limiters — per hostname and per registrable domain —
both inside the checker, with the domain limiter derived by taking the last two
labels.

**Rationale**: FR-003 and FR-003a. The two-label rule is correct for every `.gov`
domain, which is this release's entire scope, and it avoids a Public Suffix List
dependency for a problem the scope does not yet have.

**This will break when scope widens.** State and local government use suffixes
like `state.tx.us`, where two labels is wrong. The rule is therefore isolated
behind a single function with the assumption documented at the call site, so the
day it needs the Public Suffix List, one function changes. Recorded here so the
decision is not mistaken later for an oversight.

**Alternatives considered**: adopting the Public Suffix List now. Rejected as a
dependency for a case that cannot arise in the current target scope, per the
project default; it becomes correct the moment non-federal targets are added.

## R5 — Sampling for the median

**Decision**: several sequential samples per target per run, spaced by the
per-host minimum interval, storing the count, the median, the minimum, and the
maximum.

**Rationale**: FR-011a and FR-011b. Sequential spacing is what keeps FR-011b
honest — the samples are for statistical confidence, and taking them back-to-back
would be a burst wearing a statistician's hat.

Median rather than mean: latency distributions are right-skewed, and one slow
sample from a noisy shared runner would drag a mean while leaving a median
intact. Storing min and max alongside preserves the spread that SC-009 needs to
distinguish a real regression from runner noise.

## R6 — Scheduling and writing back

**Decision**: a scheduled GitHub Actions workflow that runs the checker and
commits the appended records back to the repository, guarded by a concurrency
group.

**Rationale**: matches the stated architecture, costs nothing for a public
repository, and puts the data where the site build will read it.

Three properties of the platform shape the design and are recorded so they are
not rediscovered as bugs:

- **Scheduled runs are best-effort and can be delayed under load.** FR-011
  already requires recording when a check actually ran; this is why.
- **Scheduled workflows are disabled automatically after a long period of
  repository inactivity.** A repository whose only activity is its own automated
  commits may be affected; to be verified during implementation, since silent
  cessation is the failure mode that would go unnoticed longest.

  **Verified 2026-08-29 (T050), as far as it can be.** GitHub documents the rule
  — "In a public repository, scheduled workflows are automatically disabled when
  no repository activity has occurred in 60 days" — and defines *nothing* about
  what activity means. That is the whole of the official record; the docs say
  neither what counts nor whether a bot's commits do.

  What is established from practice: a **commit** resets the timer, and a
  workflow *run* on its own does not. This repository commits to `data/`
  several times a day, authored by `govwebchecker[bot]` and pushed with
  `GITHUB_TOKEN`, so on that reading it is not exposed at all — and the
  keepalive actions that exist for this problem target the case this repository
  is not in, a schedule that runs but writes nothing back.

  What remains genuinely unknown is whether a push made with `GITHUB_TOKEN`
  counts. GitHub suppresses such pushes from triggering further workflow runs,
  and nothing states whether the same suppression reaches the activity clock.
  No amount of reading settles it; only a repository that goes 60 days with bot
  commits and no human ones would, and that is not an experiment this project
  can run on itself without risking the thing it is testing.

  **Not mitigated, deliberately.** The failure needs both halves — bot commits
  not counting *and* sixty days without a human — and the fixes are worse than
  the exposure: a keepalive commit uses the same `GITHUB_TOKEN` and so fails in
  exactly the case that would need it, and authoring commits with a PAT buys
  certainty for a stored credential and a rotation burden. What the project has
  instead is detection: every figure publishes the longest gap between readings
  (FR-009), so a cessation shows up on the site as a growing gap rather than as
  a page that quietly stops changing. Revisit if the repository is ever
  genuinely dormant for a month.
- **Two runs committing concurrently will conflict.** A concurrency group makes
  runs queue rather than race.

**Alternatives considered**: writing to an artifact or a release asset instead of
the repository. Rejected — it separates the data from its history and makes the
record harder to read, which FR-021 is about.

## R7 — Testing approach

**Decision**: `node:test` with local HTTP servers as fixtures. No network access
in any test.

**Rationale**: SC-006 makes this a requirement rather than a preference, and the
constitution requires the politeness limits to have tests that fail when a limit
is loosened. Those tests assert on recorded request timestamps, which is the same
evidence SC-002 and SC-012 say an outside reader should be able to check — so the
test and the published guarantee are checking the same thing.

Fixtures needed: a fast server, a slow server, one that refuses connections, one
with a bad certificate, one returning error statuses, and one refusing automated
traffic.
