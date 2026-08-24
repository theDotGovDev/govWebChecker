# Data model — analysis and presentation

**Feature**: `002-analysis-presentation` | **Date**: 2026-08-24

Nothing is stored. Every type here is derived from the record at build time and
exists only in the generated site. What matters about them is mostly what they
**refuse to represent**.

---

## `Figure` — the only way to publish a quantity

```ts
interface Figure {
  readonly value: number;
  readonly unit: 'percent' | 'milliseconds' | 'count';
  readonly tier: Tier;                 // never both
  readonly population: number;         // how many sites the figure covers
  readonly window: { from: string; to: string };
  readonly samples: number;            // readings behind it
  readonly vantage: string;            // from the record, not from config
  readonly rule?: string;              // e.g. 'presence/1', when derived
}
```

There is no other numeric type in the view model, and `render` accepts `Figure`
where a number would otherwise go. Constructing one requires every field; there
is no partial constructor and no default for `vantage`.

**What it refuses**: a number without a method (FR-201), a figure spanning tiers
(FR-220, enforced by `tier` being singular), and a figure whose vantage was
assumed rather than observed.

**Absence is not a `Figure` with value 0.** A period with no readings is
`undefined`, and the renderer has a distinct path for it (FR-204). A zero would
read as "measured, and it was nothing".

---

## `Standing` — an ordering, and the things it cannot order

```ts
interface Standing {
  readonly host: string;
  readonly figure?: Figure;            // absent when there is no rate to state
  readonly noRate?: NoRateReason;      // why, when there is not
}

type NoRateReason =
  | { kind: 'refused'; statusCode: number }   // answered, declined automation
  | { kind: 'not_checked'; rule: string };    // robots.txt said not to
```

`figure` and `noRate` are mutually exclusive, and a `Standing` with `noRate`
is excluded from any ordering by that figure rather than sorted to the bottom.

**Why this shape**: four of the 58 hot-tier hosts have no availability rate.
`secure.login.gov` is `skipped` because `robots.txt` says not to check it;
`www.ssa.gov`, `travel.state.gov` and `tools.usps.com` return 403 to automated
traffic. None is down. A `number` field with `0` for these would publish Social
Security at zero availability — which is why FR-261 exists and why the absence is
a variant rather than a sentinel value.

**No composite** (D1). There is no field combining measures, and no `score`.

---

## `Series` — cadence is part of the type

```ts
type Series =
  | { cadence: 'continuous'; tier: 'hot';   points: Point[] }
  | { cadence: 'discrete';   tier: 'broad'; marks: Mark[] };

interface Mark {
  readonly cycle: string;              // '2026-W35'
  readonly figure?: Figure;
  readonly complete: boolean;          // slices ran / slices in frame
  readonly slicesRan: number;
  readonly slicesInFrame: number;
}
```

The discrete variety has **marks, not points, and no path between them**. That is
a property of the renderer for this variant, not a style: a line between two
weekly readings asserts knowledge of the six days between (FR-230).

`complete` carries FR-231. A cycle at 3/7 slices covers fewer domains, so any
rate over it moves for reasons that are about us; it is marked in progress and
never presented as a change in what it measures.

---

## `Listing` — one site (D2, D3)

```ts
interface Listing {
  readonly host: string;               // THE KEY. See below
  readonly domain: string;             // the registered name, as a grouping
  readonly targetIds: string[];        // provenance; usually one
  readonly tier: Tier;
  readonly readings: Reading[];
  readonly state: Presence;            // website | no_website | undetermined
  readonly lastChecked: string;
  readonly cadence: 'hourly' | 'weekly';
  readonly correctionRoute: string;
}
```

**Keyed on host, not `target_id`** — research.md R7. The record carries 61
`target_id`s over 58 hot-tier hosts, because the id scheme changed and three
hosts kept both:

```
www.irs.gov -> irs-gov, www-irs-gov      (and usa.gov, weather.gov the same)
```

Keying on `target_id` would give `www.irs.gov` two listings, each stating half
its sample count — an FR-201 violation produced by an identity accident rather
than by anything about the IRS. `targetIds` records the join instead.

### The undetermined listing

The one page in seven with nothing but our own failure to report (359/2,310 in
slice 1). Its template is fixed and tested, and it leads in this order:

1. **We could not establish a connection to this site.**
2. This says nothing about whether the site works.
3. When we tried, and what we requested.
4. The registered domain, its jurisdiction, and how to have this corrected.

The jurisdiction's name appears as the subject of *our* failure. It never appears
next to a failure state (FR-246).

---

## `DomainGroup` — a registered name and the sites beneath it

```ts
interface DomainGroup {
  readonly domain: string;
  readonly listings: Listing[];
  readonly knownSites: number;         // what we know of
  readonly sourceOfDepth: string;      // how we came to know
}
```

`knownSites` is a count of **our knowledge**, never of what exists. Today the
census reaches the apex and `www`, so most groups hold one site — and FR-245b
requires the page to say which of its sites were checked rather than implying the
rest were. When `004` lands, this is where the extra sites appear, which is the
point of having decided D3 before building anything.

---

## What is deliberately absent

| Not modelled | Why |
| --- | --- |
| A composite score, index or grade | D1. Any composite must carve out the four hosts with no rate, and once it does it adds nothing the columns did not |
| `availabilityAcrossAllTiers` | FR-220. There is no function that could compute it |
| A `down` or `broken` state | FR-210. The three presence states never merge, and `outcome` stays a protocol fact |
| `value: 0` for an unmeasured period | FR-204. Absence is `undefined` and renders as absence |
| Any field naming a person | FR-244. The registry carries security-contact emails; none reaches the site |
