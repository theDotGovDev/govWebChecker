# Quickstart: running and verifying US1

How to run the checker and — more importantly — how to confirm it behaved
politely, using only the record it produced.

Every command and every output below is copied from a real run against local
fixtures. Nothing here is illustrative.

## Prerequisites

- Node.js 22 or later
- No API keys, tokens, or credentials. This release needs none (FR-007)

```bash
npm install     # dev dependencies only: typescript, @types/node
npm run build
```

## Run the tests first

Per the project's test-first default, the failing run comes before the code that
makes it pass.

```bash
npm test
```

106 tests, about two seconds. No test touches the network: a guard patches socket
creation and fails any test that dials something other than loopback (SC-006). If
a test ever needs a real government site to pass, that test is wrong.

## Check a single target

```bash
node dist/src/cli/index.js check --only irs-gov --dry-run
```

`--dry-run` performs the real checks and prints the records without writing
anything. It still obeys every rate limit — a dry run is dry with respect to
*our* disk, not to the target.

One reading per check, so a single target is quick. A full pass is paced by the
per-host and per-domain intervals rather than by any one site, and there is
deliberately no flag to speed it up.

## Run a full pass

```bash
node dist/src/cli/index.js check
```

```text
run 2026-08-02T01:52:44.668Z/availability/ab865680
  2 targets, success=2
```

Appends to `data/availability/YYYY-MM.jsonl`, and the run itself to
`data/runs/YYYY-MM.jsonl`. Exits `0` whether or not the targets responded — a
down site is data, not an error (FR-025). It exits non-zero only when the run
itself could not proceed: an unreadable target list, an unwritable directory.

## Verify the politeness guarantees

This is the part worth doing.

```bash
node dist/src/cli/index.js verify data/availability/2026-08.jsonl
```

```text
per-host spacing                no repeated key to compare (required 15000ms)         PASS
per-domain spacing              no repeated key to compare (required 5000ms)          PASS
method on every row             2/2 rows carry their method                           PASS
no future timestamps            0 rows ahead of now; latest 2026-08-02T01:52:44.687Z  PASS
append-only ordering            2 targets, each in order                              PASS
rows match the record contract  2/2 valid                                             PASS

2 rows checked — all guarantees hold
```

Exits non-zero if any guarantee is violated.

The point is that this reads the *record*, not the code. Anyone can run the
equivalent against the published data and reach the same verdict without trusting
our implementation — which is what SC-002 and SC-012 promise.

Two things about that output worth understanding:

- **"no repeated key to compare"** means this record has only one row per host, so
  there is no gap to measure yet. It is not a vacuous pass hiding a problem — it
  says exactly what it checked.
- **"each in order" is per target, not across the file.** Different hosts are
  checked concurrently and appended as each finishes, so the file is legitimately
  not in overall time order. A single target is checked serially, so its own rows
  must never go backwards; that is what append-only actually forbids.

## Read the record by hand

No tooling from this project required (FR-021):

```bash
# How did one site do this month?
jq 'select(.target_id=="irs-gov") | {checked_at, outcome, median: .latency.median_ms}' \
  data/availability/2026-08.jsonl

# What failed, and how?
jq -r 'select(.outcome!="success") | [.checked_at, .host, .outcome] | @tsv' \
  data/availability/2026-08.jsonl

# Which runs should be discounted entirely?
jq -r 'select(.all_targets_failed) | .run_id' data/runs/2026-08.jsonl

# Distinguish a gap from a failure: which days did we measure at all?
jq -r '.checked_at[:10]' data/availability/2026-08.jsonl | sort -u
```

That last one matters. A day missing from the output is a day we did not measure,
which is different from a day everything failed — and the record must never let
those be confused (US1 scenario 5).

## Scheduled runs

`.github/workflows/check.yml` runs the same command hourly and commits the
appended records back. The site rebuilds on its own six-hourly rhythm rather
than on every data commit — at hourly collection that would be 24 deployments a
day to change one table.

- Runs are guarded by a concurrency group set to queue, not cancel: a cancelled
  run is a gap in the record, and gaps are meant to mean "we did not measure".
- The workflow runs `verify` before committing. A run that violated a politeness
  guarantee does not get published — publishing data that fails our own stated
  checks would be worse than publishing nothing.
- Scheduled runs are best-effort and can be delayed; `checked_at` records when the
  check actually ran, never when it was scheduled (FR-011).
- If scheduled runs stop firing, the record shows it as missing rows. Silent
  cessation is the failure mode that goes unnoticed longest, so it is worth an
  explicit check once the schedule is live (task T050).

## What "working" looks like

- One row per active target per run, including failures (SC-001)
- One run summary per pass, joined to those rows by `run_id`
- `verify` exits 0 on the produced record (SC-002, SC-012)
- Every row carries its method (SC-003)
- A target down all day produced no more traffic than one that was up (SC-004)
- The full suite passed with no network access (SC-006)

## Known limitations of this release

- `targets/federal.json` is a **development seed of three hand-picked sites**, not
  the traffic-selected list FR-001a requires. Each entry says so in its own
  `traffic_evidence` rather than implying a measurement nobody took (task T048).
- The scheduled workflow has not yet run against real infrastructure.
- Only availability and response time are measured. Transport security, the
  quality audit, and technology fingerprinting are User Stories 2–4.
