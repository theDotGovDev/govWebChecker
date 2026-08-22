import { createHash } from 'node:crypto';
import { sliceOf } from './slice.js';

/**
 * The census frame: what exists to be checked.
 *
 * Generated from the published registry, never hand-edited, and committed — so a
 * reader can tell "not checked" from "not registered at the time" by reading git
 * history (FR-104). Git is the snapshot store; no per-cycle copy of the registry
 * is kept, because git already answers what the frame looked like at any past
 * moment and 16,535 rows per cycle would be tens of megabytes a year spent
 * answering it twice.
 */

export interface RegistryEntry {
  domain: string;
  type: string;
  organization: string;
  city: string;
  state: string;
}

export interface FrameEntry extends RegistryEntry {
  slice: number;
}

export interface Exclusion {
  domain: string;
  since: string;
  reason: string;
}

export interface Frame {
  source: string;
  retrieved_at: string;
  digest: string;
  domains: FrameEntry[];
}

export interface BuildFrameInput {
  csv: string;
  exclusions: Exclusion[];
  retrievedAt: string;
  source?: string;
  /** The frame being replaced, when there is one. Used only for the size guard. */
  previous?: { size: number };
}

export const DEFAULT_SOURCE =
  'https://raw.githubusercontent.com/cisagov/dotgov-data/main/current-full.csv';

/**
 * How much smaller a new frame may be before the build refuses.
 *
 * A truncated download produces a small frame, and a small frame produces a cycle
 * that reads as a coverage collapse across US government rather than as a failed
 * HTTP request on our side. That is the same class of error as the run from a
 * sandbox with broken egress which would have asserted that federal agencies
 * refuse automated traffic — and it is caught the same way, by refusing to
 * publish rather than by hoping someone notices the number.
 *
 * The tolerance is generous because domains genuinely are retired. The guard is
 * against a collapse, not against ordinary drift, or it would block the very
 * refresh it exists to protect.
 */
const MAX_SHRINK = 0.2;

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

/**
 * Reads the published registry.
 *
 * The registry's `type` is kept verbatim. The DNS survey found sixteen distinct
 * values, not the six first assumed — the Federal branches are separate, school
 * and special districts exist alongside city and county, and five types carry an
 * `- Election` variant. Normalising them here would silently decide what
 * comparisons a reader is able to make, which is a presentation choice and not
 * one the frame gets to make on their behalf.
 */
export function parseRegistry(csv: string): RegistryEntry[] {
  return csv
    .split(/\r?\n/)
    .slice(1)
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [domain, type, , organization, city, state] = splitCsvLine(line);
      return {
        domain: (domain ?? '').toLowerCase().replace(/\.$/, ''),
        type: type || 'Unknown',
        organization: organization ?? '',
        city: city ?? '',
        state: state ?? '',
      };
    })
    .filter((e) => e.domain !== '');
}

/**
 * The frame's identity: its domain list and nothing else.
 *
 * Deliberately independent of when it was fetched and of the order the registry
 * happened to list domains in. A cycle is complete when seven slices ran against
 * the same digest, so a digest that moved on every refresh would mean no cycle
 * ever looked complete.
 */
export function frameDigest(
  frame: Pick<Frame, 'domains'>,
  options: { verifySlices?: boolean } = {},
): string {
  if (options.verifySlices) {
    for (const entry of frame.domains) {
      if (entry.slice !== sliceOf(entry.domain)) {
        // Cannot happen unless the hash changed — in which case every historical
        // slice claim is wrong, and stopping is the only honest response.
        throw new Error(
          `frame slice for ${entry.domain} is ${entry.slice} but hashes to ` +
            `${sliceOf(entry.domain)} — the slice function changed, and every ` +
            'coverage claim already published is now wrong',
        );
      }
    }
  }
  const names = frame.domains.map((d) => d.domain).sort();
  return `sha256:${createHash('sha256').update(names.join('\n')).digest('hex')}`;
}

export function buildFrame(input: BuildFrameInput): Frame {
  const excluded = new Set(input.exclusions.map((e) => e.domain.toLowerCase()));
  const entries = parseRegistry(input.csv).filter((e) => !excluded.has(e.domain));

  if (entries.length === 0) {
    throw new Error(
      'refusing to write an empty frame — a registry that parsed to nothing is a ' +
        'failed download, not a government that stopped registering domains',
    );
  }

  if (input.previous !== undefined && input.previous.size > 0) {
    const floor = input.previous.size * (1 - MAX_SHRINK);
    if (entries.length < floor) {
      throw new Error(
        `refusing to write a frame of ${entries.length} domains, more than ` +
          `${MAX_SHRINK * 100}% smaller than the ${input.previous.size} it replaces. ` +
          'A truncated download publishes as a coverage collapse across US ' +
          'government rather than as our own failed request',
      );
    }
  }

  const domains: FrameEntry[] = entries
    .map((e) => ({ ...e, slice: sliceOf(e.domain) }))
    .sort((a, b) => a.domain.localeCompare(b.domain));

  return {
    source: input.source ?? DEFAULT_SOURCE,
    retrieved_at: input.retrievedAt,
    digest: frameDigest({ domains }),
    domains,
  };
}

/** The domains one run is responsible for. */
export function domainsInSlice(frame: Frame, slice: number): FrameEntry[] {
  return frame.domains.filter((d) => d.slice === slice);
}
