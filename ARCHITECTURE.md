# Architecture

govWebChecker measures public government websites and stores what it finds. This
describes the components as they exist today.

**Status**: User Story 1 is built — the checker measures availability and
response time, records it, and can prove its own conduct from the record. What
is *not* built: the other three dimensions (transport security, the standard
quality audit, technology fingerprinting) and the public site. The target list
is a development seed, not the traffic-selected list the spec requires. See
[`specs/001-record-availability/tasks.md`](specs/001-record-availability/tasks.md).

## Shape of the system

```mermaid
flowchart LR
    targets[targets/*.json<br/>target list, as data] --> checker
    subgraph checker[checker]
        direction TB
        C1[perform check] --> C2[classify outcome]
        C2 --> C3[summarize samples]
    end
    checker -->|every request| politeness
    politeness[politeness<br/>rate limits, backoff, identification]
    checker --> record[record<br/>validate then append]
    record --> data[(data/&lt;dimension&gt;/YYYY-MM.jsonl)]
    data --> verify[verify<br/>checks our conduct from the record]
    data --> site[static site<br/>not yet built]

    style site stroke-dasharray: 4 4
```

Dashed components are not implemented yet.

## Components

### `src/politeness/` — the traffic rules

The constraint that separates this project from a stress tester, placed where a
caller cannot route around it.

- `domain.ts` — collapses a hostname to the key that groups hosts likely sharing
  a backend. Takes the last two labels, which is correct for `.gov` and wrong for
  multi-label suffixes; documented at the definition, and the single place that
  changes when scope widens beyond federal.
- `rate-limiter.ts` — two independent limits, per host and per registrable
  domain, whichever is stricter. Serializes acquisition, so there is never more
  than one request in flight to a host. Enforced spacing exceeds the configured
  minimum by a small margin so the guarantee holds on the *recorded* timestamps,
  which is what an outside reader can check.
- `backoff.ts` — the wait after a failure, which only ever grows.
- `user-agent.ts` — identification that a caller cannot override.

### `src/record/` — the stored measurements

The artifact meant to outlive the code, so its rules are enforced rather than
assumed.

- `types.ts` — the observation shape.
- `validate.ts` — checks a record against
  [`contracts/observation.md`](specs/001-record-availability/contracts/observation.md).
  It rejects more than malformed data: verdict fields, stored page content, and
  latency of zero standing in for no measurement are all refused, because those
  are the ways a record stops being honest.
- `writer.ts` — append, and only append. No update, no delete, no deduplication,
  since a correction is a new observation rather than an edit.

### `src/checker/` — performing the measurement

- `check.ts` — one request with socket-level timing, following redirects and
  recording the chain. Classifies failures by the lifecycle phase they arrive in
  rather than by error text, which drifts between Node versions. It never returns
  a body. `fetchTextForEvaluation` is the deliberate, size-capped exception, used
  only for `robots.txt` — a file whose purpose is to be read before we act.
- `robots.ts` — a small parser for the directives that decide whether we may
  fetch: User-agent grouping, Disallow, Allow. A group naming us beats the
  wildcard, and the longest matching rule wins, so a site can carve an exception
  out of a broad prohibition and we honor it.
- `sample.ts` — repeated readings through the limiter, summarized as a median
  with min and max. No successful timing means no latency figure at all.
- `run.ts` — one pass. Different hosts run concurrently up to a bound; one host
  never runs concurrently with itself. Politeness is a property of what we do to
  a single server, not of total throughput.

### `src/cli/` — the command surface

`check` runs a pass. `verify` reads a record and reports whether the politeness
guarantees hold, printing expected versus actual.

`verify` matters more than it looks: it reads the *record*, never the code, so
someone who has never seen this repository can run the same check against the
published data and reach the same verdict.

The CLI has no flag that weakens a limit — no `--concurrency`, no
`--rate-limit`, no `--timeout`, not even for local runs, since a local run
reaches the same government servers a scheduled one does. Tests inject limits at
the layer below, so the fast path exists where it cannot ship.

## Data flow

```mermaid
sequenceDiagram
    participant S as Schedule
    participant R as Run
    participant P as Politeness
    participant T as Target site
    participant D as data/

    S->>R: start
    loop each active target
        R->>P: acquire(host)
        P-->>R: granted (after host + domain intervals)
        R->>T: GET (identified User-Agent)
        T-->>R: response, or a failure kind
        R->>D: append one observation, always
    end
    R->>D: append run summary
```

The loop appends an observation whether the target responded or not. A failure is
data, so there is no path through this diagram that produces silence.

## Boundaries that matter

- **Nothing writes to `data/` except `record/`**, and it validates first.
- **Nothing makes a request except through `politeness/`.** A future dimension
  that needs to bypass it is a design problem, not a special case.
- **The stored record holds no verdicts.** Whether a site counts as "up" is a
  question for the analysis half, where the threshold can change without
  rewriting history.
- **No page content is persisted.** Analysis of a page happens in memory during a
  check; only findings survive.

## Testing

`node:test`, with local loopback servers as fixtures. No test contacts an
external host — a suite that needs the internet to pass cannot be trusted to run
in CI, and pointing tests at real government sites would violate the project's
own traffic rules.

The politeness limits have tests that fail when a limit is loosened. They are the
one thing here that cannot regress unnoticed.
