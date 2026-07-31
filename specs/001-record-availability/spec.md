# Feature Specification: Collect and store quality measurements for public sector websites

**Feature Branch**: `001-record-availability`
(directory name kept from the earlier draft; the spec's scope has widened)

**Created**: 2026-07-31 — **Last revised**: 2026-07-31

**Status**: Draft — 3 open questions. Not approved, not planned.

**Input**: User description:

> Many websites owned and operated by the public sector — state, local, and
> federal — vary in quality, usability, reliability, and performance. To help
> improve them it is important to know which are doing best and how each can be
> evaluated and improved. This project is a high level analysis of many such
> sites, providing qualitative and quantitative measurement of each site and of
> the ecosystem as a whole: load time and performance, responsive layout,
> accessibility, SSL configuration, uptime, and web technologies used. The
> codebase is twofold — run checks capturing data for analysis, and process that
> data into insight presented on a public website. Open questions: how to sample
> so significant events like outages are caught without high query overhead, and
> what information is most useful, presented simply for a general audience while
> still giving meaningful detail on specific issues.

## Scope Boundary

This spec covers **the first half only**: running checks and storing the
resulting data. Analysis, presentation, and the public site are specified
separately in `002` (not yet written), because they have different users,
different failure modes, and can be built and tested independently once
observations exist.

The stored data is the interface between the two, so this spec defines what is
captured and what claims that data can honestly support — but not how any of it
is displayed.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Uptime and speed, sampled continuously (Priority: P1)

The system checks each target site frequently and cheaply, recording whether it
responded and how quickly. Over time this becomes a record dense enough to show
that a site was unreachable on a given afternoon.

**Why this priority**: It is the only dimension that is worthless as a snapshot —
"was it up" only means something as a series. It is also the cheapest check per
target, so it sets the sampling rhythm everything else fits around.

**Independent Test**: Run against local servers scripted to be fast, slow,
refusing, and intermittently failing; confirm the stored series reflects each
one's actual behavior, including the gaps.

**Acceptance Scenarios**:

1. **Given** a target responding normally, **When** a sampling run executes,
   **Then** an observation is stored with a UTC timestamp, the final status code,
   and the elapsed time.
2. **Given** a target that does not respond within the timeout, **When** a run
   executes, **Then** a timeout observation is stored with the time waited — not
   an absent record, and not a crashed run.
3. **Given** a target failing DNS, TLS, or connection, **When** a run executes,
   **Then** each failure kind is stored distinctly from an HTTP error status.
4. **Given** several targets on one host, **When** a run executes, **Then**
   requests to that host are serialized and separated by the minimum interval.
5. **Given** a scheduled run does not fire, **When** the next run executes,
   **Then** the gap is visible as missing observations, never backfilled or
   interpolated.
6. **Given** every target in a run failed, **When** the run is stored, **Then** it
   carries a run-level marker so a fault in our own network is not later read as a
   nationwide outage.

---

### User Story 2 - Transport security posture (Priority: P2)

For each target the system records how its HTTPS is configured: certificate
issuer and expiry, protocol versions offered, and whether plain HTTP redirects to
HTTPS.

**Why this priority**: It is objective, it changes slowly, it is cheap to check
infrequently, and unlike the softer dimensions there is little room to argue about
what the result means. An expired certificate is a fact.

**Independent Test**: Point at local servers with a valid cert, an expired cert, a
self-signed cert, and plain HTTP; confirm each is characterized correctly.

**Acceptance Scenarios**:

1. **Given** a target over HTTPS, **When** a posture check runs, **Then** the
   certificate issuer, validity window, and days-to-expiry at check time are
   stored.
2. **Given** a target that serves plain HTTP, **When** a posture check runs,
   **Then** whether it redirects to HTTPS, and how, is stored.
3. **Given** a target whose certificate is expired or untrusted, **When** a
   posture check runs, **Then** that is stored as a finding, and the site is still
   checked for the other dimensions.

---

### User Story 3 - Accessibility and responsive-layout signals (Priority: P3)

The system loads each target in a real browser at more than one viewport width and
records automated accessibility findings and layout signals — which rules failed,
how many elements, and whether the page overflows horizontally on a narrow screen.

**Why this priority**: The highest public value of the four and the most
expensive: it needs a browser, so it is the check that most constrains how often
anything can run. It is third because the cheaper dimensions must already be
stable to run it on a schedule.

**Independent Test**: Run against local fixture pages with known, deliberate
accessibility defects and known layout behavior; confirm findings match the
fixtures — including that a clean fixture produces no findings.

**Acceptance Scenarios**:

1. **Given** a page with known automated-detectable violations, **When** a check
   runs, **Then** each violation is stored with its rule identifier, severity, and
   how many elements matched.
2. **Given** any accessibility result, **When** it is stored, **Then** it is
   labelled as automated-only and carries the tool and ruleset version used.
3. **Given** a page rendered at a narrow viewport, **When** a check runs, **Then**
   horizontal overflow, the presence of a viewport meta tag, and whether the
   layout responds to width are stored as separate signals rather than one
   "responsive" verdict.
4. **Given** a page that fails to load in the browser, **When** the check runs,
   **Then** that is stored as a failed check, not as a page with zero violations.

---

### User Story 4 - Technology and infrastructure fingerprint (Priority: P4)

Where a site openly reveals it, the system records what it is built on: server
and CDN headers, framework or CMS signatures, and analytics or consent tooling.

**Why this priority**: Genuinely useful for ecosystem-level questions ("how much
of state government runs on X") but the least actionable for any single site, and
the least reliable, since detection rests on fingerprints that change.

**Independent Test**: Run against fixtures serving known headers and markers;
confirm detections and, importantly, confirm absence is stored as "not detected"
rather than "not present".

**Acceptance Scenarios**:

1. **Given** a response with identifying headers, **When** a check runs, **Then**
   the detected technologies are stored with the evidence that produced each
   detection.
2. **Given** a site revealing nothing, **When** a check runs, **Then** the result
   is "not detected", explicitly distinct from "no technology in use".
3. **Given** any detection, **When** it is stored, **Then** it carries a
   confidence indication, since fingerprints are inference and not disclosure.

---

### Edge Cases

- **A run costs more than it is worth.** The expensive browser checks must not be
  able to trigger at the frequency of the cheap ones; the schedule enforces this,
  not a convention.
- **The scheduler is late or skipped.** Hosted cron is best-effort and drifts
  under load. Observations record when a check *actually* ran, never when it was
  scheduled to.
- **A site blocks automated traffic.** A challenge page, a 403 to our User-Agent,
  or a WAF block is recorded as "blocked" — a fact about access, distinct from
  both "down" and "up" — and the target is not retried harder to get around it.
- **`robots.txt` disallows the target.** Recorded as skipped with the reason; no
  request beyond `robots.txt` itself.
- **A redirect chain.** The final URL is what was measured, and both the chain and
  the final URL are recorded; a redirect to a different domain is a finding, not
  silently followed forever.
- **A 200 that is really an error page.** Recorded as a 200. This system does not
  judge page content, and the analysis half must not silently claim otherwise.
- **A site is unreachable for weeks.** It keeps its slot at the normal cadence with
  a longer backoff — never checked more often for being down.
- **The site changes between dimensions.** Checks for one target run at different
  times, so each observation stands alone; nothing is presented as a single
  simultaneous snapshot of a site.
- **A target is retired or moves.** History is retained and the target marked
  retired; observations are never deleted to tidy a chart.

## Requirements *(mandatory)*

### Functional Requirements

**Targets and traffic**

- **FR-001**: Targets MUST come from a list that is data, not code, each with the
  reason it is included and its active/retired state.
- **FR-002**: Every request MUST carry a User-Agent naming the project with a URL
  an operator can follow to understand it and to ask for it to stop.
- **FR-003**: The system MUST enforce, inside the checker rather than in its
  callers: a per-host minimum interval, a per-request timeout, a bound on hosts
  checked concurrently, and no concurrent requests to a single host.
- **FR-004**: A full cycle of every dimension against one target MUST NOT exceed
  the traffic of a handful of ordinary visits to that site.
- **FR-005**: The system MUST honor `robots.txt` per target and record a
  disallowed target as skipped.
- **FR-006**: After a failed check the wait before rechecking that target MUST be
  longer than the normal interval, never shorter.
- **FR-007**: The system MUST run with no credential, token, or API key for any
  target.

**Sampling**

- **FR-008**: Checks MUST be tiered by cost: cheap availability sampling runs
  frequently; expensive browser-based checks run rarely. The tiers MUST be
  separately scheduled so the expensive tier cannot inherit the cheap tier's
  frequency.
- **FR-009**: Availability sampling MUST run at [NEEDS CLARIFICATION: see Q2 — the
  cadence determines what uptime claims the data can support].
- **FR-010**: Expensive checks MUST be spread across targets over time rather than
  run against all targets at once, so no single window concentrates load.
- **FR-011**: The system MUST record, for every observation, when the check
  actually executed — not the schedule that requested it.

**What is stored**

- **FR-012**: Each check MUST produce exactly one stored observation, including
  when it fails, tagged with its dimension and its target.
- **FR-013**: Observations MUST distinguish outcome kinds — success, HTTP error,
  timeout, connection failure, DNS failure, TLS failure, blocked, skipped — rather
  than collapsing to up/down.
- **FR-014**: Every observation MUST carry the method that produced it: what was
  requested, the timeout, the vantage point, and the version of any tool or
  ruleset whose output it contains.
- **FR-015**: The system MUST NOT persist fetched page bodies, subresources, or
  screenshots. Page content may be analyzed in memory during a check; only
  findings derived from it are stored.
- **FR-016**: The system MUST NOT store personal data. If a check would capture
  content identifying an individual, the finding is stored without it.
- **FR-017**: Stored observations MUST NOT be modified or deleted after the fact;
  a correction is a new observation superseding the old.
- **FR-018**: Accessibility results MUST be stored labelled as automated-detection
  only, with the ruleset version, and MUST NOT be stored as a single score or
  grade. Scoring, if any, is an analysis decision made in `002` against data that
  keeps the underlying findings intact.
- **FR-019**: Layout results MUST be stored as the individual signals observed,
  not as a "responsive: yes/no" verdict.
- **FR-020**: Technology detections MUST be stored with their evidence and a
  confidence indication, and absence MUST be recorded as "not detected".
- **FR-021**: The storage format MUST be readable and queryable without running
  this project's code, so the record outlives the tooling.
- **FR-022**: Storage MUST be append-mostly and MUST NOT grow without bound in a
  way that makes the history unusable; the retention and resolution policy is
  recorded with the data.

**Failure behavior**

- **FR-023**: A failure of one target or one dimension MUST NOT prevent the other
  targets or dimensions in that run from being checked and stored.
- **FR-024**: A run where every target failed MUST be marked at the run level.
- **FR-025**: The system MUST NOT treat a slow or unavailable target as an error
  condition requiring intervention.

### Key Entities

- **Target**: a public sector site under measurement — its URL, the government
  level and jurisdiction it belongs to, why it is on the list, active or retired.
- **Observation**: one immutable measurement of one dimension of one target at one
  moment, with its outcome, its timings or findings, and its method.
- **Run**: one execution of one tier, grouping its observations so a run-level
  fault is distinguishable from a target-level one.
- **Method**: vantage point, timeouts, tool and ruleset versions, viewport widths —
  everything needed to reproduce or discount a measurement.
- **Finding**: a single detected issue within an observation — an accessibility
  rule violation, an expiring certificate — with its evidence.

## Success Criteria *(mandatory)*

- **SC-001**: A full sampling cycle completes unattended and produces one
  observation per active target per scheduled dimension, with zero targets
  silently missing.
- **SC-002**: No two requests to the same host are closer together than the
  configured minimum — verifiable from the stored timestamps alone, with no access
  to the code.
- **SC-003**: For any stored figure, the method that produced it can be recovered
  from the record without consulting the code that ran.
- **SC-004**: A target that is down for a day produces no more traffic than one
  that is up.
- **SC-005**: Removing a target from the list stops all traffic to it on the next
  run, and its history remains readable.
- **SC-006**: The whole test suite runs with no network access to any external
  host, and no test ever contacts a real government site.
- **SC-007**: An independent reader, given only the stored data, can reproduce any
  ecosystem-level count without re-running a check.
- **SC-008**: Total scheduled compute stays within the free tier of a hosted CI
  runner, since exceeding it is the failure mode that quietly kills the project.

## Assumptions

- Measurement is outside-in from a single vantage point, with no cooperation from
  or notification to site operators. Every timing therefore measures the network
  path plus the site, and that limitation travels with the data.
- The vantage point is a shared, virtualized CI runner in a datacenter. Its timings
  are noisy and are not what a citizen on a home or mobile connection experiences.
  This makes the data suitable for detecting large changes and gross outliers, and
  unsuitable for fine-grained ranking between similar sites.
- Scheduling is best-effort. Precise uptime percentages are not claimable from
  sampled checks; the data supports "unreachable when we looked", not "99.9%".
- The target list is curated by a human. Nothing here discovers sites on its own.
- Automated accessibility checking detects a well-documented minority of real
  barriers. It finds no issue on many pages that are unusable with a screen
  reader, and it cannot judge whether alt text is *meaningful*. The stored data is
  evidence, never a verdict on whether a site is accessible.
- "Responsive" has no automated test. What is stored are proxies — viewport meta,
  overflow at width, layout change across widths — which together suggest, and
  never establish, a good mobile experience.
- Alerting and any real-time guarantee are out of scope. This half records.
- Nothing here decides language, framework, or hosting; that is `plan.md`, after
  this spec is approved.

## Constitution Check

- **I. Measurement, not load** — FR-003, FR-004, FR-006, FR-010. The browser-based
  tier is the risk: one render pulls many subresources. It stays within "a handful
  of ordinary visits" and runs rarely.
- **II. Only the public surface** — FR-005, FR-007. All dimensions are observable
  without credentials.
- **III. Politeness is structural** — FR-002, FR-003 place the limits inside the
  checker.
- **IV. An observation is a fact** — FR-012, FR-013, FR-017, FR-025. Requires the
  1.0.1 clarification that in-memory analysis of a page is allowed where persisting
  it is not (FR-015).
- **V. A published number carries its method** — FR-014, FR-018, FR-019, FR-020,
  SC-003. The dimensions where an unqualified number would mislead — accessibility
  and responsiveness — are constrained to store findings rather than scores.

## Open Questions

Three decisions, needed before `/speckit-plan`. Everything else has a documented
assumption above.

### Q1 — Which governments, and how is the list sourced?

**Context**: FR-001. "Public sector" spans a federal executive agency and a county
parks department, whose expectations differ by orders of magnitude.

| Option | Answer | Implications |
| --- | --- | --- |
| A | US federal executive agencies only | Smallest, best-defined, published lists exist; comparisons are fair; ~200 targets |
| B | Federal + all 50 states' primary portals | Still bounded and hand-curatable; enables state-vs-state, the most publicly interesting cut |
| C | Add local (city/county) | Hundreds to thousands of targets; the list becomes a data pipeline of its own and the cost model changes completely |
| Custom | Something else | — |

**Recommendation: B.** It is curatable by hand, gives the ecosystem view the goal
asks for, and keeps the cost inside a free CI tier.

### Q2 — How often does availability sampling run, and what may be claimed from it?

**Context**: FR-009, and your question about catching outages without high
overhead. Hosted cron realistically gives 10–15 minute granularity with drift.

| Option | Answer | Implications |
| --- | --- | --- |
| A | Every ~15 min | Catches outages over ~15 min; ~96 runs/day; will strain a free tier at hundreds of targets |
| B | Hourly | Catches multi-hour outages only; comfortably free; "unreachable when we looked" is the honest claim |
| C | Adaptive — hourly baseline, tightening to ~15 min for a target that just failed | Best signal per request, and the backoff rule in FR-006 must not be violated: tightening after a *failure* means more traffic to a struggling site |
| Custom | Something else | — |

**Recommendation: B to start.** C is tempting and is the one design here that
could put us on the wrong side of Principle I. If adaptive sampling is wanted, it
should tighten around *recovery* (confirming a site is back), not around failure.

### Q3 — Does the public site rank or grade individual named sites?

**Context**: FR-018, Principle V, and the goal of showing "which are doing best".
This is `002`'s question, but it constrains what this half must store, so it
cannot wait.

| Option | Answer | Implications |
| --- | --- | --- |
| A | Ecosystem aggregates + per-site detail, no ranking or letter grade | Defensible from automated data; less shareable; weaker pressure to improve |
| B | Rank on objective dimensions only (uptime, cert validity, load time); accessibility shown as findings, never scored | Honest, since scored dimensions are unambiguous; accessibility still visible and actionable |
| C | Full composite score and league table across all dimensions | Most engaging and most likely to be shared — and most likely to be wrong about a specific agency, from a datacenter vantage point and automated a11y checks |
| Custom | Something else | — |

**Recommendation: B.** C is the version that gets attention, and it is also the
version where an agency can fairly say the numbers misrepresent them — which
Principle V exists to prevent.
