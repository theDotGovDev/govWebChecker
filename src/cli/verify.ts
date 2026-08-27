import fs from 'node:fs/promises';
import { registrableDomain } from '../politeness/domain.js';
import { validateObservation } from '../record/validate.js';
import { validateQualityReading } from '../record/quality.js';
import type { Observation } from '../record/types.js';
import type { DeepReading } from '../quality/deep-check.js';
import type { Frame } from '../census/frame.js';

export interface VerifyLimits {
  hostIntervalMs: number;
  domainIntervalMs: number;
  addressIntervalMs: number;
}

/**
 * One breach that is already in the append-only record.
 *
 * The record cannot be rewritten, so a violation that got committed stays
 * committed. `verify` gates publication, so without this an immutable bad pair
 * discards every honest reading taken after it — which is exactly what happened
 * on 2026-08-26, costing twenty hours of hourly readings.
 *
 * The shape is deliberately narrow. An acknowledgement names one check, one key
 * and the two exact timestamps, so it forgives that pair and nothing else. It
 * stays visible in the report rather than silencing the check, and it must match
 * a real pair or `verify` fails — so the list cannot be written ahead of a breach
 * or outlive the rows that justify it.
 *
 * This is the allow-marker pattern, not a disabled check: `cause` and `fixed_by`
 * are required because an acknowledgement with no fix behind it is just a
 * suppressed failure.
 */
export interface AcknowledgedBreach {
  /**
   * The record file this breach is in, repo-relative.
   *
   * A breach belongs to one record, so an acknowledgement travels with it.
   * Without this, pointing `verify` at any other file makes every entry stale
   * and fails a record that has nothing to do with it. The caller filters on
   * this; `verifyRecord` treats whatever it is handed as applying to the file
   * it was given.
   */
  record: string;
  /** The check this pair breached, e.g. `per-address spacing`. */
  check: string;
  /** The key the two rows shared — a host, a domain, or a backend address. */
  key: string;
  /** `checked_at` of the earlier row, verbatim. */
  earlier: string;
  /** `checked_at` of the later row, verbatim. */
  later: string;
  cause: string;
  fixed_by: string;
}

export interface VerifyCheck {
  name: string;
  pass: boolean;
  /** Expected versus actual, in numbers. A bare verdict is not evidence. */
  detail: string;
}

export interface VerifyReport {
  ok: boolean;
  checks: VerifyCheck[];
  rows: number;
}

/**
 * Checks a published record against the guarantees this project makes.
 *
 * The point is that it reads the *record*, never the code. Anyone can run the
 * equivalent against the published data and reach the same verdict without
 * trusting our implementation — which is what SC-002 and SC-012 promise.
 *
 * It checks our conduct, not the sites'. A record full of timeouts passes; a
 * record showing we hammered someone does not.
 */
export async function verifyRecord(
  file: string,
  limits: VerifyLimits,
  frame?: Frame,
  acknowledged: AcknowledgedBreach[] = [],
): Promise<VerifyReport> {
  const text = await fs.readFile(file, 'utf8');
  const lines = text.trimEnd().split('\n').filter((l) => l.trim() !== '');
  const parsed: unknown[] = lines.map((line) => JSON.parse(line) as unknown);

  // A quality record is a different record answering a different question, so it
  // is checked against its own contract rather than squeezed through the
  // availability one. Our conduct toward the server is the same question for
  // both, so those checks are shared.
  if (parsed.some((r) => (r as { dimension?: string }).dimension === 'quality')) {
    return verifyQualityRows(parsed as DeepReading[], limits, acknowledged);
  }

  const rows: Observation[] = parsed as Observation[];

  // Guard the shape before checking the substance. Pointed at a file of run
  // summaries — which have no host — the spacing checks used to throw a
  // TypeError, killing the workflow step that gates publication and discarding
  // a set of good measurements with it. A tool that decides whether data gets
  // published has to fail legibly or not at all.
  const shape = shapeCheck(rows);
  if (!shape.pass) return { ok: false, checks: [shape], rows: rows.length };

  const ledger = new BreachLedger(acknowledged);
  const checks: VerifyCheck[] = [
    shape,
    spacingCheck('per-host spacing', rows, limits.hostIntervalMs, (r) => r.host, ledger),
    spacingCheck('per-domain spacing', rows, limits.domainIntervalMs, (r) => registrableDomain(r.host), ledger),
    // The shared-hosting guarantee. Distinct registrable domains routinely share
    // one machine, so this is the only check that can catch a burst against a
    // vendor backend — both name-keyed checks above pass such a burst.
    spacingCheck('per-address spacing', rows, limits.addressIntervalMs, (r) => r.address ?? '', ledger),
    ...ledger.checks(),
    methodCheck(rows),
    vantageCheck(rows.map((r) => r.method?.vantage)),
    futureTimestampCheck(rows),
    orderingCheck(rows),
    validityCheck(rows),
    // Absence of a frame is absence of a question. `verify` runs against records
    // that predate the census, and inventing a failure for them would be reading
    // absence as zero.
    ...(frame ? [coverageCheck(rows, frame)] : []),
  ];

  return { ok: checks.every((c) => c.pass), checks, rows: rows.length };
}

/**
 * The gate on a published quality record.
 *
 * Every reading must be admissible under the record's own contract — which is
 * where the emulation requirement and the no-derived-figures rule live — and our
 * conduct while taking them must hold, checked from the file rather than from the
 * code that wrote it.
 */
function verifyQualityRows(
  rows: DeepReading[],
  limits: VerifyLimits,
  acknowledged: AcknowledgedBreach[] = [],
): VerifyReport {
  const conduct = rows as unknown as ConductRow[];
  const ledger = new BreachLedger(acknowledged);

  let invalid = 0;
  let firstProblem = '';
  rows.forEach((row, index) => {
    const problems = validateQualityReading(row);
    if (problems.length > 0) {
      invalid++;
      if (!firstProblem) firstProblem = `row ${index + 1}: ${problems[0]}`;
    }
  });

  const checks: VerifyCheck[] = [
    {
      name: 'readings match the quality contract',
      pass: invalid === 0,
      detail: invalid === 0 ? `${rows.length}/${rows.length} valid` : firstProblem,
    },
    vantageCheck(rows.map((r) => r.method?.vantage)),
    spacingCheck('per-host spacing', conduct, limits.hostIntervalMs, (r) => r.host, ledger),
    spacingCheck('per-domain spacing', conduct, limits.domainIntervalMs, (r) => registrableDomain(r.host), ledger),
    ...ledger.checks(),
    futureTimestampCheck(conduct),
    orderingCheck(conduct),
  ];

  return { ok: checks.every((c) => c.pass), checks, rows: rows.length };
}

/**
 * Where the reading was taken from — and whether that is somewhere it may be
 * taken from at all.
 *
 * The shape checks cannot catch this, and until now nothing did. A run from a
 * development sandbox writes into `data/`, satisfies every other guarantee, and
 * is committable. `vantage()` labels such rows `local` rather than
 * `github-actions/*`, so the record was at least honest about it — but a
 * measurement taken from an ephemeral container describes that container's
 * network, resolver and CPU rather than the target, and publishing it would put
 * a claim about a named public institution behind a number that measured us.
 *
 * Working egress makes this more dangerous, not less: a broken sandbox fails
 * loudly, while an unrestricted one produces readings that look entirely healthy.
 */
function vantageCheck(vantages: (string | undefined)[]): VerifyCheck {
  const offending = new Map<string, number>();
  for (const vantage of vantages) {
    if (vantage === undefined || vantage === '' || !vantage.startsWith('github-actions/')) {
      const label = vantage === undefined || vantage === '' ? '(none)' : vantage;
      offending.set(label, (offending.get(label) ?? 0) + 1);
    }
  }
  const listed = [...offending].map(([v, n]) => `${n}x ${v}`).join(', ');
  return {
    name: 'every reading taken from a durable vantage',
    pass: offending.size === 0,
    detail:
      offending.size === 0
        ? `${vantages.length}/${vantages.length} taken in GitHub Actions`
        : `${listed} — a reading from anywhere else measures that machine, not the target`,
  };
}

/** Is this an observation record at all? */
function shapeCheck(rows: Observation[]): VerifyCheck {
  const name = 'file is an observation record';
  if (rows.length === 0) {
    return { name, pass: true, detail: 'empty file, nothing to check' };
  }

  const usable = rows.filter(
    (r) => typeof r?.host === 'string' && typeof r?.target_id === 'string' && typeof r?.checked_at === 'string',
  ).length;

  if (usable === rows.length) return { name, pass: true, detail: `${rows.length} observation rows` };

  const looksLikeRuns = rows.some(
    (r) => (r as unknown as { run_id?: unknown; targets_attempted?: unknown }).targets_attempted !== undefined,
  );

  return {
    name,
    pass: false,
    detail: looksLikeRuns
      ? 'this is a run-summary file, not an observation record — verify expects data/<dimension>/'
      : `${rows.length - usable}/${rows.length} rows lack host, target_id, or checked_at`,
  };
}

function timestamp(row: ConductRow): number {
  return Date.parse(row.checked_at);
}

/**
 * The parts of a row the conduct checks need.
 *
 * Availability observations and deep quality readings are different records
 * answering different questions, but our conduct toward a server is the same
 * question for both: when did we ask, and how close together. So the spacing,
 * ordering and timestamp checks read this much and no more.
 */
interface ConductRow {
  host: string;
  target_id: string;
  checked_at: string;
  outcome: string;
  address?: string;
}

/**
 * The acknowledged breaches, and whether each one still describes a real pair.
 *
 * Kept as an object rather than a bare list because the two halves have to stay
 * together: a spacing check consults it to forgive a pair, and the same instance
 * then reports which acknowledgements went unused. Splitting those apart is how
 * an exemption list rots into a blanket exemption.
 */
class BreachLedger {
  readonly #entries: AcknowledgedBreach[];
  readonly #matched = new Set<AcknowledgedBreach>();

  constructor(entries: AcknowledgedBreach[]) {
    this.#entries = entries;
  }

  /** True if this exact pair is acknowledged. Records the match. */
  forgives(check: string, key: string, earlier: string, later: string): boolean {
    const hit = this.#entries.find(
      (e) => e.check === check && e.key === key && e.earlier === earlier && e.later === later,
    );
    if (hit === undefined) return false;
    this.#matched.add(hit);
    return true;
  }

  /**
   * Empty when nothing is acknowledged, so a record with no exemptions reads
   * exactly as it did before this existed.
   */
  checks(): VerifyCheck[] {
    if (this.#entries.length === 0) return [];
    const stale = this.#entries.filter((e) => !this.#matched.has(e));
    const named = stale.map((e) => `${e.check} on ${e.key} at ${e.later}`).join('; ');
    return [
      {
        name: 'every acknowledged breach is in the record',
        pass: stale.length === 0,
        detail:
          stale.length === 0
            ? `${this.#entries.length}/${this.#entries.length} match a pair in this file`
            : `${stale.length} forgive nothing here — ${named}`,
      },
    ];
  }
}

function spacingCheck(
  name: string,
  rows: ConductRow[],
  requiredMs: number,
  key: (row: ConductRow) => string,
  ledger: BreachLedger,
): VerifyCheck {
  let smallest = Infinity;
  let where = '';
  let forgiven = 0;
  const lastSeen = new Map<string, { at: number; iso: string }>();

  for (const row of [...rows].sort((a, b) => timestamp(a) - timestamp(b))) {
    // A skipped target generated no request to the site, so it cannot have
    // violated spacing.
    if (row.outcome === 'skipped') continue;
    const k = key(row);
    // An absent key is unknown, not shared. Grouping every row whose backend we
    // could not establish would invent a violation out of missing data — the
    // same error as reading absence as zero (Principle V).
    if (k === '') continue;
    const previous = lastSeen.get(k);
    if (previous !== undefined) {
      const gap = timestamp(row) - previous.at;
      // Forgiven only when this exact pair is named. The gap is still walked past
      // rather than dropped, so the *next* row is spaced from this one and a
      // second breach behind an acknowledged one is still found.
      if (gap < requiredMs && ledger.forgives(name, k, previous.iso, row.checked_at)) {
        forgiven++;
      } else if (gap < smallest) {
        smallest = gap;
        where = k;
      }
    }
    lastSeen.set(k, { at: timestamp(row), iso: row.checked_at });
  }

  const note = forgiven === 0 ? '' : `, ${forgiven} acknowledged`;
  if (smallest === Infinity) {
    return {
      name,
      pass: true,
      detail: `no repeated key to compare (required ${requiredMs}ms)${note}`,
    };
  }
  return {
    name,
    pass: smallest >= requiredMs,
    detail: `min observed ${smallest}ms on ${where}, required ${requiredMs}ms${note}`,
  };
}

/**
 * Did each slice that ran reach every domain it owned, and how much of the cycle
 * has run so far?
 *
 * Computed from the observations and the committed frame, never from our own run
 * summaries. SC-102 promises a reader can answer this holding only the record —
 * a coverage claim checked against our own account of what we did would be us
 * marking our own homework.
 *
 * Coverage is judged against the slices the record shows ran, not against the
 * whole frame. A cycle takes seven days, so judging day one against all seven
 * slices would name thousands of domains as missed when they are merely not yet
 * due — reading "not yet" as "never came", which is the same error as reading a
 * domain that publishes no website as a broken one. How much of the cycle has run
 * is reported alongside, so an incomplete cycle is never mistaken for a complete
 * one either.
 *
 * Naming the missing domains is the part that matters. A count alone leaves a gap
 * uninvestigable, and an uninvestigable gap is indistinguishable from a
 * jurisdiction that vanished.
 */
function coverageCheck(rows: Observation[], frame: Frame): VerifyCheck {
  const slicesInFrame = new Set(frame.domains.map((d) => d.slice));
  const byCycle = new Map<string, { covered: Set<string>; slices: Set<number> }>();

  for (const row of rows) {
    // Hot-tier rows check curated hosts on a different cadence. Counting them
    // would inflate coverage with domains the census never reached.
    if (row.tier !== 'broad' || row.cycle === undefined || row.slice === undefined) continue;
    let entry = byCycle.get(row.cycle);
    if (entry === undefined) {
      entry = { covered: new Set(), slices: new Set() };
      byCycle.set(row.cycle, entry);
    }
    entry.covered.add(row.target_id);
    entry.slices.add(row.slice);
  }

  if (byCycle.size === 0) {
    return {
      name: 'census coverage',
      pass: true,
      detail: `no census observations to check against a frame of ${frame.domains.length}`,
    };
  }

  const lines: string[] = [];
  let pass = true;
  for (const [cycle, { covered, slices }] of [...byCycle.entries()].sort()) {
    const due = frame.domains.filter((d) => slices.has(d.slice)).map((d) => d.domain);
    const missing = due.filter((d) => !covered.has(d)).sort();
    if (missing.length > 0) pass = false;
    const named = missing.slice(0, 10).join(', ');
    const complete = slices.size === slicesInFrame.size;
    lines.push(
      `${cycle}: ${slices.size}/${slicesInFrame.size} slices` +
        (complete ? '' : ' (in progress)') +
        `, ${due.length - missing.length}/${due.length} domains` +
        (missing.length > 0
          ? ` — missed ${missing.length}: ${named}${missing.length > 10 ? ', …' : ''}`
          : ''),
    );
  }

  return { name: 'census coverage', pass, detail: lines.join('; ') };
}

function methodCheck(rows: { method?: unknown }[]): VerifyCheck {
  const missing = rows.filter((r) => !r.method).length;
  return {
    name: 'method on every row',
    pass: missing === 0,
    detail: `${rows.length - missing}/${rows.length} rows carry their method`,
  };
}

function futureTimestampCheck(rows: ConductRow[]): VerifyCheck {
  const now = Date.now();
  const ahead = rows.filter((r) => timestamp(r) > now);
  const max = rows.reduce((m, r) => Math.max(m, timestamp(r)), 0);
  return {
    name: 'no future timestamps',
    pass: ahead.length === 0,
    detail: `${ahead.length} rows ahead of now; latest ${new Date(max).toISOString()}`,
  };
}

/**
 * Append-only ordering, checked per target rather than across the whole file.
 *
 * Different hosts are checked concurrently and appended as each finishes, so
 * rows across targets are legitimately interleaved and the file is NOT globally
 * chronological. A single target is checked serially, though, so its own rows
 * must never go backwards — and if they do, the file was reordered or rewritten,
 * which is the thing append-only actually forbids.
 *
 * Checking global monotonicity instead would fail every honest concurrent run.
 */
function orderingCheck(rows: ConductRow[]): VerifyCheck {
  const lastPerTarget = new Map<string, number>();
  let outOfOrder = 0;
  let example = '';

  for (const row of rows) {
    const previous = lastPerTarget.get(row.target_id);
    if (previous !== undefined && timestamp(row) < previous) {
      outOfOrder++;
      if (!example) example = row.target_id;
    }
    lastPerTarget.set(row.target_id, timestamp(row));
  }

  return {
    name: 'append-only ordering',
    pass: outOfOrder === 0,
    detail:
      outOfOrder === 0
        ? `${lastPerTarget.size} targets, each in order`
        : `${outOfOrder} rows go backwards within a target (e.g. ${example})`,
  };
}

function validityCheck(rows: Observation[]): VerifyCheck {
  let invalid = 0;
  let firstProblem = '';
  rows.forEach((row, index) => {
    const problems = validateObservation(row);
    if (problems.length > 0) {
      invalid++;
      if (!firstProblem) firstProblem = `row ${index + 1}: ${problems[0]}`;
    }
  });
  return {
    name: 'rows match the record contract',
    pass: invalid === 0,
    detail: invalid === 0 ? `${rows.length}/${rows.length} valid` : firstProblem,
  };
}

/** Renders the report as the verdict table the quickstart shows. */
export function formatReport(report: VerifyReport): string {
  const width = Math.max(...report.checks.map((c) => c.name.length));
  const lines = report.checks.map(
    (c) => `${c.name.padEnd(width)}  ${c.detail.padEnd(52)}  ${c.pass ? 'PASS' : 'FAIL'}`,
  );
  lines.push(
    '',
    `${report.rows} ${report.rows === 1 ? 'row' : 'rows'} checked — ` +
      `${report.ok ? 'all guarantees hold' : 'VIOLATIONS FOUND'}`,
  );
  return lines.join('\n');
}
