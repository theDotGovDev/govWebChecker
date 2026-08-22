# Quickstart — proving the census works without touching a target

**Feature**: `003-dotgov-census` | **Date**: 2026-08-22

Every scenario here runs against local fixtures and injected DNS. None resolves a
real name; none sends a request to a government server. That is a hard constraint
(SC-110), not a convenience — and it is why the fixtures model DNS as well as
HTTP, since half of what this feature decides is decided before any request is
sent.

## Prerequisites

```bash
npm ci
npm run build
```

## 1. The frame builds, and refuses to build a bad one

```bash
npm test -- --test-name-pattern="frame"
```

**Expect**: a frame built from a fixture registry has one entry per domain,
exclusions removed, and a `slice` on each that matches recomputing the hash.

**And expect refusals** — these are the ones that matter:

| Given | Then |
| --- | --- |
| A registry that returns 300 rows where the previous frame had 16,535 | Refuses, non-zero. A truncated download must not present as a coverage collapse |
| An empty registry | Refuses, non-zero |
| A frame whose stored `slice` disagrees with the hash | Refuses, non-zero |

## 2. Slices are stable and cover the frame exactly once

```bash
npm test -- --test-name-pattern="slice"
```

**Expect**:

- A domain's slice does not change when other domains are added to or removed
  from the registry. This is the property that makes coverage provable rather
  than probabilistic (FR-112, FR-113), and the reason slices are hashed from the
  name rather than taken from a position.
- Every domain lands in exactly one of seven slices, and the union of the seven
  is the frame — no domain covered twice, none missed.

## 3. Absence is distinguishable from failure

The scenario the feature exists for. Point the checker at fixtures covering every
case and confirm each lands somewhere a reader can tell apart:

```bash
npm test -- --test-name-pattern="presence"
```

| Fixture | `resolution.status` | `presence.state` |
| --- | --- | --- |
| Apex and `www` both resolve, site answers 200 | `address` | `website` |
| Only `www` resolves, site answers 200 | `address` | `website` |
| Resolves, site answers 500 | `address` | `website` |
| Resolves, connection refused | `address` | `undetermined` |
| MX only, no address | `mail_only` | `no_website` |
| Name exists, publishes nothing | `no_service` | `no_website` |
| Name does not exist | `nxdomain` | `no_website` |
| Our resolver failed | `resolver_error` | `undetermined` |
| Redirects to a non-`.gov` host | `address` | `website`, chain recorded |

**The two rows that carry the feature's whole risk** are `500 → website` and
`resolver_error → undetermined`. A site returning an error has a website that is
broken; a resolver failing us is evidence of nothing about the jurisdiction.
Getting either backwards publishes an accusation, at a measured rate of 1,807
domains per cycle.

## 4. The presence reading recomputes over stored history

```bash
npm test -- --test-name-pattern="recompute"
```

**Expect**: `presence` computed from a stored `Observation` the test wrote by hand
— never from a live check — matches what the checker recorded. This is FR-119 in
executable form: a better rule can be applied to everything already collected
without re-checking a single target, and changing the rule alters no stored fact.

## 5. The canonical URL rule costs the target nothing extra

```bash
npm test -- --test-name-pattern="canonical"
```

**Expect**: where resolution shows only one form has an address, only that form is
requested — the fixture asserts the *absence* of the second request (FR-130).
Where both resolve, the apex is requested and a redirect to `www` is followed and
recorded rather than pre-empted.

## 6. Coverage is provable from the record

```bash
npm run build
node dist/src/cli/index.js verify data/availability/<month>.jsonl --frame targets/dotgov-frame.json
```

**Expect** a per-cycle verdict: seven slices against one frame digest, slice sizes
summing to the frame size. An incomplete cycle reports which slices are missing
and how many domains went unchecked — as a number, not a warning to interpret.

## 7. The politeness limits still bite

```bash
npm test -- --test-name-pattern="rate limit"
```

**Expect** all existing limit tests to pass unchanged, plus the one this feature
adds for the redirect scope decision (R8): a redirect hop charges the backend
limit, and a hop to a host not yet contacted in this check charges everything.

The constitution requires these to fail when a limit is loosened. Verify that
claim rather than trusting it — remove a limit, watch the tests go red, restore
it.

## 8. Exercising it for real

Never from a development session, however good the network. Use
`workflow_dispatch` on `census.yml` and read the run's output.

A local run would measure that machine's network rather than the target's, and
`vantage()` would honestly label the rows `local` — but nothing rejects them, so
they would write into `data/` and pass the gate. The rule is structural, not a
matter of care.
