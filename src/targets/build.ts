import type { Target } from './load.js';
import { registrableDomain } from '../politeness/domain.js';

export interface TrafficRow {
  domain: string;
  visits: number;
}

export interface RegistryRow {
  domain: string;
  /** e.g. "Federal - Executive", "City", "State". */
  type: string;
  organization: string;
  suborganization: string;
}

export interface BuildOptions {
  limit: number;
  /**
   * Registrable domain to agency, for federal properties the `.gov` registry
   * cannot attribute because they do not use a `.gov` domain. Hand-maintained
   * and reviewable — the alternative is either a target with no accountable
   * owner or dropping some of the highest-traffic federal sites entirely.
   */
  overrides: Record<string, string>;
  /**
   * The list being replaced, if any. A host already present keeps its id, so
   * regeneration never orphans the observations that join on it.
   */
  existing?: Target[];
}

export interface Excluded {
  host: string;
  reason: string;
}

export interface BuildResult {
  targets: Target[];
  /** Every host considered but not included, with why. Never silent. */
  unmatched: Excluded[];
}

const TRAFFIC_SOURCE = 'analytics.usa.gov/data/live/sites.csv';
const REGISTRY_SOURCE = 'cisagov/dotgov-data current-federal.csv';

/** Splits one CSV line, honoring double-quoted fields that contain commas. */
function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields.map((f) => f.trim());
}

function dataLines(csv: string): string[] {
  return csv
    .split(/\r?\n/)
    .slice(1)
    .filter((line) => line.trim() !== '');
}

/**
 * Reads the published traffic file, preserving its order — the file is already
 * ranked by visits, and re-sorting would invite a subtle disagreement with the
 * source we are citing as evidence.
 */
export function parseTrafficCsv(csv: string): TrafficRow[] {
  const rows: TrafficRow[] = [];
  for (const line of dataLines(csv)) {
    const [domain, visits] = splitCsvLine(line);
    if (!domain) continue;
    const count = Number(visits);
    // A row we cannot read is dropped rather than guessed at. Inventing a number
    // here would put a fabricated figure into traffic_evidence.
    if (visits === undefined || visits === '' || !Number.isFinite(count)) continue;
    rows.push({ domain, visits: count });
  }
  return rows;
}

export function parseRegistryCsv(csv: string): RegistryRow[] {
  const rows: RegistryRow[] = [];
  for (const line of dataLines(csv)) {
    const [domain, type, organization, suborganization] = splitCsvLine(line);
    if (!domain) continue;
    rows.push({
      domain: domain.toLowerCase(),
      type: type ?? '',
      organization: organization ?? '',
      suborganization: suborganization ?? '',
    });
  }
  return rows;
}

function toId(host: string): string {
  return host
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Builds the target list from measured traffic, attributing each host to an
 * accountable agency.
 *
 * Hosts are kept distinct rather than collapsed by agency. `tools.usps.com` and
 * `usps.com` are two measurements of two hosts; whether they are one "website"
 * is a grouping question answered later, against a mapping that can be revised
 * without touching a single stored observation.
 *
 * Nothing is dropped quietly. Every host considered and not included comes back
 * in `unmatched` with a reason, because a list that silently shrinks is a list
 * nobody can audit.
 */
export function buildTargets(
  traffic: TrafficRow[],
  registry: RegistryRow[],
  options: BuildOptions,
): BuildResult {
  const byDomain = new Map(registry.map((r) => [r.domain, r]));
  // A host keeps whatever id it was first given. Every stored observation joins
  // on that id, so re-deriving it would silently sever the series this project
  // exists to build — and the break would only show up as a site that
  // mysteriously has no history.
  const idForHost = new Map((options.existing ?? []).map((t) => [t.host, t.id]));
  const taken = new Set(idForHost.values());
  const targets: Target[] = [];
  const unmatched: Excluded[] = [];

  for (const row of traffic.slice(0, options.limit)) {
    const host = row.domain.toLowerCase();
    const domain = registrableDomain(host);
    const entry = byDomain.get(domain);
    const override = options.overrides[domain];

    let agency: string;
    let suborganization = '';
    if (entry && entry.type.startsWith('Federal')) {
      agency = entry.organization;
      suborganization = entry.suborganization;
    } else if (entry) {
      unmatched.push({ host, reason: `registry lists ${domain} as "${entry.type}", not federal` });
      continue;
    } else if (override) {
      agency = override;
    } else {
      unmatched.push({
        host,
        reason: `${domain} is not in the federal .gov registry and has no agency override`,
      });
      continue;
    }

    const rank = targets.length + unmatched.length + 1;
    let id = idForHost.get(host);
    if (id === undefined) {
      id = toId(host);
      // Only reachable when a previous list gave some other host this exact id.
      let suffix = 2;
      while (taken.has(id)) id = `${toId(host)}-${suffix++}`;
      taken.add(id);
    }

    targets.push({
      id,
      host,
      url: `https://${host}/`,
      agency,
      ...(suborganization ? { suborganization } : {}),
      jurisdiction: 'federal',
      inclusion_reason: `Rank ${rank} among federal sites by measured visits`,
      traffic_evidence: {
        source: TRAFFIC_SOURCE,
        // The published file states visits without naming its window, so no
        // window is claimed here. Citing a period we have not confirmed would be
        // exactly the unsourced precision Principle V forbids.
        measure: `visits as published; attribution from ${REGISTRY_SOURCE}`,
        visits: row.visits,
      },
      active: true,
    });
  }

  return { targets, unmatched };
}
