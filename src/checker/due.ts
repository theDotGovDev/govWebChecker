/**
 * Whether enough time has passed since the last reading to take another.
 *
 * This is the cadence floor, and it lives here rather than in a cron because
 * GitHub's scheduler cannot hold one. Scheduled events are *delayed* rather than
 * discarded — a `41 5 * * *` run was observed starting at 16:46, eleven hours
 * late — and GitHub keeps only one pending run per workflow, so a delay longer
 * than the period collapses the backlog: eleven pending hourly runs become one.
 * An hourly cron therefore degrades to roughly one run per delay-period, which is
 * how twenty-four scheduled checks a day became three.
 *
 * The answer is several workflows, each with its own schedule queue, which means
 * more runs arrive than the cadence calls for and some arrive bunched as a
 * backlog drains. That is only safe if something decides, per run, whether to
 * actually send traffic. So the floor moves into the code, where it cannot be
 * forgotten — the same promotion the per-address limit got when it turned out to
 * hold only within one process: a guarantee made durable by reading the record.
 *
 * There is deliberately no flag to bypass it. A limit a caller can turn off is a
 * limit a caller will forget, and this one bounds traffic to government servers.
 */

/** Only the fields the decision reads. Any record row satisfies this. */
export interface CheckedRow {
  host: string;
  checked_at: string;
}

/**
 * The floor, deliberately under an hour.
 *
 * A run arriving a little early on its hourly slot must still do its work; a
 * floor of a full hour would turn ordinary jitter into a skipped hour and
 * silently halve the cadence. Five minutes of headroom is enough for the
 * scheduling spread we actually see without letting two readings land close
 * enough to be near-duplicates of one another (FR-011a).
 */
export const MIN_CHECK_INTERVAL_MS = 55 * 60_000;

export interface DueVerdict {
  due: boolean;
  /** Expected versus actual, for the run log. A bare verdict is not evidence. */
  reason: string;
}

function human(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`;
}

/**
 * `hosts` is the set about to be checked, so `--only` narrows the floor with it:
 * another host's freshness says nothing about whether this one is due.
 *
 * The newest reading governs rather than the oldest. Runs are all-or-nothing —
 * every host is checked together or none is — so one host read recently means
 * the run just happened, and a stale sibling does not license a burst.
 *
 * A row's tier is deliberately not consulted. The census and the hourly check
 * can reach the same host, and traffic is traffic whichever collector sent it.
 */
export function dueForCheck(
  rows: CheckedRow[],
  hosts: string[],
  now: number,
  minIntervalMs: number = MIN_CHECK_INTERVAL_MS,
): DueVerdict {
  const wanted = new Set(hosts);
  let newest = -Infinity;
  for (const row of rows) {
    if (!wanted.has(row.host)) continue;
    const at = Date.parse(row.checked_at);
    if (Number.isFinite(at) && at > newest) newest = at;
  }

  if (newest === -Infinity) {
    return { due: true, reason: 'no previous reading for these hosts' };
  }

  // A future timestamp is clock skew, not an ancient reading. Math.min keeps it
  // from reading as a huge elapsed time and opening the floor.
  const elapsed = Math.max(0, now - newest);
  if (elapsed >= minIntervalMs) {
    return { due: true, reason: `last reading ${human(elapsed)} ago, floor ${human(minIntervalMs)}` };
  }
  return {
    due: false,
    reason: `last reading ${human(elapsed)} ago, floor ${human(minIntervalMs)} — nothing sent`,
  };
}
