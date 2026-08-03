import type { Observation } from './types.js';

const OUTCOMES = new Set([
  'success',
  'http_error',
  'timeout',
  'connection_failure',
  'dns_failure',
  'tls_failure',
  'blocked',
  'skipped',
]);

/** Fields that would make the record assert a judgement instead of an observation. */
const VERDICT_FIELDS = ['up', 'down', 'healthy', 'grade', 'score', 'passing', 'conformant'];

/** Fields that would persist page content the constitution forbids storing. */
const CONTENT_FIELDS = ['body', 'html', 'screenshot', 'content', 'subresources'];

const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/**
 * Checks a record against `contracts/observation.md`. Returns a list of problems;
 * an empty list means the record is valid.
 *
 * This is not defensive programming against our own code — it is the gate that
 * keeps the stored record honest, so it enforces the constitution's rules as
 * literally as it enforces the shape.
 */
export function validateObservation(record: unknown): string[] {
  const problems: string[] = [];
  if (typeof record !== 'object' || record === null) return ['record is not an object'];
  const r = record as Record<string, unknown>;

  for (const field of ['schema', 'run_id', 'target_id', 'host', 'url', 'dimension'] as const) {
    if (typeof r[field] !== 'string' || r[field] === '') problems.push(`${field} is required`);
  }

  if (typeof r['checked_at'] !== 'string' || !UTC_TIMESTAMP.test(r['checked_at'])) {
    problems.push('checked_at must be a UTC timestamp ending in Z');
  }

  if (typeof r['outcome'] !== 'string' || !OUTCOMES.has(r['outcome'])) {
    problems.push(`outcome must be one of: ${[...OUTCOMES].join(', ')}`);
  }

  if (!Array.isArray(r['redirect_chain'])) problems.push('redirect_chain is required');

  problems.push(...validateLatency(r['latency']));
  problems.push(...validateMethod(r['method']));

  for (const field of VERDICT_FIELDS) {
    if (field in r) {
      problems.push(
        `${field} is a verdict, not an observation — the record stores what happened`,
      );
    }
  }

  for (const field of CONTENT_FIELDS) {
    if (field in r) problems.push(`${field} would persist page content (FR-015)`);
  }

  if (r['outcome'] === 'skipped' && typeof r['skip_reason'] !== 'string') {
    problems.push('a skipped observation must record why');
  }

  return problems;
}

function validateLatency(latency: unknown): string[] {
  if (typeof latency !== 'object' || latency === null) return ['latency is required'];
  const l = latency as Record<string, unknown>;

  if (typeof l['samples'] !== 'number' || l['samples'] < 0) return ['latency.samples is required'];

  if (l['samples'] === 0) {
    // Absence of data is shown as absence, never as zero (Principle V).
    for (const field of ['median_ms', 'min_ms', 'max_ms']) {
      if (field in l) {
        return [`latency.${field} must be absent when no sample succeeded, not zero`];
      }
    }
    return [];
  }

  const problems: string[] = [];
  for (const field of ['median_ms', 'min_ms', 'max_ms'] as const) {
    if (typeof l[field] !== 'number') problems.push(`latency.${field} is required when samples > 0`);
  }
  return problems;
}

function validateMethod(method: unknown): string[] {
  if (typeof method !== 'object' || method === null) {
    return ['method is required on every row — a figure without its method is unusable'];
  }
  const m = method as Record<string, unknown>;
  const problems: string[] = [];

  for (const field of ['vantage', 'tool_version', 'source'] as const) {
    if (typeof m[field] !== 'string' || m[field] === '') problems.push(`method.${field} is required`);
  }
  for (const field of ['timeout_ms', 'sample_count'] as const) {
    if (typeof m[field] !== 'number') problems.push(`method.${field} is required`);
  }
  return problems;
}

export function assertValidObservation(record: Observation): void {
  const problems = validateObservation(record);
  if (problems.length > 0) {
    throw new Error(`refusing to write an invalid observation:\n  - ${problems.join('\n  - ')}`);
  }
}
