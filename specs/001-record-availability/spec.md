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

### User Story 3 - Standard quality audit: performance, accessibility, mobile (Priority: P3)

The system runs each target through an industry-standard auditing tool under
simulated mobile conditions — throttled network and CPU — and records the
published category scores together with the individual audits behind them: which
accessibility rules failed and against which WCAG criteria, whether the page is
mobile-friendly, and the loading metrics.

**Why this priority**: The highest public value of the four and the most
expensive, since it needs a real browser. It is third because the cheaper
dimensions must be stable before this one can run on a schedule.

Using an established tool rather than assembling our own checks is deliberate.
Its scoring methodology is public, versioned, and already trusted, which means
neither this project nor its readers have to take our word for how a number was
reached. That satisfies "a published number carries its method" by construction.

**Independent Test**: Run against local fixture pages with known, deliberate
accessibility defects and known mobile behavior; confirm findings match the
fixtures, including that a clean fixture produces no violations.

**Acceptance Scenarios**:

1. **Given** a target audited under mobile emulation with network and CPU
   throttling, **When** the audit completes, **Then** the category scores, the
   loading metrics, and the throttling profile used are all stored together.
2. **Given** an audit result, **When** it is stored, **Then** the individual failed
   audits are stored alongside the summary score — the score never replaces the
   findings that produced it.
3. **Given** a page with known accessibility violations, **When** the audit runs,
   **Then** each violation is stored with its rule identifier, its severity, the
   WCAG success criteria it maps to, and how many elements matched.
4. **Given** an accessibility result with no violations detected, **When** it is
   stored, **Then** it is recorded as "no violations detected by <tool> <version>"
   and MUST NOT be recorded or later presented as conformance with WCAG or
   Section 508.
5. **Given** a target under mobile emulation, **When** the audit runs, **Then**
   the mobile-friendliness audits — viewport meta, content sized to the viewport,
   tap target sizing, legible font size — are stored individually.
6. **Given** a page that fails to load in the browser, **When** the audit runs,
   **Then** that is stored as a failed check, never as a page with a perfect score
   or zero violations.
7. **Given** a target with enough real-world traffic to appear in a public field
   dataset, **When** an audit runs, **Then** the field measurements are stored
   alongside the lab result and marked as field data — they are what actual
   visitors experienced, and they are not interchangeable with a lab run.

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
- **A grouping turns out to be wrong.** Hosts assumed to be one property prove to
  be separate products, or the reverse. The mapping is corrected and every past
  observation re-aggregates under it; nothing is re-collected and no observation
  changes.
- **A host serves several properties, or a property spans agencies.** A shared
  services portal, or a site jointly operated. A host maps to one property at a
  time; where that is genuinely wrong, the ambiguity is recorded rather than
  resolved by fiat, and the site is reported at host level only.
- **Many hosts, one server.** Several hostnames of one agency resolve to the same
  backend or CDN, so per-hostname limits alone would let a run hit one machine
  repeatedly (FR-003a).
- **The traffic dataset counts differently than we check.** It may report a
  domain where we measure a hostname, or aggregate what we treat separately.
  Recorded as a discrepancy against the target (FR-001a), never quietly averaged.

## Requirements *(mandatory)*

### Functional Requirements

**Targets and traffic**

- **FR-001**: Targets MUST come from a list that is data, not code, each with the
  reason it is included and its active/retired state.
- **FR-001a**: Targets MUST be selected by measured traffic volume, using a public
  dataset of visits to government sites, with each target's inclusion traceable to
  that evidence. Where the traffic dataset's unit of aggregation differs from the
  host being checked, the discrepancy MUST be recorded rather than silently
  reconciled.
- **FR-001b**: Host-to-property and property-to-agency membership MUST be stored as
  a mapping that can be revised without modifying, invalidating, or re-collecting
  any observation.
- **FR-001c**: Observations MUST NOT be keyed to a property. Regrouping hosts MUST
  change only how existing observations aggregate, never their contents.
- **FR-001d**: The mapping MUST record, per property, why its hosts were grouped
  together, so a disputed grouping can be argued about on the evidence.
- **FR-002**: Every request MUST carry a User-Agent naming the project with a URL
  an operator can follow to understand it and to ask for it to stop.
- **FR-003**: The system MUST enforce, inside the checker rather than in its
  callers: a per-host minimum interval, a per-request timeout, a bound on hosts
  checked concurrently, and no concurrent requests to a single host.
- **FR-003a**: The system MUST additionally rate-limit per registrable domain, not
  only per hostname. Many hostnames under one domain frequently share one backend,
  so a per-hostname limit alone permits a burst against a single server that
  satisfies every stated limit — the exact outcome Principle I forbids.
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
  frequently; expensive browser-based audits run rarely. The tiers MUST be
  separately scheduled so the expensive tier cannot inherit the cheap tier's
  frequency.
- **FR-009**: Availability sampling MUST run at least daily per target, at a
  cadence sufficient to classify reliability over weeks and months rather than to
  detect a short outage in progress.
- **FR-010**: Expensive audits MUST be spread across targets over time rather than
  run against all targets at once, so no single window concentrates load.
- **FR-011**: The system MUST record, for every observation, when the check
  actually executed — not the schedule that requested it.
- **FR-011a**: Latency measurements MUST be taken from multiple samples within a
  check, and MUST store the sample count, the median, and the spread. A single
  reading MUST NOT be stored as a site's response time.
- **FR-011b**: The multiple samples in a check MUST still obey the per-host
  minimum interval in FR-003. Sampling for statistical confidence is not a licence
  to burst.
- **FR-011c**: Performance audits MUST apply a documented throttling profile
  approximating a mobile connection, and MUST store which profile was used.
  Results gathered under different profiles MUST NOT be compared as like for like.

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
- **FR-018**: Audit results MUST store the tool's published category scores *and*
  the individual audits behind them. The score is stored as a summary of the
  findings, never as a replacement for them, so any figure shown in `002` can be
  opened up into the specific issues that produced it.
- **FR-018a**: Accessibility results MUST record the tool and ruleset version and
  the WCAG success criteria each violation maps to. A result with no violations
  MUST be stored as "none detected", and the system MUST NOT store, derive, or
  emit a claim of WCAG or Section 508 conformance — automated rules establish
  failure, not conformance.
- **FR-019**: Mobile-friendliness MUST be stored as the individual audits that
  were run, each with its own outcome, in addition to any summary the tool
  provides.
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

### What counts as "a website"

A hostname is not a website. `about.usps.com` and `store.usps.com` are parts of
one thing a visitor would name as a single site; `benefits.va.gov` and
`myhealth.va.gov` share a domain while being separate products with separate
teams, technology, and design. Any single rule — one row per domain, one per
hostname — is wrong for one of these cases.

The resolution is to **not decide it at collection time**. Four levels exist and
they are kept distinct:

| Level | Example | Role |
| --- | --- | --- |
| Agency | Department of Veterans Affairs | Who is accountable |
| Property | My HealtheVet | The coherent "website" a person would name |
| Host | `myhealth.va.gov` | Where a request actually goes |
| Measured URL | `https://myhealth.va.gov/` | What a check actually loads |

Measurement happens at the bottom two levels and is stored there. Property and
agency membership is a **separate, revisable mapping** — data, not structure —
applied when results are aggregated.

This matters because the grouping is a judgment call that *will* be wrong and
*will* change. If it is baked into stored observations, correcting the VA's
decomposition means either losing history or re-collecting it. If it is a mapping
resolved at analysis time, the correction re-aggregates every past observation
automatically, and the observations themselves never change — which Principle IV
requires anyway.

It also means USPS and the VA need no special-casing in the checker. Both are
"hosts that roll up to properties"; they differ only in how many properties the
mapping assigns them to.

### Key Entities

- **Agency**: the accountable government organization. Stable, externally
  verifiable, and the only level of the four that is not our judgment call.
- **Property**: a coherent website as a visitor would name it — one or more hosts,
  belonging to one agency, with the reasoning for the grouping recorded. Revisable
  without touching any observation.
- **Host**: a hostname under measurement, mapped to exactly one property at a time,
  with the traffic evidence that earned it a place on the list.
- **Target**: a host plus the specific URL checked for it, its jurisdiction, why it
  is on the list, and whether it is active or retired.
- **Observation**: one immutable measurement of one dimension of one target at one
  moment, with its outcome, its timings or findings, and its method. Keyed to the
  target and the host — never to a property, so regrouping cannot invalidate it.
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
- **SC-009**: Repeated audits of an unchanged site produce scores stable enough
  that a genuine regression is distinguishable from runner noise — established by
  measuring the spread across runs, not assumed.
- **SC-010**: Every stored accessibility violation names the WCAG criterion it
  maps to, and no stored record asserts conformance.
- **SC-011**: Reassigning a host from one property to another changes only
  aggregated results; a byte-level comparison of the observation record before and
  after shows no difference.
- **SC-012**: No two requests to hosts sharing a registrable domain are closer
  together than the per-domain minimum — verifiable from stored timestamps alone.
- **SC-013**: Every active target's presence on the list traces to traffic
  evidence, with zero targets included on unrecorded judgment.

## Assumptions

- Measurement is outside-in from a single vantage point, with no cooperation from
  or notification to site operators. Every timing therefore measures the network
  path plus the site, and that limitation travels with the data.
- The vantage point is a shared, virtualized CI runner in a datacenter. Two things
  make that workable rather than fatal. Applied throttling normalizes the network
  path, so a throttled score is far more comparable run-to-run than raw wall-clock
  timing; and multi-sample medians (FR-011a) absorb the runner's noise. What
  remains unsuitable is separating two sites whose scores are close together.
- Where a public field dataset of real-user measurements covers a target, it is
  the better evidence of what visitors actually experience, and the lab run is the
  reproducible complement to it. Coverage is not universal — it depends on a site
  having enough traffic — so the record must handle its absence as absence.
- Sampled availability supports reliability *classification*, not precise uptime.
  Daily sampling distinguishes a site that has never failed from one that fails a
  third of the time, which is the distinction that matters here; it cannot support
  "99.9%", and a short outage between samples is invisible.
- The target list is curated by a human. Nothing here discovers sites on its own.
- Automated accessibility scanning is asymmetric evidence: a detected violation is
  a real defect, but no detections is not conformance. Automated rules cover a
  portion of the WCAG criteria and cannot judge whether alt text is *meaningful* or
  whether a flow works with a screen reader. The stored data therefore supports
  "these specific failures exist" and never "this site is accessible".
- Mobile-friendliness starts from the basic, unambiguous audits and gets more
  detailed as the data shows it needs to.
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
- **V. A published number carries its method** — FR-014, FR-018, FR-018a, FR-019,
  FR-020, SC-003, SC-010. Satisfied primarily by adopting a standard tool whose
  scoring method is public and versioned, rather than by withholding scores. The
  one claim still forbidden outright is conformance with WCAG or Section 508,
  which automated scanning cannot establish (FR-018a).

## Resolved Decisions

Recorded here so the reasoning is not re-litigated later.

- **Summarize with an established tool, not our own formula.** Category scores
  come from a standard auditing tool whose scoring methodology is public and
  versioned. Where summarizing is subjective, we adopt someone else's published
  subjectivity rather than inventing our own — and store the underlying audits so
  the summary can always be opened up (FR-018).
- **Scores are stored, and so are the findings under them.** The earlier draft
  refused to store an accessibility score at all. That was too strong: scanners
  produce recordable, WCAG-mapped results, and a standard score over them is
  defensible. What is *not* defensible is a conformance claim, which is a
  different assertion than a score (FR-018a).
- **Sampling statistics, not sampling frequency, carry reliability.** A daily
  check that finds a site up 100% of the time versus 50% already separates those
  sites decisively. Frequency buys outage *resolution*, which is not this
  project's question (FR-009).
- **Latency is a median over several samples, never one reading** (FR-011a), and
  the samples still obey the per-host interval (FR-011b).
- **Performance is measured under mobile throttling** so results are comparable
  across runs despite a noisy datacenter runner (FR-011c).
- **Mobile-friendliness starts with the basic audits** — viewport, content width,
  tap targets, font legibility — and deepens only if the data justifies it
  (FR-019).
- **Scope is US federal websites** for the first release. State, local, and
  territorial government are deferred, not rejected: the data model carries
  jurisdiction from the start (Key Entities: Target) so widening later is adding
  rows, not reshaping the record.

  Two public datasets are candidate sources for the list, both to be confirmed at
  plan time rather than taken on trust here:

  - **The .gov registry** — CISA publishes a daily `current-federal.csv` of
    registered federal `.gov` domains with registrant organization. Confirmed to
    exist. Two caveats: registration is not operation, since a registered domain
    need not serve a site; and branch categorization is not explicit in that file,
    so separating executive from legislative and judicial needs a second source.
  - **Federal traffic analytics** — the government publishes visit data for
    participating federal sites, which would give an objective basis for
    "popular" rather than a hand-picked list. NOT VERIFIED: the fetch was blocked,
    so both its current availability and its coverage are unconfirmed.

  If no traffic source pans out, "popular" falls back to a curated list with the
  reason recorded per target, which FR-001 already requires.
- **"Popular" means measured traffic volume**, not editorial importance (FR-001a).
  A site is on the list because people demonstrably use it. This keeps selection
  out of our hands, which matters when the output is public commentary on named
  agencies — nobody can argue we picked the targets to make a point.
- **The measured unit is the host; "website" is a grouping applied afterwards.**
  See *What counts as "a website"*. Collection never decides whether a set of
  hosts is one site or several, so that judgment can be revised for free.

## Open Questions

One decision remains before `/speckit-plan`. Everything else has a documented
assumption or a resolved decision above.

### Q1 — Do we run the auditing tool ourselves, or call a hosted service that runs it?

**Context**: FR-011c, FR-014, and User Story 3 scenario 7. The same audit is
available both ways, and the choice decides who generates the traffic, where the
vantage point is, and whether real-user field data is available at all. It is
partly a `plan.md` question, but it determines whether field measurements are a
stored dimension, so the spec cannot stay silent on it.

| Option | Answer | Implications |
| --- | --- | --- |
| A | Run the tool ourselves in CI | Full control, no quota, no third-party key, works offline in tests. Our runner is the vantage point, we generate all the traffic, and there is no field data |
| B | Call the hosted service | Its infrastructure fetches the site, not ours — less traffic from us. Returns real-user field data alongside the lab run, which is the strongest available evidence of what visitors experience. Costs a quota-bearing API key, and the vantage point becomes theirs and opaque |
| C | Both — hosted service for the audit and field data, self-run for anything it does not cover | Best evidence and a fallback when a target is missing from the service. Two code paths, two failure modes, and results from the two MUST NOT be mixed in one series |
| D | Decoupled — self-run the lab audit for control, and fetch field data from the field dataset's own interface | Keeps A's reproducibility and still gets real-user data, since the field dataset is queryable independently of the audit service. Two sources, but they are two *different measurements* rather than two ways of taking the same one, so nothing is at risk of being mixed |
| Custom | Something else | — |

**Recommendation: D.** The two things being weighed are not actually coupled — the
hosted service bundles them, but the field dataset can be queried on its own. That
buys A's pinned-version reproducibility, which matters more here than it looks:
this project's value is a record over years, and if the audit tool is upgraded
under us, a site's apparent improvement may be the scoring changing rather than
the site. Self-running means we choose when that happens and can re-run the old
version to separate the two.

The traffic argument cuts the other way and is worth stating: with a hosted
service, *their* infrastructure fetches the target and we send only an API call,
which is strictly less load on the government site than fetching it ourselves.
That is a real point in favor of B under Principle I. It is outweighed here only
because the audit tier already runs rarely against a bounded target list.

Either way, a key for the field dataset or the audit service is a credential for
*that service*, not for any target, so it does not breach Principle II — but it is
still a credential, so it belongs in the layered secret handling, and the checker
MUST degrade to recording "no data" when it is absent rather than failing the run.

### Q2 — Does the public site rank named agencies on a composite score?

**Context**: Principle V and the goal of showing "which are doing best". Mostly a
`002` question; it appears here because it decides nothing about what is stored —
FR-018 keeps both the scores and the findings either way — but it is the decision
most likely to be contentious later, so it is better made early.

| Option | Answer | Implications |
| --- | --- | --- |
| A | Per-dimension standings, no composite | Every number traces to one published methodology; no weighting to defend; readers do their own synthesis |
| B | Composite, with the weighting published and every component openly breakable out | Shareable and still defensible, provided the weighting is stated and arbitrary — which it is |
| C | Composite letter grade per site | Most engaging, hardest to defend: a single letter over a datacenter lab run and automated a11y checks invites a fair complaint from a specific agency |
| Custom | Something else | — |

**Recommendation: A for the first release, B once there is enough history to show
the composite is stable.** Note that a low score on a real audit is a legitimate
finding to publish; the risk is not naming names, it is a number whose method the
reader cannot see.
