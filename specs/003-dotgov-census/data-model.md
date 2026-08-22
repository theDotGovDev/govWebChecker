# Data model — the census

**Feature**: `003-dotgov-census` | **Date**: 2026-08-22

Two things are added: a **frame** (what exists to be checked) and four fields on
the **observation** (what a check found out). Nothing existing changes shape, and
every observation field is optional so rows written before this feature stay
valid (FR-136, FR-142).

---

## The frame — `targets/dotgov-frame.json`

Generated from the published registry, never hand-edited. Committed, so a reader
can tell "not checked" from "not registered at the time" by reading git history
(FR-104).

```jsonc
{
  "source": "https://raw.githubusercontent.com/cisagov/dotgov-data/main/current-full.csv",
  "retrieved_at": "2026-08-22T04:00:00Z",
  "digest": "sha256:…",        // of the frame's own domain list, not the upstream CSV
  "domains": [
    {
      "domain": "alamosa.gov",
      "type": "City",           // the registry's own value, unnormalised
      "organization": "City of Alamosa",
      "state": "CO",
      "slice": 3                // fnv1a(domain) % 7 — stored for legibility, recomputable
    }
  ]
}
```

| Field | Why it exists |
| --- | --- |
| `source` | Names what was read, so the frame is traceable to a published dataset (Principle V) |
| `retrieved_at` | When the registry looked like this |
| `digest` | Ties run summaries to an exact frame. A cycle is complete when all seven slices ran against the same digest (FR-115) |
| `slice` | Stored so a reader need not reimplement the hash to check coverage. It is a pure function of `domain`, so it can never disagree with the code — a mismatch is a bug the frame builder must refuse to write |

**`type` is deliberately not normalised.** The survey found sixteen distinct
values, not the six first assumed — separate Federal branches, `School district`
and `Special district` alongside `City` and `County`, and five `- Election`
variants. Any grouping for presentation must be stated by the presenter rather
than baked in here, where it would silently define what comparisons are possible.

### Exclusions — `targets/excluded.json`

```jsonc
{
  "excluded": [
    { "domain": "example.gov", "since": "2026-08-22", "reason": "operator request" }
  ]
}
```

Applied when the frame is built. The domain leaves the frame; its existing
observations remain readable (FR-105, SC-109). The reason is required — a removal
honored without argument is still a removal recorded with its cause.

---

## The observation — four additive fields

`Observation` already carries `address` from the shared-hosting work. This feature
adds:

```jsonc
{
  // …existing fields unchanged…
  "tier": "broad",              // or "hot"
  "cycle": "2026-W34",          // the cycle this belongs to
  "slice": 3,                   // which slice covered it
  "url_rule": "canonical/1",    // the rule that produced `url` from a bare domain
  "resolution": {
    "status": "address",        // address | mail_only | no_service | nxdomain | resolver_error
    "apex": true,               // does the apex publish an address
    "www": true,                // does the www form
    "codes": ["ENODATA"]        // present only when status is not `address`
  },
  "presence": {
    "state": "website",         // website | no_website | undetermined
    "rule": "presence/1"
  }
}
```

### `tier`, `cycle`, `slice`

Provenance. Together they satisfy FR-108 (every observation records its tier),
FR-110 (a domain in both tiers stays separable), FR-114 (coverage determinable
from the record), and FR-139 (a per-tier figure computable without joining
against a target list that may since have changed).

`cycle` is an ISO week for the broad tier. The hot tier carries the same field so
rows are uniform; its value is the week the reading fell in, which no hot-tier
figure depends on.

### `url_rule`

Names the rule that turned a bare domain into the URL requested (FR-129). A
reader knows what was actually asked for rather than inferring it, and a later
rule change is visible as a different value rather than as an unexplained shift in
the data.

### `resolution` — evidence, not inference

Required for every census target (FR-120). Resolution costs the target nothing —
the queries go to a resolver, never to the jurisdiction's server — so this
converts the single largest category in the census from guesswork into recorded
fact at no cost under Principle I.

| `status` | What it means | Measured share |
| --- | --- | ---: |
| `address` | Publishes a web address at the apex, `www`, or both | 86.8% |
| `mail_only` | Publishes mail service and no web address | 8.3% |
| `no_service` | The name exists and publishes nothing | 2.7% |
| `nxdomain` | The name does not exist | 0.0% |
| `resolver_error` | **Our** resolution failed | 2.3% |

`codes` carries the raw resolver codes when the status is not `address`. Without
them, a resolver failing us is indistinguishable from a domain answering that it
publishes nothing — the exact confusion FR-121 exists to prevent, and the reason
`resolver_error` is a status of its own rather than being folded into
`no_service`.

### `presence` — the reading, versioned

The only field here that is a judgement, which is why it is fenced off from the
rest (FR-117, FR-118).

| `state` | When |
| --- | --- |
| `website` | Resolution found an address **and** the request produced a response — including an error status. A site returning 500 has a website that is broken |
| `no_website` | Resolution authoritatively found no web address: `mail_only`, `no_service`, or `nxdomain` |
| `undetermined` | `resolver_error`, or an address that could not be reached at the transport level. We do not know, and say so |

**`presence` is derivable from stored facts alone** — `resolution`, `outcome`,
`status_code`, `redirect_chain` — and from nothing else. That is what makes FR-119
true: `presence/2` can be computed over every row already collected without a
single target being checked again, and changing the rule alters no stored fact.

The implementation must therefore be a pure function of an `Observation`, and is
tested as one against rows it did not produce.

**Why a broken site is `website` and a resolver error is not `no_website`**: both
directions of that asymmetry are deliberate. A 500 is evidence a website exists;
our own failure is evidence of nothing about the jurisdiction. Erring the other
way would publish 1,807 accusations per cycle, which is the risk User Story 2
exists to prevent and the largest correctness risk in the feature.

---

## Run summary — coverage accounting

The existing summary gains what a coverage claim needs:

```jsonc
{
  // …existing fields unchanged…
  "tier": "broad",
  "cycle": "2026-W34",
  "slice": 3,
  "frame_digest": "sha256:…",
  "frame_size": 16535,          // the whole frame
  "slice_size": 2364            // what this run was responsible for
}
```

A cycle covered the frame when seven summaries share a `frame_digest` and their
`slice_size` values sum to `frame_size`. Anything else is an incomplete cycle, and
it is visible as such rather than indistinguishable from a complete one (FR-115,
SC-102). Which domains were missed is then the frame's slice minus the observed
`target_id`s — computable by a reader holding only the record and the committed
frame.

---

## Identity

`target_id` for a census domain is the domain itself. It is stable, never reused,
and needs no allocation step for 16,535 entries. A domain that leaves the registry
and returns years later is genuinely the same jurisdiction's name, and its history
should join up.
