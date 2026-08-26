import type { DeepReading } from '../quality/deep-check.js';

/**
 * The gate on a deep quality reading.
 *
 * `validateObservation` guards the availability record for a reason worth
 * restating: the record is a published product about named public institutions,
 * so a row is admitted because it can be checked, never because our own code
 * produced it. A deep reading makes a *larger* claim from the same record — not
 * "the server answered" but "this is how the page behaved for a visitor" — so it
 * gets a gate of its own rather than inheriting trust.
 *
 * Three of the checks are the constitution written out literally: the emulation
 * must be present, because a duration with no stated screen and connection is
 * not comparable to anything (Principle V); no derived figure may appear,
 * because the record is the measured layer (005 D3); and no page content may
 * appear, because we store measurements of a site, not the site.
 */
const OUTCOMES = new Set(['measured', 'check_failed', 'skipped']);

const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/**
 * Fields that would put a conclusion where an observation belongs.
 *
 * `score` is here because it is exactly what the tool hands us and exactly what
 * must not be kept: a weighted composite whose weighting is the tool's, not a
 * thing that was measured.
 */
const DERIVED_FIELDS = ['score', 'scores', 'grade', 'rating', 'rank', 'categories', 'passing'];

/** Fields that would persist the page instead of a measurement of it. */
const CONTENT_FIELDS = ['body', 'html', 'screenshot', 'content', 'subresources', 'dom'];

function validateDevice(device: unknown): string[] {
  if (typeof device !== 'object' || device === null) return ['method.device is required'];
  const d = device as Record<string, unknown>;
  const problems: string[] = [];
  if (typeof d['form_factor'] !== 'string' || d['form_factor'] === '') {
    problems.push('method.device.form_factor is required');
  }
  for (const field of ['width', 'height', 'scale'] as const) {
    if (typeof d[field] !== 'number') problems.push(`method.device.${field} must be a number`);
  }
  if (typeof d['mobile'] !== 'boolean') problems.push('method.device.mobile must be a boolean');
  return problems;
}

function validateNetwork(network: unknown): string[] {
  if (typeof network !== 'object' || network === null) return ['method.network is required'];
  const n = network as Record<string, unknown>;
  const problems: string[] = [];
  for (const field of ['rtt_ms', 'throughput_kbps', 'cpu_slowdown'] as const) {
    if (typeof n[field] !== 'number') problems.push(`method.network.${field} must be a number`);
  }
  if (typeof n['method'] !== 'string' || n['method'] === '') {
    problems.push('method.network.method must name how throttling was applied');
  }
  return problems;
}

function validateMethod(method: unknown): string[] {
  if (typeof method !== 'object' || method === null) return ['method is required'];
  const m = method as Record<string, unknown>;
  const problems: string[] = [];
  for (const field of ['tool', 'tool_version', 'preset', 'vantage'] as const) {
    if (typeof m[field] !== 'string' || m[field] === '') problems.push(`method.${field} is required`);
  }
  if (m['source'] !== 'self_run') problems.push('method.source must be self_run');
  problems.push(...validateDevice(m['device']), ...validateNetwork(m['network']));
  return problems;
}

function validateMetrics(metrics: unknown, outcome: unknown): string[] {
  if (typeof metrics !== 'object' || metrics === null) return ['metrics is required'];
  const entries = Object.entries(metrics as Record<string, unknown>);

  if (outcome !== 'measured' && entries.length > 0) {
    return [`a ${String(outcome)} reading must carry no metrics — it did not measure anything`];
  }

  const problems: string[] = [];
  for (const [name, metric] of entries) {
    if (typeof metric !== 'object' || metric === null) {
      problems.push(`metrics.${name} must be a value with its unit`);
      continue;
    }
    const m = metric as Record<string, unknown>;
    // A string that looks like a number is the classic way a unit-less quantity
    // enters a record and is silently compared against a real one later.
    if (typeof m['value'] !== 'number' || !Number.isFinite(m['value'])) {
      problems.push(`metrics.${name}.value must be a finite number`);
    }
    if (typeof m['unit'] !== 'string' || m['unit'] === '') {
      problems.push(`metrics.${name}.unit is required — a bare number is not a measurement`);
    }
  }
  return problems;
}

/** Returns a list of problems; an empty list means the reading may be stored. */
export function validateQualityReading(record: unknown): string[] {
  const problems: string[] = [];
  if (typeof record !== 'object' || record === null) return ['reading is not an object'];
  const r = record as Record<string, unknown>;

  for (const field of ['schema', 'run_id', 'target_id', 'host', 'url'] as const) {
    if (typeof r[field] !== 'string' || r[field] === '') problems.push(`${field} is required`);
  }

  if (r['dimension'] !== 'quality') problems.push('dimension must be "quality"');

  if (typeof r['checked_at'] !== 'string' || !UTC_TIMESTAMP.test(r['checked_at'] as string)) {
    problems.push('checked_at must be a UTC timestamp ending in Z');
  }

  // The availability outcomes are deliberately not accepted here. A tool that
  // could not render a page has learned nothing about whether the site was up,
  // and a record that let it say so would be publishing an inference as a
  // measurement (FR-324).
  if (typeof r['outcome'] !== 'string' || !OUTCOMES.has(r['outcome'] as string)) {
    problems.push(`outcome must be one of: ${[...OUTCOMES].join(', ')}`);
  }

  if (r['outcome'] === 'check_failed' && (typeof r['check_failure'] !== 'string' || r['check_failure'] === '')) {
    problems.push('a check_failed reading must record why the check produced nothing');
  }

  if (r['outcome'] === 'measured' && 'check_failure' in r) {
    problems.push('check_failure must be absent when the check produced a reading');
  }

  if (r['outcome'] === 'skipped' && (typeof r['skip_reason'] !== 'string' || r['skip_reason'] === '')) {
    problems.push('a skipped reading must record why no check was attempted');
  }

  for (const field of DERIVED_FIELDS) {
    if (field in r) {
      problems.push(
        `${field} is a derived figure — the record holds what was measured, and analysis publishes its own rule (D3)`,
      );
    }
  }

  for (const field of CONTENT_FIELDS) {
    if (field in r) problems.push(`${field} would persist page content rather than a measurement of it`);
  }

  problems.push(...validateMetrics(r['metrics'], r['outcome']));
  problems.push(...validateMethod(r['method']));

  return problems;
}

export function assertValidQualityReading(reading: DeepReading): void {
  const problems = validateQualityReading(reading);
  if (problems.length > 0) {
    throw new Error(`invalid quality reading: ${problems.join('; ')}`);
  }
}
