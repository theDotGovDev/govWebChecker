export interface TrafficEvidence {
  /** Where the measurement came from. */
  source: string;
  /** What was measured, in that source's own terms. */
  measure: string;
  visits?: number;
  period?: string;
}

export interface Target {
  /** Stable and never reused, so history survives a host rename. */
  id: string;
  host: string;
  /** The exact URL checked. Rate limiting keys on the host; measurement is of a URL. */
  url: string;
  agency: string;
  /**
   * The operating unit within the agency, where the registry names one — NOAA
   * under Commerce, IRS under Treasury. The department is who is accountable;
   * the suborganization is who the public recognizes, and both are worth having.
   */
  suborganization?: string;
  /** `federal` today. Present from the start so widening scope adds rows, not columns. */
  jurisdiction: string;
  inclusion_reason: string;
  traffic_evidence: TrafficEvidence;
  /** Set when the traffic source aggregates differently than we measure (FR-001a). */
  traffic_unit_mismatch?: string;
  active: boolean;
}

const REQUIRED_STRINGS = ['id', 'host', 'url', 'agency', 'jurisdiction', 'inclusion_reason'] as const;

/**
 * Parses and validates the target list.
 *
 * Validation is strict about two fields in particular. `inclusion_reason` and
 * `traffic_evidence` are what make target selection traceable rather than
 * editorial — when the output is public commentary on named agencies, nobody
 * should be able to argue we picked the targets to make a point (FR-001, FR-001a).
 */
export function parseTargets(json: string): Target[] {
  const parsed: unknown = JSON.parse(json);
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !Array.isArray((parsed as { targets?: unknown }).targets)
  ) {
    throw new Error('target list must be an object with a "targets" array');
  }

  const rows = (parsed as { targets: unknown[] }).targets;
  const targets: Target[] = [];
  const seen = new Set<string>();

  rows.forEach((row, index) => {
    if (typeof row !== 'object' || row === null) throw new Error(`target ${index} is not an object`);
    const t = row as Record<string, unknown>;

    for (const field of REQUIRED_STRINGS) {
      if (typeof t[field] !== 'string' || t[field] === '') {
        throw new Error(`target ${index}: ${field} is required`);
      }
    }

    const evidence = t['traffic_evidence'];
    if (typeof evidence !== 'object' || evidence === null) {
      throw new Error(
        `target ${index} (${String(t['id'])}): traffic_evidence is required — ` +
          'targets are selected by measured traffic, not by editorial judgement',
      );
    }
    const e = evidence as Record<string, unknown>;
    for (const field of ['source', 'measure'] as const) {
      if (typeof e[field] !== 'string' || e[field] === '') {
        throw new Error(`target ${index}: traffic_evidence.${field} is required`);
      }
    }

    if (typeof t['active'] !== 'boolean') throw new Error(`target ${index}: active is required`);

    const id = t['id'] as string;
    if (seen.has(id)) throw new Error(`duplicate target id: ${id}`);
    seen.add(id);

    const host = t['host'] as string;
    let urlHost: string;
    try {
      urlHost = new URL(t['url'] as string).hostname;
    } catch {
      throw new Error(`target ${index} (${id}): url is not a valid URL`);
    }
    if (urlHost !== host) {
      throw new Error(`target ${index} (${id}): host "${host}" disagrees with url host "${urlHost}"`);
    }

    targets.push({
      id,
      host,
      url: t['url'] as string,
      agency: t['agency'] as string,
      jurisdiction: t['jurisdiction'] as string,
      inclusion_reason: t['inclusion_reason'] as string,
      traffic_evidence: {
        source: e['source'] as string,
        measure: e['measure'] as string,
        ...(typeof e['visits'] === 'number' ? { visits: e['visits'] } : {}),
        ...(typeof e['period'] === 'string' ? { period: e['period'] } : {}),
      },
      ...(typeof t['suborganization'] === 'string' && t['suborganization'] !== ''
        ? { suborganization: t['suborganization'] }
        : {}),
      ...(typeof t['traffic_unit_mismatch'] === 'string'
        ? { traffic_unit_mismatch: t['traffic_unit_mismatch'] }
        : {}),
      active: t['active'] as boolean,
    });
  });

  return targets;
}

/**
 * The targets a run checks. Retired targets stay in the list — their history
 * remains readable — but receive no traffic (FR-001, SC-005).
 */
export function activeTargets(targets: Target[]): Target[] {
  return targets.filter((t) => t.active);
}
