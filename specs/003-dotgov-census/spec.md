# Feature Specification: A census of US `.gov` domains, checked in two tiers

**Feature Branch**: `003-dotgov-census`

(Numbered `003` rather than `002`. `002` stays reserved for analysis and
presentation, which `001`'s scope boundary and `AGENTS.md` both name; taking the
number would falsify those references.)

**Created**: 2026-08-21

**Status**: Draft — ready for `/speckit-plan` on approval.

**Input**: User description:

> I want to slightly change the approach of this project, so that it is more
> focused on collecting data about a broad swath of US govt websites, rather
> than only focusing on the top sites. We will still want to collect the same
> data, but maybe less frequently, to allow a much larger total volume of sites.
> Ideally, this would include all .gov domains in the US.

## Scope Boundary

This feature changes **which targets are checked and how often**. It does not
change what an observation contains, how availability is measured, or how the
record is stored and verified — those stay as `001` built them, and existing
observations stay valid.

Analysis and presentation remain out of scope, in `002`.

## Why this is a change to `001`, not a new system

`001` is built and running: 58 federal hosts, checked hourly, selected by
measured traffic. Two of its requirements are directly contradicted here and
MUST be revised in the same change (see *Requirements changed in `001`*):

- **FR-001a** requires targets to be *selected by measured traffic volume*, with
  each inclusion traceable to that evidence. A census does not select.
- **FR-009** requires availability sampling *at least hourly per target*. A
  census of 16,535 domains cannot be hourly and stay within Principle I.

Everything else in `001` — the record contract, the politeness limits, the
verify gate, the vantage constraint — carries over unchanged.

## Source data

Confirmed by probe from a runner on 2026-08-21 (workflow run `32495389294`),
so these are current measured figures rather than estimates:

| Source | Size | Role |
| --- | --- | --- |
| CISA `cisagov/dotgov-data` `current-full.csv` | 16,535 domains | The census frame. All types: Federal, State, County, City, Tribal, Interstate. |
| CISA `current-federal.csv` | 1,321 domains | Federal subset, already used by `001`. |
| `analytics.usa.gov/data/live/sites.csv` | 9,999 hostnames ranked by visits | Selects hot-tier membership. Federal only (Digital Analytics Program participants). |

The registry carries per domain: domain name, domain type, organization name,
suborganization name, city, state, security contact email.

## Measured evidence

Every figure below comes from a DNS-only survey of the whole registry
(`survey-dns` run `32544034683`, 2026-08-22, 104 seconds). It sent no HTTP
request to any government web server, so it cost the surveyed jurisdictions
nothing. `research/dns-survey.mjs` re-runs it when the registry drifts.

| What the domain publishes | Count | Share |
| --- | ---: | ---: |
| Address at both apex and `www` | 13,431 | 81.2% |
| Address at apex only | 567 | 3.4% |
| Address at `www` only | 348 | 2.1% |
| Mail service only, no web address | 1,368 | 8.3% |
| Name exists, publishes nothing | 439 | 2.7% |
| Name does not exist | 0 | 0.0% |
| Our resolution failed | 382 | 2.3% |

Three findings drive the requirements:

**1,807 domains (10.9%) publish no web address at all.** Roughly one registered
`.gov` in nine is not a website. Checked without modelling absence, the census
would publish 1,807 false claims of a broken government website every cycle.

**Neither the apex nor `www` alone is sufficient.** 348 domains answer only at
`www` and 567 only at the apex, so either single-form rule misreports hundreds
as absent. Trying both covers 14,346 (86.8%). The `www`-only rate is also
strikingly uneven — 0.9% for City Election domains, 41.7% for Federal Judicial —
so a single-form rule would distort comparisons between jurisdiction types, not
merely lose rows.

**Zero non-existent names, and that figure is trustworthy.** The survey reports
the resolver *did* distinguish NXDOMAIN, so 0 is a fact rather than an artefact
of a resolver that collapses the two. It is also the expected result: a
registered domain exists in DNS by definition.

Absence is spread across government, not concentrated in small jurisdictions:

| Registry type | Domains | No web address | `www`-only |
| --- | ---: | ---: | ---: |
| Federal - Judicial | 24 | 33.3% | 41.7% |
| School district | 65 | 27.7% | 3.1% |
| Tribal | 286 | 15.0% | 4.9% |
| Special district | 1,104 | 13.9% | 2.6% |
| County | 2,637 | 13.0% | 2.4% |
| State or territory | 1,409 | 12.0% | 3.0% |
| Federal - Executive | 1,174 | 10.1% | 4.9% |
| City | 8,976 | 9.6% | 1.3% |

Cities have the *lowest* rate of any large category, slightly below Federal
Executive. In absolute terms they still dominate — 863 of the 1,807 — simply
because there are 8,976 of them. The risk is therefore one of volume spread
across all of government, not of a bias against small jurisdictions.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Every US `.gov` domain is covered, and coverage is provable (Priority: P1)

Someone studying the `.gov` ecosystem wants to ask questions about *all* of it —
how many domains serve a public website at all, how availability differs between
federal and municipal government, whether small jurisdictions are worse served
than large ones. Today they cannot: the record covers 58 hand-picked federal
hosts, which is a sample chosen for prominence and cannot answer a question
about the population.

They need every registered `.gov` domain to appear in the record on a regular
cycle, and they need to be able to confirm from the stored data alone that a
cycle actually covered what it claims — not to take a coverage assertion on
trust.

**Why this priority**: This is the entire point of the feature. Without it
nothing else here has value.

**Independent Test**: Run one full cycle against a fixture registry and confirm
that every domain in the frame produced exactly one observation, and that the
stored record lets a reader reconstruct the coverage count without re-running
anything.

**Acceptance Scenarios**:

1. **Given** a registry of N domains, **When** a full cycle completes, **Then**
   the record contains one observation per domain for that cycle and no domain
   is silently absent.
2. **Given** a completed cycle, **When** a reader inspects only the stored
   record, **Then** they can determine which domains were covered, which were
   not, and which cycle each observation belongs to.
3. **Given** a cycle that was interrupted partway, **When** a reader inspects the
   record, **Then** the incomplete coverage is visible as incomplete rather than
   indistinguishable from a complete cycle.

---

### User Story 2 - A domain with no website is not reported as a broken website (Priority: P1)

1,807 of the 16,535 registered domains — one in nine — publish no web address at
all. They exist for email, for a redirect, for internal use, or are simply held.
A reader, a journalist, or the jurisdiction itself must be able to tell "this
government never published a website here" apart from "this government's website
is down".

Getting this wrong publishes an accusation, and does so at a rate of 1,807 per
cycle. The survey shows the burden is spread across all of government rather
than falling on small jurisdictions in particular — cities have the lowest rate
of any large category — but 863 of those false claims would still land on cities,
simply because there are so many of them. Volume, not bias, is the danger, and
Principle IV exists precisely for this.

**Why this priority**: This is the largest correctness risk in the feature, and
it is a reputational risk to real jurisdictions rather than a technical one. A
census that cannot make this distinction should not be published at all.

**Independent Test**: Point the checker at fixtures covering each case — a name
that does not resolve, a name that resolves only at `www`, a name with mail
service and no web address, a name that resolves but refuses connections, a
redirect to a non-`.gov` host, and a working site that is currently down — and
confirm each lands in a distinguishable recorded state.

**Acceptance Scenarios**:

1. **Given** a domain that publishes no web address, **When** it is checked,
   **Then** the record states that no website was found, distinguishably from a
   site that answered with an error.
2. **Given** a domain with mail service and no web address, **When** it is
   checked, **Then** the record shows it as publishing no website rather than as
   a failure.
3. **Given** a domain reachable only at `www`, **When** it is checked, **Then**
   it is recorded as a working site — not as absent because the apex had no
   address.
4. **Given** a domain that resolves but refuses connections, **When** it is
   checked, **Then** the record distinguishes that from a domain that publishes
   no address at all.
5. **Given** our own resolution failed, **When** the observation is written,
   **Then** the record attributes the failure to us rather than asserting the
   domain publishes nothing.
6. **Given** a domain that redirects to a different organisation's site, **When**
   it is checked, **Then** the record preserves where it landed so a reader can
   see the domain is a redirect rather than a site.
7. **Given** a working site that is temporarily down, **When** it is checked,
   **Then** it is recorded as a failing site — not as an absent one.
8. **Given** a better presence rule is written later, **When** it is applied to
   observations already stored, **Then** it yields a revised reading without any
   target being checked again.

---

### User Story 3 - Outage detection survives the change (Priority: P2)

`001`'s hourly cadence exists for a stated statistical reason: roughly 720
readings per site per month make a 30-minute interruption likely to be caught
and a 2-hour one likely to be caught repeatedly. Weekly sampling cannot see
those events at all.

A reader who cares about reliability of the sites the public actually uses needs
that signal preserved, even as coverage widens to domains that will be sampled
far less often.

**Why this priority**: Valuable and explicitly required, but the census (P1)
delivers the feature's purpose on its own. This protects an existing capability
rather than adding a new one.

**Independent Test**: Confirm that hot-tier members continue to produce
hourly-cadence observations while broad-tier members produce cycle-cadence ones,
and that a reader can tell which tier produced any given observation.

**Acceptance Scenarios**:

1. **Given** the two tiers are running, **When** a reader inspects any
   observation, **Then** they can tell which tier produced it.
2. **Given** a domain in both tiers, **When** observations accumulate, **Then**
   both cadences are present and neither is suppressed by the other.
3. **Given** measured traffic rankings change, **When** hot-tier membership is
   next rebuilt, **Then** membership follows the new rankings without manual
   editing.

---

### User Story 4 - Aggregate figures are not misread across tiers (Priority: P2)

The broad tier will have a far higher failure and non-existence rate than 58
curated federal sites — not because government websites got worse, but because
the population is different. Anyone computing an ecosystem-level figure from the
record must be able to see that the two tiers are different populations.

**Why this priority**: The misreading is near-certain if the record does not
guard against it, and a wrong headline figure is hard to retract. But it is a
property of how the record is *read*, and the record can carry what is needed
without blocking the census itself.

**Independent Test**: Compute a naive combined availability figure across both
tiers and confirm the record contains what is needed to detect that the figure
mixes populations.

**Acceptance Scenarios**:

1. **Given** observations from both tiers, **When** a reader aggregates them,
   **Then** the tier is available as a dimension so per-tier figures can be
   produced.
2. **Given** a published ecosystem figure, **When** a reader inspects its basis,
   **Then** the population it covers is stated rather than implied.

### Edge Cases

- **The registry changes between cycles.** Domains are added and removed
  continuously. A domain added mid-cycle must not silently skip a full cycle,
  and a removed domain must stop being checked without its history becoming
  unreadable.
- **A cycle's slice is empty or the registry is unreachable.** The cycle must
  fail visibly rather than record a successful sweep of nothing.
- **A domain appears in both tiers.** Its observations must remain
  distinguishable and must not be double-counted in a per-domain figure.
- **The registry lists a domain whose website is on a non-`.gov` host.** The
  record must show where the check actually landed.
- **A domain resolves but serves an unrelated holding page from the registrar.**
  This is closer to "no website" than to "a working site", and the record must
  not assert the jurisdiction publishes that content.
- **A jurisdiction asks to be excluded.** The constitution requires a removal
  request be honored without argument; at census scale this must be possible
  without hand-editing 16,535 entries.
- **Two runs of different tiers overlap in time.** They share the politeness
  budget for any host they have in common, and must not race the record.
- **A monthly record file rolls over mid-cycle.** Coverage accounting must not
  break at the file boundary.

## Requirements *(mandatory)*

### Functional Requirements

**The census frame**

- **FR-101**: The target frame MUST be the full published `.gov` registry, not a
  selection from it. Every registered domain is in scope by virtue of being
  registered.
- **FR-102**: Inclusion MUST NOT require per-target justifying evidence. The
  frame itself is the justification. Being exhaustive is a stronger guarantee
  against cherry-picking than per-target traffic evidence was, because there is
  nothing left to choose.
- **FR-103**: Traffic evidence MUST become optional enrichment on a target rather
  than a precondition of inclusion. Where present it MUST retain its existing
  meaning and remain the basis of hot-tier selection.
- **FR-104**: The registry snapshot a cycle used MUST be recoverable, so a reader
  can tell whether a domain was absent from the record because it was not
  checked or because it was not registered at the time.
- **FR-105**: A domain MUST be removable from checking on request, taking effect
  on the next cycle, without editing the census frame by hand and without making
  its existing history unreadable.

**Tiers**

- **FR-106**: The system MUST support more than one tier of target, each with its
  own cadence, drawing on one shared politeness budget.
- **FR-107**: Hot-tier membership MUST be derived automatically from published
  measured-traffic rankings, so it tracks real usage rather than freezing an
  editorial choice.
- **FR-108**: Every observation MUST record which tier produced it.
- **FR-109**: Observations MUST remain comparable across tiers: the same record
  shape, the same measurement, differing only in what the recorded method states.
- **FR-110**: A domain present in both tiers MUST produce observations under both
  cadences, and those observations MUST be separable by tier.

**Cadence and coverage**

- **FR-111**: The broad tier MUST be checked as a rolling slice, covering the
  whole frame over a cycle of about a week while each run handles roughly one
  seventh of it.
- **FR-112**: Slice assignment MUST be deterministic and stable per domain, so a
  domain keeps its position across cycles and coverage is provable rather than
  probabilistic.
- **FR-113**: Slice assignment MUST degrade gracefully as the registry gains and
  loses domains, without reshuffling existing assignments so heavily that
  coverage gaps or double-coverage result.
- **FR-114**: A reader MUST be able to determine, from the stored record alone,
  whether a cycle covered the whole frame, and which domains it did not reach.
- **FR-115**: An interrupted or partial cycle MUST be distinguishable in the
  record from a complete one.

**Distinguishing absence from failure**

The measured baseline is in *Measured evidence* below: **1,807 domains (10.9%)
publish no web address at all**. Without these requirements the census would
assert, every cycle, that all 1,807 have broken websites.

- **FR-116**: The record MUST distinguish *no public website exists at this
  domain* from *a website exists and did not respond successfully*. These are
  different facts about a jurisdiction and MUST NOT share a recorded state.
- **FR-117**: `outcome` MUST remain a statement of what happened at the protocol
  level and nothing more. Whether a website appears to exist is a reading of
  those facts, not one of them, and MUST NOT be encoded as an outcome value.

  This is the difference between recording that a request returned 200 and
  asserting that the 200 was a real site rather than a holding page. The first is
  an observation; the second is a verdict (Principle IV).
- **FR-118**: A separate field MUST carry that reading — whether a public website
  appears to exist at the domain — alongside the version of the rule that
  produced it.
- **FR-119**: That reading MUST be derivable again from stored facts, so a better
  rule can be applied to observations already collected without re-checking any
  target. Changing the rule MUST NOT invalidate history. This is the same
  guarantee FR-001c already makes for property mapping.
- **FR-120**: A name-resolution result MUST be established for every census
  target and recorded with the observation: whether the domain publishes a web
  address, publishes mail service only, publishes nothing, or does not exist.

  Resolution costs the target nothing — queries go to resolvers, never to the
  jurisdiction's server — so this converts the largest category from inference
  into evidence at no cost under Principle I.
- **FR-121**: Resolution failures that may be ours MUST NOT be recorded as facts
  about the jurisdiction. Where our own resolution failed, the record MUST say
  so, distinctly from a domain that answered authoritatively that it publishes
  nothing.

  The survey measured 2.3% in this category. Some of those are genuinely the
  domain's own broken nameservers rather than our failure, and the two are not
  reliably separable from a single vantage — so the conservative reading is
  required, and the record must not claim more than it knows.
- **FR-122**: Where a domain redirects away from itself, the record MUST preserve
  where the request landed, so a redirect-only domain is visible as such.
- **FR-123**: The system MUST NOT infer or assert that a jurisdiction has a
  broken website from the absence of a website. Absence is recorded as absence
  (Principle V).
- **FR-124**: Detecting a registrar parking page is explicitly NOT a goal.
  Distinguishing a held domain's placeholder from a thin real site requires
  inspecting page content, and this project does not retain page bodies. A
  requirement that cannot be met without breaking that rule is not adopted
  quietly — it is declined here in the open.
- **FR-125**: Where the record holds enough history, a domain's presence status
  MUST be strengthened by that history rather than resting on a single cycle: a
  domain that has never once resolved differs from one that resolved last week
  and does not today. A first observation MUST still yield a usable reading
  without waiting for history to accumulate.

**Canonical URL**

The measured baseline: **an apex-only rule would misreport 348 domains (2.1%)
that answer only at `www`; a `www`-only rule would misreport 567 (3.4%) that
answer only at the apex.** Neither form alone is sufficient, which settles the
rule below.

- **FR-126**: The URL checked for a census domain MUST be derived by a single
  stated, uniform rule, since a census supplies only a domain name and no curated
  URL.
- **FR-127**: The rule MUST try both the apex and the `www` form before
  concluding that no website exists. Trying only one would misreport hundreds of
  domains as absent, and would do so unevenly across jurisdictions — the
  `www`-only rate ranges from 0.9% to 41.7% depending on the registry type.
- **FR-128**: The rule MUST cover scheme, the order the two forms are tried, and
  how a redirect between them is treated.
- **FR-129**: The derived URL and the rule that produced it MUST be recoverable
  from the observation, so a reader knows what was actually requested rather than
  inferring it (Principle V).
- **FR-130**: Deriving a URL MUST NOT cost the target more than an ordinary
  visitor's first visit. Where resolution already shows only one of the two forms
  has an address, the other MUST NOT be requested.

**Politeness at census scale**

- **FR-131**: The per-host and per-registrable-domain minimum intervals, the
  request timeout, and the bound on hosts in flight MUST continue to be enforced
  inside the checker, unchanged in kind by the increase in scale.
- **FR-132**: Hosts in flight MUST remain bounded at the order of a dozen. This
  is a stated constraint of this feature, not a tuning parameter.
- **FR-133**: Raising the bound in FR-132 MUST remain blocked until the
  shared-hosting gap (see *Known gap*) is closed. A future change that raises
  concurrency without addressing that gap is a Principle I violation, and the
  spec records this so the question cannot be bypassed silently.
- **FR-134**: `robots.txt` MUST continue to be honored per target, and every
  request MUST continue to identify itself (Principle II, Principle III).
- **FR-135**: A run MUST NOT retry harder against a domain that has already
  failed. A failing census entry is data (Principle IV).

**The record**

- **FR-136**: Existing observations MUST remain valid and MUST NOT require
  re-collection or rewriting.
- **FR-137**: The record MUST remain append-only, committed, and checkable by the
  existing verification gate.
- **FR-138**: Verification MUST continue to prove the spacing guarantee from
  stored timestamps alone at census scale.
- **FR-139**: The record MUST carry enough per-observation context that a
  per-tier figure can be computed without joining against a target list that may
  since have changed.

### Requirements changed in `001`

These MUST be revised in `001`'s spec as part of this change, so the two specs
never describe different intended behavior:

- **FR-001a** — selection by measured traffic ceases to govern inclusion. It
  becomes the hot-tier selector only. The traceability guarantee it provided is
  replaced by the stronger guarantee of an exhaustive frame (FR-102).
- **FR-009** — "at least hourly per target" becomes per-tier. The hourly cadence
  and its statistical rationale survive for the hot tier; the broad tier is
  explicitly not an outage-detection instrument.

### Key Entities

- **Registry snapshot**: The published `.gov` registry as of a point in time.
  The frame from which the census is drawn, and the evidence for what existed
  when.
- **Target**: A checkable domain, carrying its jurisdiction, its organisation,
  its tier membership, its slice assignment, and optionally traffic evidence.
- **Tier**: A named cadence and membership rule. Hot (hourly, traffic-selected)
  and broad (rolling weekly cycle, exhaustive) today; the concept must admit more.
- **Cycle**: One complete pass of the broad tier over the whole frame, against
  which coverage is asserted and checked.
- **Slice**: The portion of the frame checked in a single run, and a domain's
  stable assignment to one.
- **Observation**: Unchanged from `001`, plus the tier that produced it and the
  canonical-URL rule that produced its request.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-101**: Every domain in the registry frame appears in the record at least
  once per cycle, with zero domains silently missing.
- **SC-102**: A reader given only the stored record can state how many domains a
  cycle covered and name the ones it did not, without re-running any check.
- **SC-103**: Given only the stored record, a domain with no public website is
  distinguishable from a domain whose website failed, for every recorded state.
  Measured against the survey baseline, the ~1,807 domains that publish no web
  address produce zero claims of a broken website.
- **SC-103a**: A domain reachable only at `www` is recorded as reachable. On the
  survey baseline that is ~348 domains that an apex-only rule would have lost,
  and the residual disagreement between jurisdiction types is not attributable to
  the URL rule.
- **SC-103b**: The presence reading can be recomputed for observations already
  stored, and a change to the rule alters no stored fact and requires no target
  to be checked again.
- **SC-104**: No two requests to the same host are closer together than the
  configured minimum, provable from stored timestamps alone — holding at census
  scale exactly as it holds today.
- **SC-105**: A single run completes within the hosted runner's per-job limit,
  with the bound on hosts in flight held at the order of a dozen.
- **SC-106**: The annual growth of the committed record stays within the same
  order of magnitude as the current record, and the repository remains usable
  with an ordinary clone.
- **SC-107**: A per-tier availability figure can be computed from the record
  without consulting a target list, and a combined figure that mixes tiers is
  detectable as such.
- **SC-108**: Hot-tier membership updates from published rankings with no manual
  editing, and a membership change is traceable to the ranking that caused it.
- **SC-109**: A removal request stops all traffic to the domain on the next
  cycle, and its history remains readable.
- **SC-110**: The test suite continues to run with no network access to any
  external host, and no test contacts a real government site.

## Known gap — shared hosting *(carried deliberately)*

`001`'s politeness limits key on hostname and registrable domain. FR-003a added
the domain-level limit precisely because many hostnames under one domain share a
backend. At census scale that same hole reopens one level up: thousands of small
city and county `.gov` sites are hosted behind a handful of shared vendors, so
many *distinct registrable domains* can resolve to a single backend. Neither
existing limit can see that.

Principle I is NON-NEGOTIABLE, so this gap constrains what is safe to build now.
It is recorded here rather than omitted, and the project owner has decided to
defer closing it to follow-up work.

**Interim mitigation, binding on this feature**: hosts in flight stay at the
order of a dozen (FR-132), which bounds aggregate pressure on any single shared
backend regardless of how many distinct domains route to it. The rolling-slice
cadence is what makes this affordable — a slice of roughly 2,362 domains
completes in about an hour at that concurrency, well inside the per-job limit —
so there is no throughput pressure to raise it.

**What closing the gap would require**: a rate-limit key that reflects the
backend actually being contacted rather than the name used to reach it, so that
domains sharing infrastructure share a budget. That is deliberately not specified
here.

FR-133 exists so that a future contributor who wants a faster sweep has to
confront this first.

## Assumptions

- The CISA `.gov` registry remains published in its current form and remains the
  authoritative frame for US `.gov` domains. It was confirmed reachable and
  well-formed on 2026-08-21; `probe-data-sources` exists to re-confirm this when
  it eventually moves.
- `analytics.usa.gov` remains published and continues to rank federal hostnames
  by measured visits. It covers Digital Analytics Program participants only, so
  hot-tier membership is federal in practice — state and local sites have no
  equivalent public traffic source, and this is a known limit of the hot tier
  rather than a defect.
- A weekly cycle is an appropriate resolution for the broad tier's purpose, which
  is coverage and change over months, not outage detection.
- Registry domain types are usable as jurisdiction classification without further
  normalisation. The survey observed sixteen distinct values, more than the six
  first assumed: the Federal branches are separate (`Federal - Executive`,
  `- Judicial`, `- Legislative`, plus a bare `Federal`), `School district` and
  `Special district` exist alongside `City` and `County`, and five types carry an
  `- Election` variant. Any grouping for presentation must therefore be stated
  rather than inferred from the type string.
- One reading per broad-tier check is sufficient. Repeated samples seconds apart
  measure the same cache and would multiply census traffic for no statistical
  gain — the same reasoning `001` already applies.
- Checks continue to run only in GitHub Actions. The repository is public, so
  standard-runner minutes are free and the binding compute limit is the
  per-job time cap rather than a minutes budget.
- The existing observation record shape is adequate for census-scale data and
  needs additive fields only.
