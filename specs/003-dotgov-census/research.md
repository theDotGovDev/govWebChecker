# Phase 0 research — a census of US `.gov` domains

**Feature**: `003-dotgov-census` | **Date**: 2026-08-22

Decisions the plan rests on, with what was rejected and why. Every figure here is
measured — from `survey-dns` run `32544034683` and `survey-hosting` run
`32548354070`, both DNS-only against the whole registry — rather than estimated.

---

## R1. Slice assignment: hash the domain, not its position

**Decision**: a domain's slice is `fnv1a(domain) % 7`, computed from the domain
name alone. A run covers the slice `floor(daysSinceEpoch) % 7`.

**Rationale**: FR-113 requires assignment to degrade gracefully as the registry
gains and loses domains. Hashing the *name* has the property outright: a domain's
slice never changes, no matter what else enters or leaves the registry. Nothing
reshuffles, so there is no cycle in which a domain is covered twice or missed.

The obvious alternative — position in the sorted registry, modulo seven — fails
exactly here. Inserting one domain near the top shifts roughly six sevenths of
the registry into a different slice, which within a single cycle produces both
double-coverage and gaps. The failure is silent and would show up as a coverage
figure that looks fine.

**Rejected**: random assignment stored in a file. It gives the same stability but
adds state to keep in sync with the registry, and the file becomes another thing
that can disagree with reality. A pure function of the domain cannot drift.

**Note on balance**: FNV-1a over 16,535 names gives slices within a few percent
of each other. Perfect balance is not required — slices are work units, not
statistical strata, and no figure is computed per slice.

---

## R2. Coverage: prove it from the record plus git

**Decision**: each observation carries `tier`, `cycle` and `slice`. Each run
summary carries the frame digest, the frame size, and how many domains the slice
held. The frame itself is a committed file, `targets/dotgov-frame.json`, refreshed
by a workflow that opens a pull request rather than committing.

**Rationale**: FR-114 and SC-102 require a reader to determine, from the stored
record alone, whether a cycle covered the whole frame and which domains it missed.
That needs two things: what was checked (the observations) and what *should* have
been checked (the frame). Committing the frame makes the second available, and git
history makes it available *as of any past moment* — which is precisely FR-104's
requirement that the snapshot a cycle used be recoverable, so a reader can tell
"not checked" from "not registered at the time".

Git is therefore the snapshot store, and no per-cycle copy of the registry is
committed. A 16,535-row snapshot per cycle would add tens of megabytes a year to
answer a question git already answers.

**Rejected**: recording only the upstream `cisagov/dotgov-data` commit SHA. It is
smaller, but it makes the frame depend on a third party continuing to serve old
commits, and the frame we use is not the raw registry — exclusions (R6) have been
applied. The reader would have to reconstruct our transformation to check our
coverage claim, which is the opposite of the guarantee.

**Interrupted cycles** (FR-115): a cycle is complete when all seven slices have
run summaries against the same frame digest. A missing slice is visible as a
missing summary, which is why the digest is on the summary rather than inferred.

---

## R3. Absence and failure are different fields

**Decision**: three additions to the observation, all optional so existing rows
stay valid (FR-136, FR-142):

- `resolution` — what DNS said: which forms have an address, and a status of
  `address` / `mail_only` / `no_service` / `nxdomain` / `resolver_error`.
- `presence` — the *reading*: `website` / `no_website` / `undetermined`, plus the
  version of the rule that produced it.
- `tier`, `cycle`, `slice`, `url_rule` — provenance.

`outcome` is untouched and stays a protocol fact (FR-117).

**Rationale**: the survey measured 1,807 domains (10.9%) publishing no web address
at all. Checked without modelling absence, the census would assert 1,807 broken
government websites every cycle. FR-116 requires the two be distinguishable, and
FR-117 forbids encoding the distinction as an outcome value, because whether a
website *exists* is a reading of the facts rather than one of them.

Splitting the reading into its own versioned field is what makes FR-119 true: the
reading is a pure function of stored facts (`resolution`, `outcome`,
`redirect_chain`, `status_code`), so a better rule applied later recomputes it
over history without re-checking a single target. This is the same guarantee
`001` FR-001c already makes for property mapping.

**`undetermined` is load-bearing.** FR-121 requires that failures which may be
ours are not written as facts about the jurisdiction. The survey measured 2.3% in
that category and noted the two are not reliably separable from one vantage, so a
resolver error yields `undetermined`, never `no_website`.

**Rejected**: a boolean `has_website`. It cannot express "we could not tell",
which is 2.3% of the frame, and a boolean forced into that gap is how absence gets
published as zero (Principle V).

---

## R4. Canonical URL: HTTPS, both forms, resolution decides which

**Decision**, stated in full because FR-128 requires the rule to cover scheme,
order, and redirect handling:

1. Scheme is `https`. There is no `http` fallback.
2. If resolution shows only one of the apex and `www` has an address, that form is
   used and the other is never requested (FR-130).
3. If both have an address, the apex is used.
4. Redirects are followed as `001` already follows them, and the chain is
   recorded, so an apex that redirects to `www` is visible as such (FR-122).

**Rationale for both forms**: measured — 348 domains (2.1%) answer only at `www`
and 567 (3.4%) only at the apex, so either single-form rule misreports hundreds as
absent. Worse, the `www`-only rate ranges from 0.9% for City Election domains to
41.7% for Federal Judicial, so a single-form rule would distort comparisons
between jurisdiction types rather than merely lose rows.

**Rationale for no `http` fallback**: an `https` failure on a government website
is a finding, not a measurement artefact to be worked around. Falling back would
mask exactly the transport problem this project exists to record, and it would
double the request count for every site where `https` is genuinely broken —
spending the target's resources to soften a true observation about it.

The cost of that choice is contained rather than ignored: a domain that resolves
but fails `https` at the transport level yields `presence: undetermined`, not
`no_website`. We record that we could not reach it over `https` and decline to
conclude anything about whether a website exists there. If a later measurement
shows `http`-only sites to be a material share of the registry, the rule is
versioned (`url_rule`) and the presence reading is recomputable, so that finding
can be acted on without invalidating anything already collected.

**Rejected**: `http` first, upgrading on redirect. It is what a 2010 browser did,
it measures the redirect rather than the site, and it sends unencrypted requests to
government infrastructure on our initiative.

---

## R5. Two tiers, one record, one budget

**Decision**: `tier` is a field on the observation, not a separate record. The hot
tier keeps `check.yml` and its hourly cadence over the traffic-selected targets;
the broad tier is a new daily `census.yml` over one slice. Both use the same
checker, the same limits and the same writer.

**Rationale**: FR-109 requires observations to remain comparable across tiers —
same shape, same measurement, differing only in what the recorded method states.
Separate records would make that a merge problem for every reader. FR-107 keeps
hot-tier membership derived from published rankings, which `build-targets` already
does.

**On the shared budget** (FR-106): the two tiers can overlap in time, and where
they share a host, a domain or a backend they must share its budget. They cannot,
because they are separate processes with separate limiters. This is a real
constraint and is handled by *scheduling* rather than by shared state: the census
runs at an hour the hourly check does not occupy. Recorded as a risk in the plan
rather than as a solved problem, because a scheduling convention is exactly the
kind of "polite by convention" the constitution warns against — it is acceptable
only because the concurrency bound already caps what either process can do, and
the record makes a violation visible after the fact through `verify`.

---

## R6. Removal is data, applied at frame-build time

**Decision**: `targets/excluded.json` — a list of domains with the date and the
reason, honored when the frame is built.

**Rationale**: the constitution requires a removal request be honored without
argument, and FR-105 requires it to take effect on the next cycle without hand
editing the frame and without making existing history unreadable. Filtering at
frame-build time gives all three: the domain leaves the frame, its observations
stay in the record, and the exclusion is reviewable as data with its reason
attached.

**Rejected**: an `active: false` flag on the frame entry, as `001` uses for
targets. At 16,535 entries the frame is generated rather than edited, so a
generated file cannot carry hand-made state — the next refresh would erase it.

---

## R7. Record volume

**Decision**: accept the growth; no compaction, no schema slimming.

**Measured**: the current record is 2,961 rows for ~19 days over 58 targets. The
census adds 16,535 rows per weekly cycle — about 860,000 rows a year, against the
hot tier's ~508,000 at hourly. Roughly double, which SC-106 permits ("the same
order of magnitude").

The new fields add roughly 80 bytes to a row that is already ~450. JSONL of this
shape packs well in git; the existing record is the evidence for that.

**Rejected**: dropping `method` from broad-tier rows to save space. It is required
on every row by Principle V, and a record whose rows carry their method only
sometimes is worse than a bigger one.

---

## R8. The redirect cost, and what to do about it

**Decision**: within a single check, redirect hops charge the **backend** limit
but not the **name**-keyed intervals. Hops to a host not yet contacted in this
check charge everything, as now.

**Rationale**: this is the open question carried out of the shared-hosting work,
and the census is where it becomes load-bearing. Measured on the 58-target hot
tier, putting every hop through the name-keyed intervals cost 125 seconds for 14
hops — a run of 335s against 210s before. Extrapolated to a slice of ~2,045
web-publishing domains, where an apex redirecting to `www` is among the commonest
shapes in the registry, the same rule would add on the order of an hour to a job
whose cap is one hour. That is not a tuning inconvenience; it makes the cycle
undeliverable.

The rule above is not a weakening dressed up as an optimisation, and the
distinction matters enough to state precisely. The per-host interval exists so
that two *independent readings* of one site are not taken closer together than an
ordinary visitor would reload a page. A redirect is not a second reading — it is
the same visit continuing, and an ordinary visitor follows it immediately. Waiting
15 seconds mid-chain models no real behaviour and protects nobody.

The backend limit answers a different question: how much aggregate pressure one
machine receives from unrelated parties. A redirect onto a vendor's shared host
*is* pressure on that machine, arriving from a domain that machine's other
customers know nothing about. So it must charge, and it continues to.

**What keeps this honest**: the number of requests per check remains bounded by
`maxRedirects`, unchanged. FR-004's ceiling — a full cycle against one target must
not exceed a handful of ordinary visits — is satisfied more exactly by this rule
than by the current one, because one visit following three redirects is one visit.

**Rejected**: raising `maxRedirects` to compensate, or running slices more often
than daily. Both increase traffic to targets to solve a problem of our own
scheduling.

### R8a. Measured after the first live sweep — the same argument reaches robots.txt

**Status**: open. The census schedule is disabled until this is decided.

The first live sweep (`census` run `32554093317`, slice 0) was **cancelled at
exactly 120 minutes with nothing published**. Two hours of real requests to
roughly two thousand government domains, every measurement discarded.

The cause is the same shape as R8, one step earlier. The `robots.txt` fetch and
the page check are two requests to the same host, so the second pays the full 15s
per-host interval. Simulating the real `RateLimiter` at 1/100 scale, with the
census's actual access pattern:

| | projected slice time |
| --- | ---: |
| As built — `robots.txt` pays the per-host interval | **91 min** |
| `robots.txt` treated as a continuation | **34 min** |

91 minutes is *pure limiter waiting*, before a single HTTP response is accounted
for. Timeouts pushed the real run past the cap.

**The proposal** is R8's argument applied unchanged: `robots.txt` and the page it
guards are **one visit, not two independent readings**. Nobody fetches
`robots.txt` as a separate reading of a site — it is fetched precisely so that the
one request that follows may be made. The per-host interval exists to space
independent readings, and there is only one here. The backend budget still
charges, which is why the projection is 34 minutes rather than near zero: the
shared-hosting limit continues to do its work untouched.

**Why the schedule is off rather than the cap raised**: raising the cap would only
make the same wasted traffic take longer to discard. A request whose result we
throw away is not a measurement, and Principle I does not permit spending a
jurisdiction's resources on one.

**Not implemented, and deliberately still open.** This changes a politeness limit,
and Principle III makes those structural.

**What was done instead** (project owner's decision): concurrency raised from 6 to
12 — the change FR-133 blocked until the shared-hosting gap closed, now permitted
because the per-address limit means twelve workers cannot pile onto one backend.

| | limiter waiting | plus ~29 min observed request time |
| --- | ---: | ---: |
| 6 workers, as first shipped | 91 min | ~120 min — the cap, hit exactly |
| 12 workers | 46 min | ~75 min |

The trade is worth stating plainly rather than leaving implicit. Raising
concurrency does change what targets collectively experience: twice as many
government servers hear from us at the same moment. Per-target load is unchanged,
and the per-address limit bounds any shared backend — but the aggregate is
genuinely higher, where R8a's change would have altered nothing a target can
observe. The 45 minutes of margin this buys is real; so is the cost.

R8a therefore remained available, and has now been taken. A slice creeping back
toward the cap was not hypothetical: the second sweep finished in 99m42s, twenty
minutes short of it.

**Decided and implemented.** `robots.txt` and the page it governs are charged as
one visit. The backend budget still charges — that is the limit protecting a
shared machine, and a continuation must never escape it — but the name-keyed
interval does not, because it exists to space two *independent* readings and this
is not two.

The precedent was already in the codebase and was approved with `003`: a redirect
hop charges the backend budget and not the name-keyed interval, on exactly this
reasoning. R8a applies the same rule one request earlier. Asking a site's
permission and then acting on the answer is one visit, and a browser does it
without pausing fifteen seconds in the middle.

What it removes is a full per-host interval from every target that publishes a web
address — roughly 2,045 of a slice — and it alters nothing any target can observe.

**Sabotage found a hole the implementation did not.** Seeding every sample rather
than the first passed all 274 tests, because the census takes one sample and
nothing else supplied a seed. The rule keeping R8a from becoming a burst was a
comment rather than a constraint. A test now drives `sampleTarget` with two
samples and a seed, and all three sabotages bite: ignoring the seed, seeding every
sample, and letting a continuation skip the backend budget.

**Still to be measured.** The saving is not claimed until a dispatched slice shows
it. Two projections of this duration have already been wrong, both optimistic.

---

## R9. What is not being solved

- **Parked pages** (FR-124). Separating a registrar placeholder from a thin real
  site needs page content, which this project does not retain. Declined in the
  open rather than left as a requirement nobody can satisfy.
- **State and local traffic ranking**. `analytics.usa.gov` covers Digital
  Analytics Program participants, so hot-tier membership is federal in practice.
  A known limit of the hot tier, not a defect.
- **Multi-label public suffixes**. `registrableDomain` takes the last two labels,
  which is correct for every `.gov` and remains correct for this feature's entire
  scope. It becomes wrong the day a target outside `.gov` is added, and it is one
  function.
