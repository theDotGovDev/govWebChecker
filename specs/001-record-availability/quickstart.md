# Quickstart: running and verifying US1

How to run the checker and — more importantly — how to confirm it is behaving
politely, using only the record it produced.

## Prerequisites

- Node.js (current LTS)
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

No test touches the network. Every scenario runs against local fixture servers
(SC-006). If a test ever needs a real government site to pass, that test is
wrong.

## Check a single target

```bash
node dist/cli.js check --only irs-gov --dry-run
```

`--dry-run` performs the real checks and prints the records without writing. Note
that it still obeys every rate limit — a dry run sends the same traffic as a real
one, so it is dry with respect to *our* disk, not to the target.

Expect it to feel slow. Samples are spaced by the per-host minimum interval
(FR-011b), so a three-sample check takes at least twice that interval. That is
the design working.

## Run a full pass

```bash
node dist/cli.js check
```

Appends to `data/availability/YYYY-MM.jsonl`. Exits `0` whether or not the
targets responded — a down site is data, not an error (FR-025). It exits non-zero
only when the run itself could not proceed.

## Verify the politeness guarantees

This is the part worth doing.

```bash
node dist/cli.js verify data/availability/2026-07.jsonl
```

Prints a verdict per guarantee — expected versus actual — and exits non-zero if
any is violated:

```text
per-host spacing      min observed 60.2s   required 60s    PASS
per-domain spacing    min observed 12.1s   required 10s    PASS
method on every row   4210/4210                            PASS
append-only ordering  timestamps monotonic per file        PASS
no future timestamps  max 2026-07-31T06:04:51Z             PASS
```

The point is that this reads the *record*, not the code. Anyone can run the
equivalent against the published data and check our claims — which is what SC-002
and SC-012 promise.

## Read the record by hand

No tooling from this project required (FR-021):

```bash
# How did one site do this month?
jq 'select(.target_id=="irs-gov") | {checked_at, outcome, median: .latency.median_ms}' \
  data/availability/2026-07.jsonl

# What failed, and how?
jq -r 'select(.outcome!="success") | [.checked_at, .host, .outcome] | @tsv' \
  data/availability/2026-07.jsonl

# Distinguish a gap from a failure: days with no rows at all
jq -r '.checked_at[:10]' data/availability/2026-07.jsonl | sort -u
```

That last one matters. A day missing from the output is a day we did not measure,
which is different from a day everything failed — and the record must never let
those be confused (US1 scenario 5).

## Scheduled runs

`.github/workflows/check.yml` runs the same command and commits the appended
records back.

- Runs are guarded by a concurrency group so two runs cannot race the commit.
- Scheduled runs are best-effort and can be delayed; `checked_at` records when
  the check actually ran, never when it was scheduled (FR-011).
- If scheduled workflows stop firing, the record shows it as missing rows.
  Silent cessation is the failure mode that goes unnoticed longest, so this is
  worth an explicit check once the schedule is live.

## What "working" looks like

- One row per active target per run, including failures (SC-001)
- `verify` passes on the produced record (SC-002, SC-012)
- Every row carries its method (SC-003)
- A target down all day produced no more traffic than one that was up (SC-004)
- The full test suite passed with no network access (SC-006)
