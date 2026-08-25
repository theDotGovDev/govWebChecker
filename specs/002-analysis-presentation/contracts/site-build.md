# Contract — `build-site`

**Feature**: `002-analysis-presentation` | **Date**: 2026-08-24

Extends the existing `build-site` command. Reads the record, writes `docs/`,
touches no network.

## `build-site`

| Option | Purpose |
| --- | --- |
| `--data <dir>` | Record to read. Defaults to `data/` |
| `--out <dir>` | Where the site is written. Defaults to `docs/` |
| `--frame <path>` | Census frame, for the domains a listing may exist for. Defaults to `targets/dotgov-frame.json` |
| `--targets <path>` | Hot-tier target list. Defaults to `targets/federal.json` |

**Writes**: an index, one page per tier, one page per registered domain, and one
listing per site — roughly 16,600 files.

**Exit codes**: `0` on success. `1` on a refusal below.

## What it refuses to build

A build failure here is the point, not an inconvenience. Publishing a figure that
cannot say what it measured would be worse than publishing nothing, which is the
same reasoning that makes `check.yml` discard a run that violated its own
guarantees.

| Refusal | Why |
| --- | --- |
| A figure missing tier, population, window, sample count or vantage | FR-251, Principle V. Enforced by the `Figure` constructor, so it fails at build rather than at review |
| A figure computed over more than one tier | FR-220 |
| A rendered numeric token that no `Figure` produced | The output-level check. A number formatted into a template literal bypasses the type; this does not let it bypass the guarantee |
| A view merging two of the three presence states | FR-210 |
| A reading whose vantage is not a collection runner | FR-253. A `local` row is a development artefact and must never be presented as a measurement of a target |
| An empty record | Renders "nothing to report" rather than a page of zeroes — but a record that exists and cannot be parsed is a failure, not an empty state |

## Options that deliberately do not exist

| Not provided | Why |
| --- | --- |
| `--skip-method` / `--terse` | The method is not decoration. A flag to omit it is a flag to publish an accusation |
| `--score` / `--rank-by-composite` | D1. There is no composite to rank by, and adding the flag would be adding the composite |
| `--include-unvalidated` | Nothing unvalidated exists to include; `004` FR-440 keeps discovered-but-unreachable names out of published output entirely |
| `--refresh` / any fetch | FR-250. The build has no network path. A flag implying it could get fresher data would be a lie about where the data comes from |
| `--since <date>` filtering the record | A published figure states its own window. Letting the caller narrow the input silently changes what a figure covers without changing what it says it covers |

## Guarantees a reader can check

These are checkable against the built site, without trusting the generator —
the same standard `verify` meets against the record.

1. Every number on the site appears alongside its tier, population, window,
   sample count and vantage.
2. No category anywhere combines `no_website`, `undetermined` or a request
   failure.
3. No figure's underlying observations span two tiers.
4. Every site in the frame has a listing, and no listing presents our own failure
   to reach a site as a finding about it.
5. A census series has one mark per cycle and nothing drawn between cycles.
6. No individual is named anywhere in the output.

## Workflow

`pages.yml`, unchanged in trigger: build then deploy. The build gains the
refusals above, so a site that cannot state its method fails the workflow rather
than deploying.
