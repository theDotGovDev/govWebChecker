# Feature Specification: the quality dashboard

**Feature Branch**: `005-quality-dashboard`

**Created**: 2026-08-25

**Status**: Draft — D1 decided (captures permitted, constitution 2.0.0); Q2 open (tooling)

**Input**: The home page is a dashboard for all government websites. Collect
what a person actually needs to know — load time, mobile friendliness, 3G
behaviour — using industry-standard open-source tooling, and present it in terms
a novice understands, with power users clicking through to specifics.

---

## The problem

The site reports whether a server answered, and how fast it answered *us*. That
is a thin slice of "how is this website doing".

It also speaks in units nobody outside the trade knows. **"482 ms" tells a
resident of Alamosa nothing.** They do not know whether that is good, and the
page does not say. A number a reader cannot interpret is not information; it is
decoration that looks like information.

Meanwhile the questions people actually have — *does this work on my phone? how
long until I can read it? is it usable if I'm on a weak connection?* — are
answerable with standard tooling and are not being asked.

---

## Two things this feature must reconcile

### It must not become a scoreboard (D1 stands)

`002` D1 decided: per-dimension standings, no composite. That decision is not
reversed here, and the reconciliation matters.

**What D1 forbids**: one blended number per site — a grade, an index, a rank —
that merges speed and accessibility and security into a figure whose weighting
nobody can defend.

**What this feature adds instead**: several *named dimensions*, each rated on
its own published scale, in plain language. "Speed: typical. Mobile: passes.
Accessibility: 12 issues found." That is four honest readings, not one dishonest
one — the same shape PageSpeed Insights uses, and the same shape a nutrition
label uses.

A reader may of course form an overall impression. The site's job is to give
them the parts to do it with, not to do it for them and hide the weighting.

### It must not become load testing (Principle I, NON-NEGOTIABLE)

A deep quality check loads the page fully — HTML, CSS, JavaScript, images —
exactly as a browser does for a visitor. That is more bytes than the current
single request by an order of magnitude, and it is **still one visitor's worth
of traffic**, which is the line Principle I draws.

What is prohibited remains prohibited: no repeated loads to build a sample, no
concurrency against one host, no running it often enough to matter. One deep
check per site per cycle, scheduled, spaced by the same limiter.

---

## Measured constraints

Costs measured against this project's own throughput, not estimated:

| | Cost |
| --- | ---: |
| Current census slice — 2,310 domains, one request each | 40m38s |
| Lighthouse on the 58 hot-tier sites (4–8 workers) | **2–6 min** |
| Lighthouse on one 2,310-domain census slice | **1.2–4 hours** |

**Consequence, and it is the central design constraint**: deep quality checks
run on the hot tier daily and on a **rotating sample** of the wider census. The
full census stays shallow — resolution plus one request — because deep-checking
16,535 domains weekly is neither affordable nor, under Principle I, polite.

A rotating sample of ~200 census domains per day covers roughly 73,000 checks a
year: every registered domain gets a deep reading about four times a year. That
is a real answer for local government, stated as a sample rather than dressed as
a census.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — A novice reads a number and knows what it means (Priority: P1)

Someone with no technical background looks at any figure on the site and
understands whether it is good, without knowing what a millisecond is.

**Why this priority**: it is the whole complaint, it applies to data already
collected, and it needs no new tooling. A site whose numbers cannot be
interpreted is not a dashboard, it is a log.

**Independent test**: every quantity rendered on the site carries a
plain-language band; assert no raw unit appears without one.

**Acceptance Scenarios**:

1. **Given** a response time of 482 ms, **When** it is shown, **Then** the page
   says what that means in words — with the threshold that decides it, and where
   the threshold comes from.
2. **Given** a rating band, **When** a reader wants the number, **Then** the
   exact measurement and its method are one click away, never removed.
3. **Given** a figure with no comparable standard, **When** it is shown,
   **Then** it is shown without a band rather than given an invented one.

---

### User Story 2 — The home page is a dashboard for government websites (Priority: P1)

A visitor arriving cold sees the state of government's web presence at a glance:
the headline readings, what is getting better or worse, and where the problems
are — before any table.

**Why this priority**: equal to US1. The current page is organized correctly by
question (`002` D5) but presents its answers as prose and single bars. A
dashboard is scannable in seconds.

**Independent test**: the first screen of the page contains only visual,
interpreted summaries; the first table appears below the fold.

**Acceptance Scenarios**:

1. **Given** the home page, **When** it loads, **Then** the top carries a row of
   status tiles, each with a plain-language state and its trend.
2. **Given** any tile, **When** clicked, **Then** the reader reaches the detail
   behind it.
3. **Given** a dimension with no data yet, **When** shown, **Then** the tile says
   it is not measured yet — never a zero, never an empty space.

---

### User Story 3 — Deep quality metrics, from standard tooling (Priority: P2)

Each hourly-tier site carries the measurements people expect from a modern web
report: how long until the page is usable, whether it shifts around while
loading, whether it works on a phone, whether it is reachable on a weak
connection, and how it scores on accessibility.

**Why this priority**: it is the new data, and it depends on US1's translation
layer to be worth showing.

**Independent test**: a check produces the standard category scores and Core Web
Vitals for a fixture site, with the tool and preset recorded on every reading.

**Acceptance Scenarios**:

1. **Given** a deep check, **When** it runs, **Then** it records the standard
   category scores (performance, accessibility, best practices, SEO) and the
   Core Web Vitals, each with the tool version and preset that produced it.
2. **Given** the mobile preset, **When** results are published, **Then** the
   emulated device and network are named, because a speed reading means nothing
   without them.
3. **Given** a site that fails to load under the deep check, **When** recorded,
   **Then** it is a failed deep check — not a failed website, and not confused
   with the availability reading.
4. **Given** the tool's own version changes, **When** figures are compared over
   time, **Then** the version change is visible in the record, because scoring
   changes between versions.

---

### User Story 4 — Plain checks a resident can act on (Priority: P2)

A reader sees a short list of pass/fail checks in plain words — works on a
phone, loads in a reasonable time, encrypted, no obvious accessibility blockers
— rather than a wall of metrics.

**Why this priority**: this is the "checkboxes" ask, and it is the most
compressible form of the data. It depends on US3's collection.

**Independent test**: each check is derived from one stated threshold on one
recorded measurement, and the derivation is published.

**Acceptance Scenarios**:

1. **Given** a set of checks, **When** shown, **Then** each states what it
   tested, what threshold it used, and where that threshold came from.
2. **Given** a check that cannot be evaluated, **When** shown, **Then** it reads
   as not evaluated — never as failed.
3. **Given** a check derived from a versioned rule, **When** the rule changes,
   **Then** past readings are recomputable, exactly as `presence/1` is.

---

### User Story 5 — See the site as its visitors do (Priority: P3)

A reader sees what the page actually looks like on a phone, a tablet, and a
desktop.

**Why this priority**: the most persuasive evidence for "is this mobile
friendly" — and the one blocked on a constitutional amendment (Q1). It is P3
because everything above ships without it.

**Independent test**: for a fixture site, one image per device profile, each
labeled with the device and the moment captured.

**Acceptance Scenarios**:

1. **Given** a captured view, **When** published, **Then** the device profile,
   viewport, and capture time are stated with it.
2. **Given** a site that asked to be removed, **When** honored, **Then** its
   captures are deleted, not merely unlinked.
3. **Given** any capture, **When** stored, **Then** only the most recent per
   site per device is kept — this is evidence of a current state, not an
   archive of a site's history.

---

### Edge Cases

- **A site that blocks automated browsers.** Recorded as declining automation,
  the same stance the availability reading already takes — never as failure.
- **A deep check that times out.** A failed measurement, distinct from a slow
  site and from a down site.
- **A tool version bump mid-window.** Visible in the record; figures spanning it
  say so rather than comparing silently.
- **A site whose homepage is a redirect to a non-`.gov` host.** The final URL is
  recorded; the reading belongs to what was actually measured.
- **A page containing personal data at capture time** (an emergency notice, a
  public roster). The takedown route applies, and the capture-retention rule
  bounds exposure.

---

## Requirements *(mandatory)*

### Plain language (US1)

- **FR-301**: Every published quantity MUST carry a plain-language
  interpretation alongside it, or be published with none where no defensible
  threshold exists. A raw unit alone is not a permitted presentation.
- **FR-302**: Every interpretation MUST name the threshold that produced it and
  cite the published standard it comes from. An invented threshold is
  indistinguishable from an opinion.
- **FR-303**: The exact measurement and its full method MUST remain reachable
  from any interpretation — banding is an addition, never a replacement
  (Principle V).
- **FR-304**: Interpretation rules MUST be versioned and recomputable over
  stored readings, exactly as `presence/1` is (FR-119).

### Dashboard (US2)

- **FR-310**: The first screen MUST be visual and interpreted: status tiles with
  plain-language states and trend, no raw table.
- **FR-311**: Every tile MUST lead to the detail behind it.
- **FR-312**: A dimension with no readings MUST render as not-yet-measured, never
  as zero or absence of the tile (FR-204).

### Deep quality (US3)

- **FR-320**: Deep checks MUST use an industry-standard open-source tool at a
  standard preset, so a reading is comparable to what the same tool reports
  elsewhere. Comparability is the reason for the tool choice and MUST NOT be
  traded away by custom tuning.
- **FR-321**: Every deep reading MUST record the tool, its version, the preset,
  the emulated device, and the emulated network.
- **FR-322**: A deep check MUST generate no more traffic than one visitor's page
  load: one navigation, no repeat runs to build a sample, no concurrency against
  one host (Principle I).
- **FR-323**: Deep checks MUST be scoped to what is affordable and polite: the
  hourly tier plus a rotating sample of the census. The census tier MUST NOT be
  deep-checked in full.
- **FR-324**: A deep-check failure MUST be recorded as a failure of the check,
  distinct from the availability outcome and never merged into it.
- **FR-325**: The sample MUST be drawn so every census domain is reached in
  bounded time, and the coverage claim MUST state the sampling rate rather than
  implying a census.

### Plain checks (US4)

- **FR-330**: Each check MUST be a stated threshold over one recorded
  measurement, with the threshold and its source published beside the result.
- **FR-331**: A check MUST have three states — passes, does not pass, not
  evaluated — and MUST NOT collapse the third into the second (the
  absence-is-not-failure rule, applied to checks).
- **FR-332**: The site MUST NOT publish a single blended score, grade or rank
  across dimensions (`002` D1 stands). Per-dimension ratings are the permitted
  form.

### Captures (US5, gated on Q1)

- **FR-340**: A capture MUST record the device profile, viewport and capture
  time, and MUST be presented as one moment rather than as the site's condition.
- **FR-341**: Only the most recent capture per site per device MUST be retained.
  No capture history.
- **FR-342**: A removal request MUST delete captures, not merely unlink them.
- **FR-343**: Captures MUST be bounded to the sites deep-checked, never the full
  census.

---

## Success Criteria *(mandatory)*

- **SC-301**: No raw unit appears on the site without a plain-language reading or
  a stated reason there is none — checkable over the rendered output.
- **SC-302**: Every band and every check on the site traces to a published
  threshold with a citation.
- **SC-303**: A reader reaches the exact measurement behind any interpretation in
  one step.
- **SC-304**: The first screen contains no table.
- **SC-305**: Deep readings are reproducible: running the named tool at the named
  preset against the same URL yields comparable figures.
- **SC-306**: No published figure blends dimensions into one score.
- **SC-307**: Deep-check traffic per site per cycle equals one page load.
- **SC-308**: Every census domain receives a deep reading within the stated
  sampling period, and the site states the rate rather than implying coverage.

---

## Assumptions

- The record's shape absorbs this: deep readings are a new `dimension` in the
  existing per-dimension file layout (`data/<dimension>/YYYY-MM.jsonl`), which
  `001` FR-018b anticipated for exactly this reason.
- Availability collection is unchanged. Deep quality is a separate, slower
  cadence against a smaller frame, and no availability figure is affected.
- Thresholds come from published web-performance standards rather than from us.
- The site remains statically generated and self-hosted (`002` D4).

---

## Dependencies

- `002` for the Figure choke point, the presentation rules, and D1/D4/D5.
- `003` for the census frame the sample is drawn from.
- A browser-driving quality tool (Q2).

---

## Open Questions

### D1 — Captures are permitted, bounded (was Q1) — **DECIDED**

The prohibition traced to the project's **founding commit** — the constitution
has only ever had one version, and the screenshot clause was written at setup in
the same breath as the sentence anticipating *"accessibility, layout, and
technology findings"*. Its stated reasons: page content is *transient,
potentially large, and not ours to archive*.

**Owner's decision: the prohibition was a mistake.** Constitution amended to
**2.0.0**, narrowly — the real concerns survive as bounds rather than as a ban:

| Original concern | How 2.0.0 answers it |
| --- | --- |
| Transient | The argument *for* a dated capture, not against it — now stated that way |
| Potentially large | Survives as **latest-only, deep-checked pages only** (FR-341, FR-343) |
| Not ours to archive | Survives as public-surface-only, and **deletion** rather than unlinking on request (FR-342) |

The amendment also records what the prohibition cost: *"this site is unusable on
a phone"* is a claim a reader must take on trust, where a picture at a stated
viewport is one they can check — which is exactly what Principle V asks of every
figure this project publishes.

### Q2 — Which tool, and is the dependency acceptable?

The project has no runtime dependencies today, and `AGENTS.md` requires saying
why before adding one.

**Proposal: Lighthouse** (Google, open source, Apache-2.0, v13.4.1, ~19 MB).

| Why this one | |
| --- | --- |
| It *is* PageSpeed Insights | PSI runs Lighthouse. Using it means our readings are directly comparable to the tool agencies already run against themselves |
| Standard presets | Its mobile and desktop presets are the industry default, satisfying FR-320 without us inventing anything |
| Covers the ask in one tool | Load time, Core Web Vitals, mobile-friendliness, throttled-network behaviour, accessibility (bundles axe-core), best practices, SEO |
| It is a dev dependency | It runs in CI to produce the record; it ships in no published artifact and adds nothing to the site (`002` D4 untouched) |
| Chrome is already present | The runner and this environment both have it; no browser download is added |

**The honest cost**: it is a large dependency with a large transitive tree, and
its scoring changes between major versions — which is why FR-321 records the
version on every reading.

**On "3G" specifically**: Lighthouse's standard mobile preset throttles to
*Slow 4G*, having moved off 3G in v6. Using a non-standard 3G profile would
break the comparability that is the entire reason for choosing the tool. The
recommendation is to publish the standard preset and name it, rather than a
custom profile that matches no published benchmark.
