# Contract: the checker command

The command surface for US1. What is *absent* here is as much a part of the
contract as what is present.

## Commands

### `check`

Runs one availability pass over the active targets and appends the results.

| Option | Purpose |
| --- | --- |
| `--targets <path>` | Target list to read. Defaults to `targets/federal.json` |
| `--out <dir>` | Record directory. Defaults to `data/availability` |
| `--only <target-id>` | Check a single target. For diagnosis; obeys every limit |
| `--dry-run` | Perform the checks, print the records, write nothing |

**Exit codes**: `0` when the run completed, whatever the targets did. `1` only
when the run itself could not proceed — an unreadable target list, an unwritable
record directory.

A target being down is not a failure of this command (Principle IV, FR-025). A
run where every target failed still exits `0`, with the condition recorded in the
run rather than signalled by exit status.

### `verify`

Reads a record and checks it against the guarantees the project publishes:
per-host spacing, per-domain spacing, no future timestamps, append-only ordering,
every row carrying its method.

Prints a verdict — expected versus actual — rather than output to be eyeballed.
Exits non-zero when a guarantee is violated.

This exists because SC-002 and SC-012 promise those properties are verifiable
*from the record alone*. A reader with no access to the code can run the same
check on the published data.

## Options that deliberately do not exist

Principle III says the limits must live where a caller cannot forget them. An
override flag is precisely how that erodes, so:

- **No `--concurrency`.** Concurrency against one host is not tunable to zero-risk
  values; it is absent.
- **No `--rate-limit` or `--no-rate-limit`.** Not even for local runs, because a
  local run hits the same government servers as a scheduled one.
- **No `--retries`.** Retry behavior is fixed and backs off; a failing site never
  receives more traffic for having failed (FR-006).
- **No `--user-agent`.** Identification is not optional (FR-002, Principle III).
- **No `--timeout`.** It is part of the method recorded with every observation;
  making it a flag makes the record's meaning depend on invocation.

Tests construct the checker directly with a test configuration. The escape hatch
exists where it cannot ship.

## Behavioral guarantees

1. Requests to one host are serialized and separated by at least the per-host
   minimum interval — including the repeat samples within a single check
   (FR-003, FR-011b).
2. Requests to hosts sharing a registrable domain are separated by at least the
   per-domain minimum interval (FR-003a).
3. Every request carries the identifying User-Agent (FR-002).
4. `robots.txt` is consulted per target; a disallowed target is skipped and
   recorded with its reason (FR-005, FR-008).
5. One check produces exactly one observation, including on failure (FR-012).
6. A failure of one target does not prevent the rest being checked (FR-023).
7. Nothing is retried harder for having failed (FR-006).
8. No page body, subresource, or screenshot is written to disk (FR-015).

Each of these has a test that fails if the guarantee is removed. Per the
constitution, the limits are the one thing that cannot regress unnoticed.

## Environment

No credentials, tokens, or API keys — for a target or for anything else (FR-007).
If a future change appears to need one for a target, that is a Principle II
violation and not a configuration problem.
