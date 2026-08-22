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

const TIERS = new Set(['hot', 'broad']);
const RESOLUTION_STATUSES = new Set([
  'address',
  'mail_only',
  'no_service',
  'nxdomain',
  'resolver_error',
]);
const PRESENCE_STATES = new Set(['website', 'no_website', 'undetermined']);
/** One seventh of the frame per run, so a domain belongs to exactly one of these. */
const SLICES = 7;

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

  // Optional, but an empty string would silently join every address-less row
  // into one bogus cluster when `verify` checks backend spacing.
  if ('address' in r && (typeof r['address'] !== 'string' || r['address'] === '')) {
    problems.push('address must be a non-empty string when present');
  }

  problems.push(...validateLatency(r['latency']));
  problems.push(...validateMethod(r['method']));
  problems.push(...validateCensus(r));

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

/**
 * The census fields.
 *
 * All optional — the record is append-only, so rows written before this feature
 * stay valid without being rewritten (FR-136, FR-142). Optional is not unchecked:
 * these fields exist to be read by someone who does not trust our code, and a
 * value outside its enumeration is one nobody can map back to an observation.
 */
function validateCensus(r: Record<string, unknown>): string[] {
  const problems: string[] = [];

  if ('tier' in r && (typeof r['tier'] !== 'string' || !TIERS.has(r['tier']))) {
    problems.push(`tier must be one of: ${[...TIERS].join(', ')}`);
  }

  if ('cycle' in r && (typeof r['cycle'] !== 'string' || r['cycle'] === '')) {
    problems.push('cycle must be a non-empty string when present');
  }

  if ('slice' in r) {
    const slice = r['slice'];
    if (typeof slice !== 'number' || !Number.isInteger(slice) || slice < 0 || slice >= SLICES) {
      problems.push(`slice must be an integer in 0..${SLICES - 1}`);
    }
  }

  if ('url_rule' in r && (typeof r['url_rule'] !== 'string' || r['url_rule'] === '')) {
    problems.push('url_rule must name the rule that produced the URL');
  }

  if ('resolution' in r) {
    const res = r['resolution'];
    if (typeof res !== 'object' || res === null) {
      problems.push('resolution must be an object when present');
    } else {
      const v = res as Record<string, unknown>;
      if (typeof v['status'] !== 'string' || !RESOLUTION_STATUSES.has(v['status'])) {
        problems.push(`resolution.status must be one of: ${[...RESOLUTION_STATUSES].join(', ')}`);
      }
      for (const form of ['apex', 'www'] as const) {
        if (typeof v[form] !== 'boolean') problems.push(`resolution.${form} must be a boolean`);
      }
    }
  }

  if ('presence' in r) {
    const pres = r['presence'];
    if (typeof pres !== 'object' || pres === null) {
      problems.push('presence must be an object when present');
    } else {
      const v = pres as Record<string, unknown>;
      if (typeof v['state'] !== 'string' || !PRESENCE_STATES.has(v['state'])) {
        problems.push(`presence.state must be one of: ${[...PRESENCE_STATES].join(', ')}`);
      }
      // Without the version a reading cannot be superseded, and FR-119's promise
      // that a better rule can be applied to history is void.
      if (typeof v['rule'] !== 'string' || v['rule'] === '') {
        problems.push('presence.rule must name the rule version that produced the reading');
      }
    }
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
