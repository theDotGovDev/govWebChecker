# Contract: the observation record

The stored record is the interface between this half of the project and the
analysis half, and it is the artifact intended to outlive the code. This contract
is therefore stricter than an internal data structure would be.

## Format

Newline-delimited JSON. One observation per line. One file per dimension per
month: `data/<dimension>/YYYY-MM.jsonl`.

Files are append-only. A line, once written, is never edited or removed
(FR-017). Git history is the enforcement: a mutation shows up as a diff on an
existing line, which is reviewable.

## Example

```json
{"schema":"1","run_id":"2026-07-31T06:00:12Z/availability","target_id":"irs-gov","host":"www.irs.gov","url":"https://www.irs.gov/","dimension":"availability","checked_at":"2026-07-31T06:04:51Z","outcome":"success","status_code":200,"redirect_chain":[],"latency":{"samples":3,"median_ms":412,"min_ms":388,"max_ms":509},"method":{"vantage":"github-actions/ubuntu-latest","timeout_ms":15000,"sample_count":3,"tool_version":"0.1.0","source":"self_run"}}
```

A failure carries the same shape with the outcome-specific fields:

```json
{"schema":"1","run_id":"2026-07-31T06:00:12Z/availability","target_id":"example-gov","host":"www.example.gov","url":"https://www.example.gov/","dimension":"availability","checked_at":"2026-07-31T06:05:20Z","outcome":"timeout","redirect_chain":[],"latency":{"samples":0},"method":{"vantage":"github-actions/ubuntu-latest","timeout_ms":15000,"sample_count":3,"tool_version":"0.1.0","source":"self_run"}}
```

Note what the failure row is *not*: absent, abbreviated, or flagged as an error.
It is an observation like any other (Principle IV).

## Field rules

- `schema` is present on every row from the first. A reader uses it to know which
  rules applied when the row was written.
- `checked_at` is UTC, and is when the check ran — never when it was scheduled
  (FR-011).
- `outcome` is a closed set (FR-013). A new outcome kind is a schema change, not a
  free-text addition.
- `latency` is absent or has `samples: 0` when nothing was measured. It is never
  `0` and never null-as-zero — absence of data is shown as absence (Principle V).
- `method` is present on every row (FR-014), including failures, because the
  timeout that produced a `timeout` outcome is part of what that outcome means.
- No field holds a page body, a subresource, or a screenshot (FR-015).
- No field holds personal data (FR-016).
- No field holds a verdict — no `up`, `healthy`, `grade`, or `score`.

## Compatibility rules

These exist so US2–US4 can extend the record without a migration, which FR-018b
requires:

1. **Additive only.** A new dimension adds fields and a new directory. It never
   redefines the meaning of an existing field.
2. **A new dimension is a new file**, not a wider row. `data/tls/`, `data/audit/`,
   `data/tech/` sit alongside `data/availability/`.
3. **Never mix sources in one series.** `method.source` distinguishes them
   (FR-018c). A change of source is visible as a change of source, not as the
   site changing.
4. **Unknown fields are ignored, not rejected**, by any reader — so an older
   analysis tool keeps working against a newer record.
5. **A removed field is deprecated, never reused.** Reusing a name silently
   changes the meaning of old rows.

## What a reader is promised

Given only the files, with no access to this code, a reader can:

- Read any single line and understand it, without the target list or another file.
- Reconstruct any published figure and see the method that produced it (SC-003).
- Verify the politeness guarantees from timestamps alone (SC-002, SC-012).
- Tell a gap in the record from a period of failures — missing rows versus rows
  with failure outcomes.
- Tell a lab measurement from a field measurement, and self-run from external
  (`method.source`).
