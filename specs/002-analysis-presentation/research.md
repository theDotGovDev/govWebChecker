# Research — analysis and presentation

**Feature**: `002-analysis-presentation` | **Date**: 2026-08-24

Seven questions the plan needed answered. All are settled against the live record
(10,748 rows) or against the existing code, not against assumption.

---

## R1. How is Principle V enforced rather than promised?

**Decision**: a `Figure` type that cannot be constructed without its method, and
a renderer that accepts nothing else. Plus a test that reads the *rendered
output* and fails if a number appears that no `Figure` produced.

**Rationale**: this project has twice found a constraint that was stated but not
enforced, and both times it had already drifted. `maxConcurrentHosts` was called
"a stated constraint, not a tuning parameter" with no test asserting it. The R8a
seed rule was a comment, and sabotage showed every test passed with it broken. A
convention is obeyed until someone is in a hurry.

Checking the *output* rather than the code is the same move `verify` makes
against the record: a reader can reach the same verdict without trusting the
implementation.

**Alternatives considered**: a lint rule (checks syntax, not semantics — a number
formatted into a template literal passes); code review (not reproducible); a
naming convention like `xFigure` (a convention again).

---

## R2. Are ~16,535 listings feasible in one build?

**Decision**: yes, and the build streams by target rather than holding a
per-target index of every row.

**Measured**: the current record is 6.2 MB for 10,748 rows — about 580 bytes a
row. A full year at the current rate is roughly 1.4M rows, or ~800 MB, which is
too much to hold as parsed objects but nothing to stream.

The shape that matters: rendering one listing needs only that site's rows. So the
build makes one pass, groups by host, and renders each group as it completes,
rather than building a map of all 16,535 histories and then rendering. Monthly
partitioning already bounds any single file.

**Alternatives considered**: an index or database (a dependency for something one
pass does); rendering only changed listings (requires knowing what changed, which
means state the build does not have and should not keep).

---

## R3. How is a weekly cadence drawn without implying the days between?

**Decision**: the series type distinguishes cadence, and the discrete variety has
no line segment between marks — not as a styling choice but because the renderer
for it emits no path.

**Rationale**: a census reading is one sample of one domain per week. Drawing a
line between two marks asserts knowledge of the six days between them, which is
precisely the "absence shown as absence" clause of Principle V. Making it a
styling decision means someone can restyle it back.

An incomplete cycle is a separate case and a worse one: a cycle with three of
seven slices has fewer domains, so any rate over it looks like movement. FR-231
says it must be marked in progress, and the series type carries that per mark.

**Alternatives considered**: dashed lines between cycles (still asserts a path);
interpolating to the cycle midpoint (invents a reading).

---

## R4. What does a listing say when we have nothing but our own failure?

**Decision**: it leads with what is unknown, in its own words, and never renders
the site's name next to a failure state. A stated template, asserted by test.

**Measured**: 359 of slice 1's 2,310 domains and 305 of slice 4's 2,287 are
`undetermined` — 15.5% and 13.3%. So this is not an edge case; it is one page in
seven, at a scale of roughly 2,300 pages per cycle.

The template states, in order: that we could not establish a connection, that
this says nothing about whether the site works, when we tried, and what we tried.
The jurisdiction's name appears as the subject of *our* failure, not as the
subject of a finding.

**Alternatives considered**: omitting undetermined listings (D2 requires every
site have one, and a missing page is its own kind of statement); showing them as
"down" (the exact error the whole feature exists to prevent).

---

## R5. How do the tiers stay apart when both appear on one page?

**Decision**: `tier` is a parameter of every view-building function, and no
function in the model takes observations of more than one tier. Blending is not
prevented by review; it is prevented by there being no function that could do it.

**Rationale**: FR-220 forbids a figure computed across tiers. The cheapest way to
guarantee that is to make the cross-tier call impossible to write — the same
approach as R1. `src/site/model.ts` already has `tierViews()` and a test
asserting no combined availability field exists, so this extends a decision the
project already made rather than introducing one.

---

## R6. Does the record outgrow a whole-file read?

**Decision**: not for years, and the mitigation already exists.

**Measured**: 6.2 MB and 10,748 rows today, growing ~3,700 rows/day (1,400 hot +
2,300 census). One month is ~110k rows, ~64 MB. `recordPathFor` already
partitions monthly, so no single file grows without bound, and the build reads a
directory of month files rather than one file.

The site does not need every month to render a current figure. Windowing by what
each view actually covers keeps the working set to the months in scope.

---

## R7. Three hosts have two `target_id`s each

**Found while planning, in the live record.** Not anticipated by the spec.

```
www.irs.gov      -> irs-gov,     www-irs-gov
www.usa.gov      -> usa-gov,     www-usa-gov
www.weather.gov  -> weather-gov, www-weather-gov
```

61 `target_id`s cover 58 hosts. The id scheme changed from domain-derived to
host-derived at some point and the earlier rows kept the earlier id. Every id
maps to exactly one host, so nothing is ambiguous — but three hosts have their
history split across two ids.

**Why it matters here specifically**: a listing keyed on `target_id` would give
`www.irs.gov` two pages, each showing half its readings — and each would state a
sample count that is half the truth, which is an FR-201 violation produced by an
identity accident.

**Decision**: the listing is keyed on **host**. `target_id` is carried as
provenance, and a listing whose history spans more than one id says so.

This is not a workaround; D3 already decided the unit is the site, and a host is
what a site is. The finding is that the record's own identity column cannot serve
as that key, which is worth knowing before rendering 16,535 pages from it.

**Not fixed here**: the record is append-only, so the old rows keep their ids
(Principle IV — history is not rewritten to look tidier). The join happens at
read time, which is where a correction of this kind belongs.

**Alternatives considered**: rewriting the old ids (forbidden — it is an edit of
history); emitting two listings and cross-linking them (publishes an internal
accident as though it were a fact about the IRS).
