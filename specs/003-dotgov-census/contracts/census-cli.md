# Contract: the census commands

Extends `001`'s [checker CLI](../../001-record-availability/contracts/checker-cli.md).
Everything that contract says still holds — in particular the list of options that
deliberately do not exist, which this feature adds to rather than relaxes.

## Commands

### `build-frame`

Reads the published `.gov` registry, applies exclusions, and writes the census
frame.

| Option | Purpose |
| --- | --- |
| `--out <path>` | Frame to write. Defaults to `targets/dotgov-frame.json` |
| `--exclusions <path>` | Removal requests. Defaults to `targets/excluded.json` |
| `--source <url>` | Registry to read. Defaults to the CISA published CSV |

Makes exactly one HTTP request, to the registry. It contacts no government web
server, so it is safe to run anywhere — but like every other scheduled thing here,
it ships as a workflow so the answer can be recomputed after any one session ends.

**Refuses to write** a frame that is empty, that is more than 20% smaller than the
one it is replacing, or whose stored `slice` values disagree with recomputing them.
The first two are the shapes a truncated download takes, and silently replacing
16,535 domains with 400 would present as a coverage collapse that looked like a
finding about government rather than about us. The third cannot happen unless the
hash changed, in which case every historical slice claim is wrong and the build
must stop rather than paper over it.

**Exit codes**: `0` on success. `1` on a refusal above or an unreadable source.

### `census`

Runs one broad-tier slice and appends the results.

| Option | Purpose |
| --- | --- |
| `--frame <path>` | Frame to read. Defaults to `targets/dotgov-frame.json` |
| `--slice <n>` | Which slice. Defaults to the slice for today |
| `--out <dir>` | Record directory. Defaults to `data/availability` |
| `--only <domain>` | One domain. For diagnosis; obeys every limit |
| `--dry-run` | Perform the checks, print the records, write nothing |

Every observation it writes carries `tier: "broad"`, its `cycle`, its `slice`, the
`url_rule` that produced the URL, the `resolution` DNS gave, and the `presence`
reading with its rule version.

**Exit codes**: as `check`. A domain being down, absent, or unresolvable is data,
not a failure of the command. `1` only when the run could not proceed — an
unreadable frame, an unwritable record directory, or a slice that is empty when
the frame says it should not be.

An empty slice exits non-zero deliberately. FR-115 requires an interrupted cycle
to be distinguishable from a complete one, and a run that recorded a successful
sweep of nothing is the one shape that would make a gap look like coverage.

### `verify` — extended

Gains one check: **coverage**. Given a record and a frame, it reports for each
cycle whether all seven slices ran against the same frame digest and how many
domains each covered.

Like every other check it reads the record, not the code. A reader holding only
the published record and the committed frame reaches the same verdict without
trusting our implementation — which is the whole point of SC-102.

## Options that deliberately do not exist

Adding to `001`'s list:

| Not provided | Why |
| --- | --- |
| `--concurrency` | FR-132 fixes hosts in flight at 6. It is a stated constraint of this feature, not a tuning parameter |
| `--all` / `--no-slice` | Checking the whole frame in one run is precisely the traffic pattern the rolling slice exists to avoid |
| `--skip-resolution` | Resolution is how absence is told from failure. Skipping it would make the census assert broken websites it has no evidence for |
| `--http-fallback` | R4. An `https` failure on a government site is a finding, not an artefact to work around |
| `--force-frame` | The refusals in `build-frame` are the guard against publishing a coverage collapse as a finding. A flag to bypass them is a flag to publish a lie |

## What the workflows do

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `check.yml` | hourly | The hot tier, unchanged in behaviour. Now states its tier explicitly |
| `census.yml` | daily | One slice of the broad tier, then `verify`, then commit |
| `refresh-frame.yml` | weekly | Rebuilds the frame and opens a **pull request** if it changed |

`refresh-frame.yml` opens a pull request rather than committing, matching
`refresh-targets.yml`. The frame is the definition of what this project sends
traffic to; a change to it — 400 domains appearing, or 4,000 vanishing — is
something a person should see before it takes effect.

`census.yml` runs `verify` before committing, exactly as `check.yml` does. A slice
that violated a guarantee discards its readings rather than publishing them.
