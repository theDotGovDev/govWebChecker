import fs from 'node:fs/promises';
import path from 'node:path';
import type { Observation } from './types.js';
import { assertValidObservation } from './validate.js';

/**
 * Where an observation belongs: one file per dimension per month, partitioned by
 * when the check ran. Monthly partitioning bounds any single file and makes
 * retention a question of whether a file is kept.
 */
export function recordPathFor(dir: string, observation: Observation): string {
  const month = observation.checked_at.slice(0, 7);
  return path.join(dir, observation.dimension, `${month}.jsonl`);
}

/**
 * Appends one observation. Append is the only write this module performs — there
 * is no update and no delete, because a correction is a new observation
 * superseding the old one (FR-017).
 *
 * Duplicates are not collapsed. Silently deduplicating would be an edit of
 * history by another name.
 */
export async function appendObservation(dir: string, observation: Observation): Promise<void> {
  assertValidObservation(observation);
  const file = recordPathFor(dir, observation);
  await fs.mkdir(path.dirname(file), { recursive: true });
  // JSON.stringify escapes newlines, so one observation is always one line.
  await fs.appendFile(file, `${JSON.stringify(observation)}\n`, 'utf8');
}
