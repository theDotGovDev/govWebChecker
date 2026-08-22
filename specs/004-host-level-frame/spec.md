# Feature Specification: a host-level frame

**Feature Branch**: `004-host-level-frame`

**Created**: 2026-08-22

**Status**: Draft — D1 decided; one measurement gates planning

**Input**: Use all available information to discover sites and domains, then
determine which are valid and reachable by probing.

---

## The problem

`003` checks 16,535 registered `.gov` domains at their apex and `www` forms. That
misses most of the government web, because a registered domain is an allocation,
not a website.

The project already knows this and contradicts itself about it. The hot tier
checks 58 **hosts**, of which 18 are subdomains other than `www`:

| Host | The census would file it under |
| --- | --- |
| `pubmed.ncbi.nlm.nih.gov` | `nih.gov` |
| `forecast.weather.gov` | `weather.gov` |
| `travel.state.gov` | `state.gov` |
| `tools.usps.com` | not in the frame at all |

These are not variants of one site. They are separate services run by different
teams for different readers, and `tools.usps.com` alone drew 271 million visits in
thirty days — more than any registered `.gov` apex.

`002` D3 already made the *listing* unit a site, so the presentation layer is
ready. Nothing collects the sites.

---

## Measured evidence

All figures from `probe-data-sources.yml`, run 32598988975, 2026-08-22. Reading
published data files only; no traffic to any measurement target.

### A published host-level source exists, and it is federal-only

`GSA/federal-website-index` publishes a target URL list:

| | |
| --- | ---: |
| Rows / distinct hosts | 29,634 |
| Distinct registered domains | 1,398 |
| **Hosts per registered domain** | **21.2** |
| By TLD | `.gov` 26,560 · `.mil` 2,854 · `.com` 202 · `.edu` 18 |
| By branch | Executive 28,158 · Legislative 1,055 · Judicial 415 |

It carries `agency`, `bureau`, `branch`, `pageviews`, `visits`, and 30-odd
`source_list_*` columns naming which published list each host came from — so a
host's provenance is stated rather than asserted by us.

**Its 1,398 registered domains are the federal ones.** The census frame is 16,535,
of which roughly 15,200 are cities, counties, school districts and special
districts. So this source closes the subdomain gap for about **8% of the frame and
none of local government**.

### No source was found for local government subdomains

| Candidate | Result |
| --- | --- |
| `GSA/federal-website-index` | 200 — federal only |
| `analytics.usa.gov/data/live/sites.csv` | 200 — 10,000 traffic-ranked hosts, also federal |
| `api.gsa.gov` site scanning | 403 — needs an API key |
| `crt.sh` certificate transparency | **502 on eight of eight attempts** across three runs |
| **`api.certspotter.com`** (free tier) | **200 — answers for both federal and municipal domains** |

### Certificate transparency: the source works, and shows both faces of the problem

`certspotter` answered where `crt.sh` did not. Two samples, and they make the case
for the feature and for its guardrails simultaneously.

**`alamosa.gov`** — 7 certificate entries, **3 distinct names**:

```
alamosa.gov        www.alamosa.gov        help.alamosa.gov
```

`help.alamosa.gov` is the whole argument in one line. It is a real service of a
small Colorado city that the domain-level census cannot see and never would have,
and finding it cost the city nothing.

**`nih.gov`** — first page only, 182 distinct names, including:

```
3d.nih.gov
ai-puppetprd1.niaid.nih.gov              ← configuration-management infrastructure
api.strap.trials-dev.nci.nih.gov         ← development
api.strap.trials-stage.nci.nih.gov       ← staging
api.strap.trials-staging.nci.nih.gov     ← staging, again
api.strap.trials-prod.nci.nih.gov
```

This is the noise, and it is not hypothetical either. A Puppet host and three
non-production environments are not public websites, and a list of them is not
something this project should publish about NIH under any framing. FR-440 and
FR-443 exist for exactly these rows: they are counted, validated, and — when they
fail to answer publicly or demand credentials — dropped, never listed.

**Two caveats on the numbers.** `nih.gov` returned exactly 100 entries, which is
the free tier's page size, so 182 names is a floor rather than a count — GSA's
index puts `nih.gov` at 1,995 hosts. Full discovery therefore needs pagination and
must respect the tier's rate limits, which is a design constraint on the discovery
job rather than a blocker.

Certificate transparency is the route that reaches a small town's subdomains, and
`certspotter` supplies it. It remains a different kind of source from GSA's index
— unofficial, and full of hosts that never served a public website — which is what
D1's measure-don't-judge answer and the FR-440 guardrails are for.

`crt.sh` is not that source. Eight of eight attempts returned 502, and one
volunteer-run service is a poor foundation regardless of what its yield would have
been.

### The cost is structural, and the binding constraint is not the one expected

Measured throughput from the completed census slice (run 32579108046): **20.5
requests per minute** with 12 workers, all politeness limits in force.

| | |
| --- | ---: |
| One full sweep of 26,560 federal `.gov` hosts | **21.6 hours** |
| Spread over 7 daily slices | 185 min/slice — **over the 120-minute cap** |
| Spread over 14 | 92 min/slice |

But the per-host interval is not what binds. The **per-registrable-domain** limit
is 5 seconds, and federal hosts are extraordinarily concentrated:

| Domain | Hosts | Domain-budget cost if all in one slice |
| --- | ---: | ---: |
| `nasa.gov` | 2,203 | **184 min** |
| `nih.gov` | 1,995 | 166 min |
| `noaa.gov` | 1,184 | 99 min |

`nasa.gov` alone would exceed the job cap, and no amount of concurrency can help:
the limit is *per domain*, so its hosts are serialised against each other by
design. This is Principle III working correctly, and it means a host-level frame
**cannot slice by registered domain**. Slicing by host spreads `nasa.gov` across
every slice and brings it to 26 minutes of domain budget per slice, which fits.

That is the central design finding, and it was not obvious before the numbers.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — The sites people actually use are checked (Priority: P1)

The frame includes the hosts that serve the public, not only the names that were
registered. `pubmed.ncbi.nlm.nih.gov` is checked because it is a website, not
skipped because it is not a registration.

**Why this priority**: It is the feature. Everything else qualifies it.

**Independent Test**: Assert that hosts named in the published index appear in the
frame with their provenance, and that a host is checked independently of its
registered domain's apex.

**Acceptance Scenarios**:

1. **Given** the published index names a host, **When** the frame is built,
   **Then** the host is a frame entry in its own right, carrying which source list
   named it.
2. **Given** a registered domain with many hosts, **When** the frame is built,
   **Then** each host is its own entry and none stands in for another.
3. **Given** a host in the index that is not a `.gov` name, **When** the frame is
   built, **Then** it is excluded and the exclusion is counted and stated.

---

### User Story 2 — Adding hosts does not increase pressure on anyone (Priority: P1)

Twenty times more targets does not mean twenty times more traffic to any operator.
Every existing politeness limit holds, and the slicing is chosen so that no
registered domain's hosts pile up.

**Why this priority**: Equal to US1 and non-negotiable. This feature multiplies
the target count by twenty; if it did that without a structural answer to
concentration, it would be exactly the growth Principle I prohibits.

**Independent Test**: Run a slice against fixtures and assert per-host,
per-domain and per-address spacing all hold — the same guarantees `verify` already
proves, at twenty times the frame size.

**Acceptance Scenarios**:

1. **Given** a domain with 2,203 hosts, **When** slices are assigned, **Then**
   its hosts are distributed across slices rather than concentrated in one.
2. **Given** any slice, **When** it runs, **Then** no two requests to the same
   registrable domain are closer than the domain interval.
3. **Given** the frame grew twentyfold, **When** a slice runs, **Then** it
   completes within the job cap with margin, or the cycle is lengthened until it
   does.
4. **Given** any host, **When** it is checked, **Then** it receives no more
   traffic than it did as part of a domain-level frame.

---

### User Story 3 — Federal depth is not read as local failure (Priority: P1)

A reader sees that federal domains are covered to a depth of many hosts each and
local domains to a depth of one, and understands that as a difference in **what we
can see**, not a difference in what exists.

**Why this priority**: This is the feature's own absence-versus-failure risk, and
it is severe. After this feature, `nih.gov` has 1,995 sites listed and
`alamosa.gov` has one. Nothing about that comparison is a fact about Alamosa.

**Independent Test**: Assert every coverage figure states its depth basis, and
that no view compares a federal host count against a local one without saying why
they differ.

**Acceptance Scenarios**:

1. **Given** a local domain with one known host, **When** it is shown, **Then**
   the site says we know of one site here and do not have a source for others.
2. **Given** federal and local coverage side by side, **When** compared, **Then**
   the difference in source is stated wherever the comparison appears.
3. **Given** any count of "government websites", **When** published, **Then** it
   names the frame it counts within and does not imply completeness.

---

### Edge Cases

- **A host in the index that no longer resolves.** Recorded as resolution says,
  exactly as `003` already does. Absence is not failure.
- **A host that redirects to another host in the frame.** Both are checked; the
  redirect is recorded. They are two entries, and the second is not skipped
  because the first pointed at it.
- **The index disappears or changes shape.** The frame builder refuses rather than
  silently shrinking, matching `003`'s existing size guard.
- **A host appears in the index but is a duplicate under a different scheme or
  trailing form.** Normalised to one entry, with the normalisation stated.
- **An operator asks for a host to be removed.** Honored per the constitution;
  removing a host does not remove its registered domain or its siblings.

---

## Requirements *(mandatory)*

### The frame

- **FR-401**: The frame MUST be keyed on host. A registered domain is a grouping
  attribute, never a frame entry standing in for the hosts beneath it.
- **FR-402**: Every frame entry MUST carry which published source named it, so a
  reader can tell a host we were told about from a host we inferred.
- **FR-403**: The frame MUST include only `.gov` hosts. `.mil`, `.com` and `.edu`
  entries in the source are excluded, and the count excluded MUST be stated —
  3,074 of 29,634 at the time of writing.
- **FR-404**: The frame builder MUST refuse to write a frame that is empty or
  materially smaller than its predecessor, matching `003`'s existing guard.
- **FR-405**: A host's presence in the frame MUST NOT be taken as evidence that a
  website exists there. That remains a question resolution and checking answer.

### Politeness at twenty times the scale

- **FR-410**: Slice assignment MUST be a pure function of the **host**, so that a
  registered domain's hosts distribute across slices rather than concentrating in
  one. Slicing by registered domain is prohibited: `nasa.gov`'s 2,203 hosts would
  require 184 minutes of per-domain budget in a single slice, exceeding the job
  cap on one domain alone.
- **FR-411**: Every existing politeness limit MUST hold unchanged. This feature
  adds targets; it MUST NOT relax a limit to afford them.
- **FR-412**: The cycle length MUST be chosen so a slice completes within the job
  cap with margin. If the frame outgrows the cycle, the cycle lengthens — the
  limits do not loosen and the concurrency does not rise.
- **FR-413**: A slice MUST NOT be published if it violated a guarantee, and MUST
  NOT lose its readings when rejected — `003`'s artifact-first behaviour applies
  unchanged.

### Discovery, then validation — two different things

- **FR-430**: Discovery MUST draw on every available published source. A name
  appearing in any of them makes it a **candidate**, not a frame entry.
- **FR-431**: Validation MUST be staged so the cheap step runs first:
  1. **Resolution** — does the name publish a web address? This goes to a
     resolver, never to the jurisdiction's server, so it costs the target nothing
     and is how the bulk of a certificate-transparency candidate set is settled.
  2. **One request** — only for names that passed resolution, and only ever one,
     under every existing politeness limit.
  A candidate that fails at stage 1 MUST NOT reach stage 2.
- **FR-432**: A candidate's outcome MUST be recorded with the reason it was
  rejected, so the frame's exclusions are inspectable rather than a silent filter.
- **FR-433**: A candidate MUST NOT be retried to establish validity. One
  resolution and at most one request; a name that did not answer is recorded as
  not having answered and revisited on the next cycle, not immediately.
- **FR-434**: Validity MUST be recorded as an observation with its timestamp and
  method, never as a permanent property of the name. A host that stops answering
  has changed, and the record shows when.
- **FR-435**: The frame MUST carry every source that named a host, not just the
  first. A host named by GSA's index *and* found in certificate transparency is
  better attested than one found only in the latter, and FR-402's provenance is
  what lets a reader see that.
- **FR-436**: The candidate count MUST be measured before any target is probed.
  The cycle length depends on it, and this project has twice been wrong about a
  duration it projected rather than measured.

### Discovery must not become reconnaissance

Certificate transparency lists names from certificates, not websites. It includes
internal hostnames, decommissioned services, wildcards, and names that never
served the public. That creates two risks this feature must foreclose, and they
are the reason D1 needs guardrails rather than just enthusiasm.

- **FR-440**: A candidate that did not validate MUST NOT be published. Discovered
  names are counted, never listed. Publishing an inventory of internal-looking
  hostnames we found in certificates would be reconnaissance output, whatever our
  intent — and it would be this project handing an attacker a map of a
  jurisdiction it was supposed to be helping.
- **FR-441**: The frame MUST contain only names that resolved publicly and were
  reachable. A name's presence in the published frame is therefore evidence it is
  a public surface, which is what Principle II requires.
- **FR-442**: Validation traffic MUST be indistinguishable from ordinary checking
  traffic: same limits, same User-Agent naming the project and how to stop it.
  There MUST be no faster or heavier path for validation, because "we were only
  finding out what exists" is precisely what an operator cannot tell from
  scanning.
- **FR-443**: A host that returns an authentication challenge MUST be dropped from
  the frame rather than recorded as a failing website. Per the constitution, a
  target that begins requiring credentials is dropped rather than worked around,
  and a candidate that never was public is the same case arriving earlier.

### Honesty about depth

- **FR-420**: Every coverage figure MUST state the frame it counts within and the
  source of that frame's depth.
- **FR-421**: A domain covered to a depth of one host MUST be presented as one
  known site, not as a domain with one site.
- **FR-422**: No view may compare host counts across domains whose depth came from
  different sources without stating that the sources differ.
- **FR-423**: The record MUST make a host's frame source recoverable, so a later
  reader can tell federal depth from local depth without holding this spec.

### Key Entities

- **Host entry** — one host, its registered domain, its source list, and its
  slice. The unit of the frame.
- **Depth** — how many hosts are known beneath a registered domain, and from which
  source. A property of our knowledge, not of the jurisdiction.

---

## Success Criteria *(mandatory)*

- **SC-401**: Every host named by the published index and ending in `.gov` is in
  the frame or excluded for a stated reason.
- **SC-402**: No registered domain's hosts are concentrated in one slice —
  checkable against `nasa.gov`, whose 2,203 hosts must appear in every slice.
- **SC-403**: Per-host, per-domain and per-address spacing hold at the enlarged
  frame size, proved by `verify` from the record exactly as they are today.
- **SC-404**: A slice completes within the job cap with at least 30 minutes of
  margin, measured on a real run rather than projected.
- **SC-405**: No published figure compares federal depth against local depth
  without stating that the sources differ.
- **SC-406**: A reader holding only the record can tell which frame sources named
  any given host, and how many independently did.
- **SC-407**: No name that failed validation appears anywhere in published output,
  the frame included — only counts of how many failed and why.
- **SC-408**: No candidate receives more than one resolution and one request per
  cycle, provable from the record by the same spacing checks `verify` already runs.
- **SC-409**: The candidate count is measured and published before the first
  validation sweep runs.

---

## Assumptions

- The published index remains published. It is a GSA repository, and `003`'s
  frame already depends on a CISA repository in the same way; `probe-data-sources`
  is how that dependence stays checkable.
- Every source is in scope for discovery (D1). Federal hosts have an attributable
  published index; local government hosts will come predominantly from certificate
  transparency, and the frame records that difference rather than hiding it.
- The existing checker needs no change. A host is a host; the census already
  resolves, pins and checks one. This feature changes the frame, not the check.
- `002` D3 already made the listing unit a site, so presentation absorbs this
  without rework.

---

## Dependencies

- `003` for the census machinery, slicing, resolution, presence and coverage.
- `002` D3 for the site-level listing unit.
- The census schedule is **disabled** pending a slice that fits with margin. This
  feature makes that constraint sharper rather than softer, and R8a (`003`
  research.md) is the outstanding lever.

---

## Decisions

### D1 — Discover from everything; establish validity by measurement, not judgement

**Decided**: every available source feeds discovery. Which candidates are real is
then settled by probing, not by us deciding which names look like websites.

This is a better answer than the draft's recommendation, and it dissolves the
objection that recommendation rested on. The worry about certificate transparency
was that its entries would need a judgement we would be *making* rather than
*citing*. But "does this name resolve, and does something answer at it" is not a
judgement — it is an observation, which is what this project produces. Principle
IV already governs it: the result is recorded as fact, and a name that answers
nothing is data rather than a verdict.

It does mean discovery and validation are two different things and must stay
separate. A candidate is a name someone published. A frame entry is a name we
established answers. Conflating them would publish a list of names we merely found
— which is the failure mode set out under *Discovery must not become
reconnaissance* below.

The staging in FR-430 to FR-434 is what makes this affordable and polite. DNS
answers most of the question at no cost to any target, so the expensive step runs
only against names already known to publish a web address.

**Domains are already solved.** CISA's registry is authoritative for `.gov`
registrations, so there is no discovery problem at the domain level — `003`'s frame
is complete by construction. The discovery problem is hosts, and that is what this
feature addresses.

---

## Open Questions

### Q1 — none blocking, but one measurement gates planning

How many candidates certificate transparency yields for `.gov` is unknown; the
probe returned 502 on its one attempt. The number decides the cycle length and
whether the pipeline is a week or a month, so FR-436 requires it be measured
before any target is probed. That is a task, not a decision.
