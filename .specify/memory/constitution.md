# govWebChecker Constitution

govWebChecker measures the availability and speed of public government websites
it does not own or control. That single fact — we are a guest on someone else's
infrastructure, publishing claims about a public institution — is what these
principles exist to protect. They are binding on the checker, the data it
stores, and anything published from it.

## Core Principles

### I. Measurement, not load (NON-NEGOTIABLE)

- A check MUST generate no more traffic to a target than an ordinary visitor
  browsing that page would.
- Concurrency against a single host, retry storms, and request volume tuned for
  throughput are prohibited. Parallelism across *different* hosts is acceptable;
  parallelism against *one* host is not.
- This project MUST NOT be used to find a site's breaking point, and MUST NOT
  grow a feature whose purpose is to increase pressure on a target.

**Rationale:** Every target is public infrastructure, usually operated by a small
team. A monitoring tool that degrades the service it monitors has destroyed the
thing it was measuring and harmed the people relying on it.

### II. Only the public surface

- Targets MUST be pages reachable by any visitor with no credentials: no logins,
  no session state, no form submissions, no endpoints returning personal data.
- `robots.txt` and published API terms are honored. Where a site offers an
  official status or health endpoint, it is preferred over fetching a page.
- If a target begins requiring authentication or starts returning personal data,
  it is dropped from the list rather than worked around.

**Rationale:** The moment a check needs a credential or reaches personal data,
this stops being an outside-in measurement of a public service and becomes
something nobody agreed to.

### III. Politeness is structural, not conventional

- Rate limits, a minimum interval between requests to the same host, request
  timeouts, and a bound on hosts in flight MUST live inside the checker, where a
  caller cannot forget them or disable them by passing an argument.
- Every request MUST identify itself: a User-Agent naming the project with a URL
  an operator can follow to understand it and to ask for it to stop.
- Backoff after a failure MUST be longer than the normal interval, never shorter.
  A struggling target gets less traffic from us, not more.

**Rationale:** A safety property enforced by documentation fails the first time
someone is in a hurry. And an operator seeing unexplained traffic has no way to
tell a courteous monitor from an attack unless the traffic says who it is.

### IV. An observation is a fact, not a verdict

- A failed, slow, or timed-out check is recorded data — not an error condition,
  not an incident, and not a bug in this code until this code has been ruled out.
- Recorded observations are immutable. A correction is a new observation that
  supersedes the old one; history is never rewritten to look tidier.
- Store measurements — timings, status codes, metadata — not fetched page bodies.
  Page content is transient, potentially large, and not ours to archive.

**Rationale:** The value of this project is a truthful record over time. A record
that gets edited when it looks wrong, or that discards failures as noise, answers
no question worth asking.

### V. A published number carries its method (NON-NEGOTIABLE)

- Any figure this project reports MUST be traceable to when it was measured, from
  where, how many samples, and what was actually requested.
- Reports MUST NOT state or imply a comparison the data cannot support — a single
  vantage point measures the network path to a site, not the site alone, and MUST
  be described that way.
- Absence of data is shown as absence, never as zero, and never silently
  interpolated.

**Rationale:** These measurements name public institutions. A number without its
method is an accusation, and an unfair one is both a disservice to the operators
and a reason for readers to distrust everything else here.

## Data and Publication Constraints

- Stored data covers the target's public behavior only. No personal data about
  visitors or operators is collected, stored, or published.
- The target list is data, not code, and is reviewed as data: adding a target is
  a deliberate act with a stated reason, and a removal request is honored without
  argument.
- No credentials, tokens, or API keys are needed to run a check. If a change
  appears to require one, that is a signal it violates Principle II.
- Anything published — site, feed, or export — carries its methodology alongside
  the numbers, per Principle V.

## Development Workflow and Quality Gates

- Behavior is specified before it is built: a `spec.md` under `specs/` per
  feature, kept current with the code and never silently disagreeing with it.
- Test-first by default: a failing test that captures the expected behavior, then
  the code that makes it pass, with both runs shown.
- The politeness limits in Principle III MUST have tests that fail if a limit is
  removed or loosened. They are the one thing that cannot regress unnoticed.
- Tests MUST NOT send traffic to real government sites. Network behavior is
  exercised against local fixtures or a local server.
- `ARCHITECTURE.md`, the relevant `spec.md`, and the site are updated in the same
  change as the code that affects them — never as a later cleanup pass.
- Secret protection stays layered — pre-commit scan, CI scan, platform push
  protection — and a failing check is never quietly disabled.
- Changes land through a pull request that merges only on green.

## Governance

This constitution supersedes ad-hoc practice, and where it is stricter than the
repository's general working defaults in `AGENTS.md`, it wins. The two
NON-NEGOTIABLE principles are not subject to a convenience exception: a change
that cannot be made without violating them does not get made.

Amendments are made by pull request with the rationale in the commit message. The
version below follows semantic versioning — MAJOR for removing or redefining a
principle, MINOR for adding one, PATCH for clarifications that do not change what
is allowed. Compliance is reviewed at pull request time; a violating change is
either revised or accompanied by an explicit, recorded justification.

**Version**: 1.0.0 | **Ratified**: 2026-07-31 | **Last Amended**: 2026-07-31
