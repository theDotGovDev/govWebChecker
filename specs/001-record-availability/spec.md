# Feature Specification: Record availability and response time for a list of government websites

**Feature Branch**: `001-record-availability`
(drafted on `claude/govwebchecker-agents-md-qn43ag`; the repo has no code yet, so
the Spec Kit branch convention starts when implementation does)

**Created**: 2026-07-31

**Status**: Draft — not approved, not planned. Contains open clarifications.

**Input**: User description: "Check popular gov websites for status and speed."
(the repository's one-line README, which is the whole brief so far)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - One run produces a record for every target (Priority: P1)

Someone runs the checker once against the configured list of government websites.
For each target it reports whether the site responded, what it responded with,
and how long it took — and that result is written down somewhere durable rather
than only printed.

**Why this priority**: It is the whole product in miniature. Without it there is
nothing to schedule, nothing to store a history of, and nothing to publish. With
only this, someone can already answer "is it up and how slow is it right now"
and keep the answer.

**Independent Test**: Point the checker at a list of local test servers with
known behavior (fast, slow, refusing, redirecting) and confirm one accurate,
durable record per target.

**Acceptance Scenarios**:

1. **Given** a target that responds normally, **When** a run executes, **Then** an
   observation is recorded with the timestamp, the final status code, and the
   elapsed time.
2. **Given** a target that does not respond within the timeout, **When** a run
   executes, **Then** an observation is recorded marking it as timed out, with the
   time waited — not an absent record and not a crash.
3. **Given** a target whose name does not resolve or whose certificate is
   invalid, **When** a run executes, **Then** the failure kind is recorded
   distinctly from an HTTP error response.
4. **Given** several targets on the same host, **When** a run executes, **Then**
   requests to that host are separated by at least the minimum interval.
5. **Given** any request the checker sends, **When** it is inspected, **Then** it
   carries the project's identifying User-Agent.
6. **Given** one target fails, **When** the run continues, **Then** the remaining
   targets are still checked and recorded.

---

### User Story 2 - Checks repeat unattended and build a history (Priority: P2)

The checker runs on a schedule without anyone starting it, and observations
accumulate into a record that can be read over time.

**Why this priority**: "Status and speed" is only meaningful as a series — a
single reading cannot distinguish a slow site from a slow moment. But it is worth
nothing until Story 1 works, so it comes second.

**Independent Test**: Let the schedule fire repeatedly against local test servers
and confirm observations accumulate, in order, with no gaps and no overwriting.

**Acceptance Scenarios**:

1. **Given** the schedule is active, **When** the interval elapses, **Then** a run
   starts without human action and its observations are appended to the history.
2. **Given** a previous run is still in progress, **When** the next interval
   arrives, **Then** the runs do not overlap against the same targets.
3. **Given** a run fails entirely (the runner dies, the network is gone), **When**
   the next run executes, **Then** the gap is visible as missing observations
   rather than being backfilled or interpolated.
4. **Given** a target has been failing for many consecutive runs, **When** the next
   run executes, **Then** it is checked no more often than a healthy target, and
   after a failure the wait before retrying is longer, never shorter.

---

### User Story 3 - Someone can see the current state and the recent past (Priority: P3)

A person who did not run the checker can see which sites are up, how fast they
have been responding, and how that has changed — together with how it was
measured.

**Why this priority**: The record has no audience until it is readable. It is
last because the first two stories can be verified by inspecting stored data
directly.

**Independent Test**: From stored observations alone, produce the view and confirm
every figure shown is traceable to recorded measurements and carries its method.

**Acceptance Scenarios**:

1. **Given** stored observations, **When** the view is produced, **Then** each
   figure shows when it was measured, how many samples it came from, and from
   where.
2. **Given** a period with no observations for a target, **When** the view is
   produced, **Then** that period reads as "no data", never as zero and never
   smoothed over.
3. **Given** measurements from a single vantage point, **When** they are
   presented, **Then** the presentation says so rather than implying a property
   of the site alone.

---

### Edge Cases

- **A redirect chain.** Is the measurement the first response or the final one,
  and are cross-domain redirects followed at all?
  [NEEDS CLARIFICATION: redirect handling and what gets timed]
- **A 200 that is really an error.** A site returns a friendly "we're having
  problems" page with a success status. Recorded as up?
  [NEEDS CLARIFICATION: is body-based health checking in scope, given the
  constitution's rule against archiving page bodies]
- **`robots.txt` disallows the target.** The target is skipped and the skip is
  recorded as a reason, not as a failure of the site.
- **A target moves or dies permanently.** Its history stays; it is marked retired
  rather than deleted.
- **The clock.** Observations are timestamped in UTC so a daylight-saving shift
  cannot reorder or duplicate a run.
- **First run against a slow site.** A cold cache or first-byte penalty is
  recorded as measured, not discarded as an outlier.
- **The checker's own network is the problem.** A run where every target fails is
  suspicious; it is recorded, and the view should not read it as a nationwide
  outage. [NEEDS CLARIFICATION: should a run-level "everything failed" marker be
  recorded to let readers discount it?]

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST read its targets from a list that is data, not code,
  so a target can be added or removed without changing program logic.
- **FR-002**: The system MUST perform one check per target per run and record
  exactly one observation per target per run, including for failures.
- **FR-003**: Each observation MUST record, at minimum: the target, a UTC
  timestamp, the outcome, the elapsed time, and enough context to reproduce what
  was requested.
- **FR-004**: The system MUST distinguish outcome kinds — success, HTTP error,
  timeout, connection failure, DNS failure, TLS failure, skipped — rather than
  collapsing them into up/down.
- **FR-005**: The system MUST enforce a minimum interval between requests to the
  same host, a per-request timeout, and a bound on how many hosts are checked
  concurrently, in the checker itself rather than in its callers.
- **FR-006**: The system MUST NOT issue concurrent requests to a single host.
- **FR-007**: Every request MUST carry a User-Agent naming the project and a URL
  where an operator can find out what it is and how to stop it.
- **FR-008**: The system MUST honor `robots.txt` for each target and record a
  disallowed target as skipped, with the reason.
- **FR-009**: After a failed check, the system MUST wait longer than the normal
  interval before checking that target again, never less.
- **FR-010**: The system MUST NOT persist fetched page bodies.
- **FR-011**: Recorded observations MUST NOT be modified or deleted after the
  fact; corrections are recorded as new observations.
- **FR-012**: A failure of one target MUST NOT prevent the remaining targets from
  being checked.
- **FR-013**: The system MUST run without any credential, token, or API key.
- **FR-014**: Observations MUST be stored in [NEEDS CLARIFICATION: where does the
  history live — files committed to this repo, a database, an object store? This
  drives nearly every downstream decision]
- **FR-015**: The system MUST measure [NEEDS CLARIFICATION: what "speed" means —
  time to first byte, time to full response, or a page-level metric requiring a
  real browser? These are very different projects]
- **FR-016**: The system MUST consider a target "up" when [NEEDS CLARIFICATION:
  which status codes count as up — 2xx only, or any response at all?]
- **FR-017**: Runs MUST occur every [NEEDS CLARIFICATION: cadence not specified —
  the politeness ceiling and the usefulness floor both depend on it]
- **FR-018**: The system MUST take [NEEDS CLARIFICATION: samples per target per
  run — one reading is noisy, several multiply the traffic]
- **FR-019**: History MUST be retained for [NEEDS CLARIFICATION: retention period
  and whether old observations are downsampled or dropped]
- **FR-020**: The target list MUST contain [NEEDS CLARIFICATION: which sites, and
  what "popular gov websites" means — US federal only, state and local, other
  countries? Chosen by traffic, by importance, by an existing published list?]

### Key Entities

- **Target**: a public government URL under measurement, with the reason it is on
  the list and whether it is active or retired.
- **Observation**: one immutable measurement of one target at one moment — its
  outcome, its timing, and the context needed to reproduce it.
- **Run**: one pass over the active targets, grouping the observations made in it
  so a run-level problem can be told apart from a target-level one.
- **Method**: how a measurement was taken — vantage point, timeout, sample count
  — carried with any figure derived from it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A run over the full target list completes without human
  intervention and produces one observation per active target, with zero
  unaccounted-for targets.
- **SC-002**: For any target, no two requests from this system to the same host
  are separated by less than the configured minimum interval — verifiable from the
  observation timestamps alone.
- **SC-003**: Every figure in any published view can be traced back to the
  specific observations that produced it, with no unsourced numbers.
- **SC-004**: A target that is down for an entire day shows as down for that day
  and produces no more traffic than a target that was up.
- **SC-005**: Removing a target from the list stops all traffic to it on the next
  run, while its history remains readable.
- **SC-006**: The complete test suite runs with no network access to any external
  host.

## Assumptions

- Targets are public web pages; measurement is outside-in, with no cooperation
  from or notification to the operators.
- A single vantage point is acceptable for a first version, provided every figure
  says so (constitution, Principle V).
- "Popular" is a curated, human-chosen list — not something this system discovers
  on its own.
- Alerting, notifications, and any real-time guarantee are out of scope here; this
  feature records and shows, it does not page anyone.
- Nothing about the language, framework, or hosting is decided by this document.
  That belongs in `plan.md`, after this spec is approved.

## Open Questions Blocking `plan.md`

The clarifications above reduce to five decisions. The first three change the
shape of the system; the last two only tune it:

1. **What does "speed" mean?** A byte-level timing is a small program. A
   page-level metric (render, Core Web Vitals) needs a real browser and is a
   substantially larger project with a heavier footprint on each target.
2. **Where does the history live?** Files committed to this repo make the record
   public, diffable, and free to host, but grow without bound and put write
   traffic in git. A database is the opposite trade on every count.
3. **Which sites, and who says they're popular?** This determines whether the
   target list is a short hand-written file or a pipeline of its own.
4. **How often, and how many samples per run?** Bounded above by Principle I and
   below by whether the data can say anything.
5. **How long is history kept, and at what resolution?**
