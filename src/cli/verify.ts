import fs from 'node:fs/promises';
import { registrableDomain } from '../politeness/domain.js';
import { validateObservation } from '../record/validate.js';
import type { Observation } from '../record/types.js';

export interface VerifyLimits {
  hostIntervalMs: number;
  domainIntervalMs: number;
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
export async function verifyRecord(file: string, limits: VerifyLimits): Promise<VerifyReport> {
  const text = await fs.readFile(file, 'utf8');
  const lines = text.trimEnd().split('\n').filter((l) => l.trim() !== '');
  const rows: Observation[] = lines.map((line) => JSON.parse(line) as Observation);

  const checks: VerifyCheck[] = [
    spacingCheck('per-host spacing', rows, limits.hostIntervalMs, (r) => r.host),
    spacingCheck('per-domain spacing', rows, limits.domainIntervalMs, (r) => registrableDomain(r.host)),
    methodCheck(rows),
    futureTimestampCheck(rows),
    orderingCheck(rows),
    validityCheck(rows),
  ];

  return { ok: checks.every((c) => c.pass), checks, rows: rows.length };
}

function timestamp(row: Observation): number {
  return Date.parse(row.checked_at);
}

function spacingCheck(
  name: string,
  rows: Observation[],
  requiredMs: number,
  key: (row: Observation) => string,
): VerifyCheck {
  let smallest = Infinity;
  let where = '';
  const lastSeen = new Map<string, number>();

  for (const row of [...rows].sort((a, b) => timestamp(a) - timestamp(b))) {
    // A skipped target generated no request to the site, so it cannot have
    // violated spacing.
    if (row.outcome === 'skipped') continue;
    const k = key(row);
    const previous = lastSeen.get(k);
    if (previous !== undefined) {
      const gap = timestamp(row) - previous;
      if (gap < smallest) {
        smallest = gap;
        where = k;
      }
    }
    lastSeen.set(k, timestamp(row));
  }

  if (smallest === Infinity) {
    return { name, pass: true, detail: `no repeated key to compare (required ${requiredMs}ms)` };
  }
  return {
    name,
    pass: smallest >= requiredMs,
    detail: `min observed ${smallest}ms on ${where}, required ${requiredMs}ms`,
  };
}

function methodCheck(rows: Observation[]): VerifyCheck {
  const missing = rows.filter((r) => !r.method).length;
  return {
    name: 'method on every row',
    pass: missing === 0,
    detail: `${rows.length - missing}/${rows.length} rows carry their method`,
  };
}

function futureTimestampCheck(rows: Observation[]): VerifyCheck {
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
function orderingCheck(rows: Observation[]): VerifyCheck {
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
