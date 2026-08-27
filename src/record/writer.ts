import fs from 'node:fs/promises';
import path from 'node:path';
import type { Observation } from './types.js';
import { assertValidObservation } from './validate.js';
import type { DeepReading } from '../quality/deep-check.js';
import { assertValidQualityReading } from './quality.js';

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

/**
 * Appends a run summary. Same append-only rules as an observation.
 *
 * Runs are recorded separately from observations because a run-level fact — most
 * importantly, that nothing answered — is about our own pass rather than about
 * any site. A reader joins the two by `run_id` and can discount a whole run
 * without that judgement having been baked into every row (FR-024).
 */
export async function appendRunSummary<
  T extends { run_id: string; started_at: string },
>(dir: string, summary: T): Promise<void> {
  const month = summary.started_at.slice(0, 7);
  const file = path.join(dir, 'runs', `${month}.jsonl`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, `${JSON.stringify(summary)}\n`, 'utf8');
}

/**
 * Appends one deep quality reading, under the same append-only rules.
 *
 * Separate from `appendObservation` because the two answer different questions
 * and are validated against different contracts. They share a partitioning
 * scheme — one file per dimension per month — so a reader joins them by host and
 * time without either having to know about the other.
 */
export async function appendQualityReading(dir: string, reading: DeepReading): Promise<void> {
  assertValidQualityReading(reading);
  const month = reading.checked_at.slice(0, 7);
  const file = path.join(dir, reading.dimension, `${month}.jsonl`);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, `${JSON.stringify(reading)}\n`, 'utf8');
}
