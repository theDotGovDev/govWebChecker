# Feature Specification: analysis and presentation

**Feature Branch**: `002-analysis-presentation`

**Created**: 2026-08-22

**Status**: Draft — Q1 and Q2 decided, ready for `/speckit-plan`

**Input**: Turn the stored record into answers a reader can trust, and publish
them.

---

## Scope Boundary

`001` and `003` collect and store. This feature reads what they stored and
publishes answers from it. **Nothing here generates a single request to a
target.** That is not a nicety of layering — it is Principle I: a question that
can be answered from the record must be, and re-probing to look something up
twice spends a jurisdiction's resources to learn what we already know.

The stored record is the interface, and it is already fixed:

| | Hot tier | Broad tier |
| --- | --- | --- |
| What | 58 traffic-selected federal hosts | all 16,535 registered US `.gov` domains |
| Cadence | hourly | one seventh of the frame per day, a full cycle per week |
| Answers | short interruptions, latency over hours | coverage, presence, change over months |
| Cannot answer | anything about the other 16,477 domains | a thirty-minute outage |

Every observation carries `tier`, `cycle`, `slice`, `resolution`, `presence`,
`method` and `url_rule`. Those fields exist precisely so this feature can state
what a figure covers without joining against a target list that may since have
changed.

**Out of scope**: collecting anything new; new dimensions beyond availability
(performance, accessibility and technology findings are `001` FR-018's shape and
arrive later); any interface that lets a reader trigger a check.

---

## Why this is harder than it looks

The census makes it possible to publish, weekly, a named judgement about 16,535
American jurisdictions — most of them small towns, school districts and county
clerks with no communications staff and no way to answer back. That is the risk
this feature exists to manage, and it is not hypothetical.

The measured shape of one completed slice (2,360 domains, 2026-W34):

| Reading | Count | Share |
| --- | ---: | ---: |
| `website` — resolved, and answered | 1,768 | 74.9% |
| `undetermined` — we do not know | 346 | 14.7% |
| `no_website` — publishes no web address | 246 | 10.4% |

**The second-largest category is "we do not know."** A site that collapsed
`presence` into working/broken would publish roughly 25% of US local government
as failing, when a quarter of that is jurisdictions with deliberately no website
and well over half is our own inability to complete a connection. One in seven
of those judgements would be an accusation with no evidence behind it.

This is why the requirements below are mostly about what the site must *refuse*
to say.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — A reader gets a figure that carries its method (Priority: P1)

Someone lands on the site and reads a number: how much of federal government
availability we saw last month, or how much of `.gov` publishes a website. They
can tell, without leaving the page, what the number counts, when it was
measured, from where, how many readings it rests on, and what it does not
support.

**Why this priority**: Principle V is NON-NEGOTIABLE and this is it. A figure
without its method is an accusation. Every other story depends on this one being
true, so it is the MVP: a site that published only one honest number would still
be worth having.

**Independent Test**: Take every figure rendered on the site, and for each one
follow it to a statement of vantage, sample count, window, and tier. A figure
that cannot be followed is a failure, and the test names it.

**Acceptance Scenarios**:

1. **Given** an availability percentage on the site, **When** a reader looks at
   it, **Then** the tier, the window it covers, the number of readings and the
   vantage are stated with it — not in a footnote, not on another page.
2. **Given** a figure computed from a single vantage point, **When** it is
   published, **Then** it is described as the network path to the site from that
   vantage, never as a property of the site alone.
3. **Given** a period with no readings, **When** it is rendered, **Then** it
   shows as absent — never as zero, never interpolated across.
4. **Given** a reader who wants to check us, **When** they follow the method,
   **Then** they reach the stored record and the verification tool that proves
   the record's own guarantees.

---

### User Story 2 — Absence, uncertainty and failure never become one number (Priority: P1)

A reader sees how much of US `.gov` has a website, how much does not, and how
much we could not establish — as three separate things, everywhere, with no view
that merges them.

**Why this priority**: Equal to US1, and for the same reason. `undetermined` is
14.7% of the census and `no_website` is 10.4%; a single "down" number would
misreport a quarter of American local government. `003` went to considerable
length to keep these distinct in the record, and a presentation layer that
collapsed them would waste that entirely.

**Independent Test**: Assert that no rendered view contains a category combining
`no_website` or `undetermined` with a failure state, and that the three counts
are recoverable from any aggregate shown.

**Acceptance Scenarios**:

1. **Given** a domain publishing mail and no web address, **When** it appears in
   any view, **Then** it is shown as having no website — never as broken, failing
   or down.
2. **Given** a domain we could not resolve or reach, **When** it appears,
   **Then** the site says we do not know, and says whose failure that may be.
3. **Given** an aggregate of the census, **When** a reader looks at it, **Then**
   the denominator is stated and the three states are separable within it.
4. **Given** a site that answered with a 500, **When** it is shown, **Then** it
   is a website, and a broken one — the distinction `presence` already records.

---

### User Story 3 — Per-tier figures are never blended (Priority: P2)

A reader comparing federal availability against the census sees two figures that
are explicitly of different things, and the site never computes one number
across both.

**Why this priority**: Blending is the easiest possible mistake and the most
misleading. An hourly reading of 58 heavily-resourced federal hosts and a weekly
reading of 16,535 mostly-municipal domains answer different questions; averaging
them produces a number that describes neither population and flatters the second
by mixing in the first.

**Independent Test**: Assert that no figure on the site is computed over
observations of more than one `tier`, and that each figure names its population
and its cadence.

**Acceptance Scenarios**:

1. **Given** both tiers have data, **When** any availability figure is shown,
   **Then** it names one tier, one population size and one cadence.
2. **Given** a domain checked in both tiers, **When** its readings are presented,
   **Then** they stay separable rather than being pooled into one history.
3. **Given** a reader wants to compare the tiers, **When** they do, **Then** the
   site presents them side by side with what each can and cannot answer — never
   as a single derived score.

---

### User Story 4 — Change over time, at two different cadences (Priority: P2)

A reader sees whether things are getting better or worse, without the weekly
census being drawn as though it were an hourly series.

**Why this priority**: "Change over months" is the census's whole purpose, and
the tier's cadence is the constraint that makes it easy to misdraw. A weekly
reading rendered as a continuous line implies knowledge of the days between it,
which we do not have.

**Independent Test**: Assert that a census series renders one mark per cycle with
no interpolation between cycles, and that an incomplete cycle is visibly
incomplete rather than dipping.

**Acceptance Scenarios**:

1. **Given** a census series, **When** it is drawn, **Then** each cycle is one
   reading and nothing is drawn between cycles.
2. **Given** a cycle still in progress, **When** it is shown, **Then** it is
   marked in-progress and its partial coverage is not read as a decline.
3. **Given** a gap where collection failed, **When** the series is drawn,
   **Then** the gap is visible as a gap.
4. **Given** the frame changed between cycles, **When** a trend is shown,
   **Then** the change in denominator is disclosed alongside it.

---

### User Story 5 — A named jurisdiction can see and challenge what is published (Priority: P2)

An operator at a named jurisdiction finds what this project says about their
domain, when it was measured, what was requested, and how to have it corrected
or to be removed.

**Why this priority**: The constitution requires a removal request to be honored
without argument, and `003` already implements exclusions. This story makes that
reachable by the person it exists for.

It was drafted at P3 while Q2 was open and rose when Q2 was decided. Publishing a
listing for all 16,535 domains means every jurisdiction is named whether or not
anyone came looking, so the route by which a named jurisdiction sees and
challenges what is published stops being a courtesy and becomes the thing that
makes naming them defensible.

**Independent Test**: From any place a domain is named, reach the readings behind
that naming and a stated route to correction, in one step.

**Acceptance Scenarios**:

1. **Given** a domain named anywhere on the site, **When** an operator finds it,
   **Then** they can see every stored reading for it with timings and what was
   requested.
2. **Given** an operator wants the domain removed, **When** they follow the
   stated route, **Then** the process is described and requires no argument from
   them.
3. **Given** a domain has been excluded, **When** the site is rebuilt, **Then**
   it no longer appears in any current view while its historical readings remain
   readable.
4. **Given** a reading is disputed, **When** a correction is published, **Then**
   it appears as a superseding observation and the original remains visible —
   history is not rewritten.

---

### Edge Cases

- **A cycle that never completes.** Coverage is reported against the slices that
  ran, and the cycle is shown as incomplete rather than as a decline in whatever
  it measures.
- **A domain that leaves the registry.** Its history remains readable and is not
  retroactively removed; the current view no longer names it.
- **The whole record is empty**, or a tier has no observations at all. The site
  states that there is nothing to report rather than rendering zeroes.
- **Our own collection broke.** A period where the checker failed must not read
  as a period where government websites failed. Vantage and run outcomes are part
  of what is published.
- **One vantage, one path.** Every figure is from `github-actions/*`. A reading
  labelled `local` is a development artefact and must never be presented as a
  measurement of a target.
- **A single dramatic finding.** One jurisdiction with a broken site is a fact
  about one reading, not a story, and the presentation must not let a single
  observation become a headline about an institution.

---

## Requirements *(mandatory)*

### Method travels with the figure

- **FR-201**: Every figure published MUST state the tier, the population it
  covers, the window it covers, the number of readings behind it, and the
  vantage. This is Principle V and admits no exception for brevity.
- **FR-202**: Every figure MUST be traceable by a reader to the stored
  observations that produced it, without privileged access.
- **FR-203**: The site MUST NOT state or imply a comparison the record cannot
  support. A single-vantage reading is described as the network path from that
  vantage, never as a property of the target alone.
- **FR-204**: Absence of data MUST be shown as absence. Never zero, never
  interpolated, never averaged across a gap.
- **FR-205**: The rule that produced any derived reading MUST be named and
  versioned where it is shown, so a later rule change is visible as a different
  rule rather than as an unexplained movement in the data.
- **FR-206**: The site MUST publish, or link, the record it was built from and
  the tool that verifies that record's guarantees.

### Absence is not failure

- **FR-210**: `no_website`, `undetermined` and a failed request MUST remain three
  distinct states in every view. No view may present a category that merges any
  two of them.
- **FR-211**: Any aggregate MUST state its denominator, and the three states MUST
  be recoverable from it.
- **FR-212**: `undetermined` MUST be presented as our uncertainty, not as the
  jurisdiction's failure, and MUST say what is unknown.
- **FR-213**: A domain publishing no web address MUST NOT appear in any count,
  chart, list or ranking of broken, failing or unavailable sites.
- **FR-214**: A response carrying an error status MUST be presented as a website
  that is broken, distinct both from a domain with no website and from one we
  could not reach.

### The tiers stay apart

- **FR-220**: No published figure may be computed across observations of more
  than one tier.
- **FR-221**: Each figure MUST name its tier's population and cadence where it
  appears.
- **FR-222**: A domain present in both tiers MUST have its readings presented
  separably.
- **FR-223**: The site MUST state, for each tier, the questions it can and cannot
  answer — specifically that the broad tier cannot detect a short interruption
  and the hot tier says nothing about the other 16,477 domains.

### Change over time

- **FR-230**: A census series MUST render one reading per cycle with nothing
  drawn between cycles.
- **FR-231**: An incomplete cycle MUST be visibly incomplete and MUST NOT be
  presented as a movement in what it measures.
- **FR-232**: A change in the frame between cycles MUST be disclosed wherever a
  trend across that change is shown.
- **FR-233**: A gap in collection MUST be visible as a gap and MUST be
  distinguishable from a gap in the thing being measured.

### Fairness to the named

- **FR-240**: Wherever a jurisdiction is named, its underlying readings and the
  route to correction or removal MUST be reachable in one step.
- **FR-241**: A removal request MUST be honored without argument; the domain
  leaves current views while its existing observations remain readable.
- **FR-242**: A correction MUST appear as a superseding observation with the
  original still visible. History is never rewritten.
- **FR-243**: The site MUST NOT present a single observation as a characterisation
  of an institution.
- **FR-244**: The site MUST NOT publish any content identifying an individual —
  named officials, contact people, or security contacts carried in the registry.

### Standings, and what is never computed

Settles Q1 as option A.

- **FR-260**: The site MUST NOT compute or publish a composite score, index,
  rating or grade combining more than one measure. Standings are per-dimension,
  each traceable to one published methodology.
- **FR-261**: A target with no rate MUST NOT be assigned one. A host that refused
  automated traffic, or that `robots.txt` told us not to check, has no
  availability rate — it MUST NOT be rendered as zero and MUST NOT appear in any
  ordering by that rate.
- **FR-262**: Any ordering MUST name the single measure it sorts on, and MUST
  state the population and window it sorts within.

### A listing for every domain

Settles Q2 as option A.

- **FR-245**: Every domain in the frame MUST have its own listing carrying its
  stored readings, the method behind them, and the route to correction or
  removal. No jurisdiction is reachable only by knowing to search for it.
- **FR-246**: A listing whose readings are `undetermined` MUST lead with what is
  unknown and MUST NOT be presented as a finding about the jurisdiction. This is
  FR-212 at the page level, and it is where the risk actually lands: roughly one
  listing in seven will have nothing to report but our own failure to establish a
  connection.
- **FR-247**: A listing MUST state when the domain was last checked and at what
  cadence, so a weekly reading is never read as a current one.
- **FR-248**: An excluded domain's listing MUST be withdrawn from the site while
  its existing observations remain readable in the record (with FR-241).
- **FR-249**: A listing MUST NOT assert anything the record does not contain. A
  domain checked once carries one reading, presented as one reading.

### Building and publishing

- **FR-250**: The site MUST be generated from the stored record and MUST send no
  request to any target while generating.
- **FR-251**: Generation MUST fail rather than publish a figure it cannot attach
  a method to.
- **FR-252**: The site MUST state when it was last built and how current the
  readings behind it are, per tier.
- **FR-253**: A reading whose vantage is not a collection runner MUST NOT be
  presented as a measurement of a target.

### Key Entities

- **Figure** — a number the site publishes. Carries tier, population, window,
  sample count, vantage, and the rule that derived it. A figure that cannot carry
  these does not get published (FR-251).
- **Tier view** — everything computable about one tier, and the statement of what
  that tier cannot answer.
- **Cycle reading** — one census cycle's result: its coverage, its three presence
  counts, and whether the cycle completed.
- **Domain listing** — what the site says about one named domain, and the route to
  challenge it. One exists for every domain in the frame (FR-245).

---

## Success Criteria *(mandatory)*

- **SC-201**: 100% of figures on the site can be followed to their tier, window,
  sample count and vantage. A figure that cannot is a build failure, not a
  cosmetic defect.
- **SC-202**: No view merges `no_website`, `undetermined`, or a request failure
  into a shared category — verifiable by inspecting every rendered category
  against the three states.
- **SC-203**: No figure is computed across tiers, verifiable from the observations
  each figure is derived from.
- **SC-204**: A reader given only the published site and the stored record can
  reproduce every headline figure without trusting the generator.
- **SC-205**: An operator can go from their jurisdiction being named to its
  underlying readings and a removal route in one step.
- **SC-206**: A period in which collection failed is distinguishable, on the site,
  from a period in which government websites failed.
- **SC-207**: A census cycle in progress is never rendered as a decline.
- **SC-208**: Zero individuals are named anywhere in the published output.
- **SC-209**: Every domain in the frame has a reachable listing, and no listing
  presents our own failure to reach a domain as a finding about it.
- **SC-210**: No published ordering assigns a rate to a target that has none —
  checkable against the four federal hosts that currently have no rate.

---

## Assumptions

- The record is the only input. If a question cannot be answered from stored
  observations and the committed frame, this feature does not answer it.
- Availability is the only dimension with data. Performance, accessibility and
  technology findings (`001` FR-018, FR-018a) are anticipated by the structure
  but not presented, because nothing collects them yet.
- The site remains statically generated into `docs/` and published by
  `pages.yml`, per the existing project rule; no site generator or framework is
  introduced.
- Readers arrive without context. Nothing assumes familiarity with the tiers, the
  census, or what a `.gov` domain is.
- The audience is public: residents, journalists, researchers, and operators at
  the named jurisdictions. There is no authenticated or internal view.
- Vantage remains single. Multi-vantage measurement would change what comparisons
  are supportable and is a later question.

---

## Dependencies

- `001` for the hot tier's observations and the record contract.
- `003` for the census, the frame, `presence`, `resolution`, and coverage.
- The census schedule is currently **disabled** pending a run that fits the job
  cap with margin. This feature can be built and tested against the record as it
  stands, but its census views will show one cycle until collection resumes.

---

## Decisions

Both questions the draft left open are settled. They are recorded with their
reasoning rather than as bare answers, because both decide what this project is
willing to say about named public institutions and both will look arbitrary later
if the reasoning is not written down.

### D1 — Per-dimension standings, no composite  *(was Q1, option A)*

Carried forward from `001`, where it was recorded early precisely because it
decides nothing about what is stored and everything about what is published. `003`
raised the stakes: the question was about 58 federal hosts and became a question
about 16,535 jurisdictions.

**Decided: A.** Standings are per-dimension. No composite, index or grade.

The record settled it. Over nineteen days, four of the 58 federal hosts answered
nothing successfully — and none of them was down:

| Host | 64 of 64 readings | What it means |
| --- | --- | --- |
| `secure.login.gov` | `skipped` | `robots.txt` tells us not to check it |
| `www.ssa.gov` | `blocked` 403 | refuses automated traffic |
| `travel.state.gov` | `blocked` 403 | refuses automated traffic |
| `tools.usps.com` | `blocked` 403 | refuses automated traffic |

Any composite has to carve these four out or publish Social Security at zero
availability. Once the carve-out exists, the composite is doing no work the
per-dimension columns were not already doing, and it costs a weighting nobody can
defend. FR-261 makes the carve-out a requirement rather than a special case.

Revisitable: this is the smaller and more reversible of the two, and adding a
sortable derived column later changes nothing already published.

### D2 — A listing for every domain in the frame  *(was Q2, option A)*

**Decided: A.** All 16,535 domains get a listing.

Every option published the same data — the record is a public file in a public
repository regardless. What differed was whether a jurisdiction is reachable only
by knowing to search for it. A census that names 16,535 jurisdictions in aggregate
while giving none of them a page of their own would be asserting things about
places it declined to address directly.

The cost is real and is stated rather than hidden: roughly one listing in seven
will report nothing but our own failure to establish a connection, and unlike a
missing page, a published one is found by people who were not looking for it.
FR-246 is the mitigation and it is a requirement, not a style note — such a
listing leads with what is unknown and does not read as a finding about the
jurisdiction.

Not symmetrically reversible: withdrawing listings after they are indexed leaves
cached copies and broken links behind, which is why the trade is recorded here
rather than treated as a layout choice.

## Constitution Check

| Principle | How this feature satisfies it |
| --- | --- |
| I — Measurement, not load | No request to any target is generated. FR-250 makes it structural: the generator reads the record and nothing else |
| II — Only the public surface | Nothing new is fetched. FR-244 additionally refuses to republish the individuals the registry carries |
| III — Politeness is structural | Not engaged; this feature sends no traffic |
| IV — An observation is a fact | FR-242 keeps corrections as superseding observations. FR-243 refuses to turn one reading into a characterisation |
| V — A published number carries its method (NON-NEGOTIABLE) | FR-201 to FR-206, and SC-201 makes a method-less figure a build failure rather than a style problem |
