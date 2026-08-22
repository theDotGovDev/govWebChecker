import type { Observation, Presence } from '../record/types.js';

/**
 * Whether a public website appears to exist at a domain.
 *
 * This is the one judgement in the record, and the largest correctness risk in
 * the census — a reputational risk to real jurisdictions rather than a technical
 * one. 1,807 registered `.gov` domains, one in nine, publish no web address at
 * all. A census that cannot tell "this government never published a website" from
 * "this government's website is down" publishes 1,807 accusations every cycle.
 *
 * So it is fenced off from `outcome`, which stays a statement about the protocol
 * and nothing more (FR-117). A reading can be wrong in a way an observation
 * cannot, and mixing them would make a mistaken judgement indistinguishable from
 * a recorded fact.
 *
 * IT MUST STAY A PURE FUNCTION OF ONE STORED OBSERVATION. That is what makes
 * FR-119 true: `presence/2` can be computed over every row already collected
 * without a single target being checked again, and changing the rule alters no
 * stored fact. Anything reaching outside the row — a live lookup, a cache, the
 * frame — makes history unrecomputable the moment that outside thing changes.
 * A second parameter is a door for exactly that, so there is not one.
 */

export const PRESENCE_RULE = 'presence/1';

/** Outcomes that prove something answered, whatever it said. */
const ANSWERED = new Set(['success', 'http_error', 'blocked']);

export function presenceOf(observation: Observation): Presence {
  const state = read(observation);
  return { state, rule: PRESENCE_RULE };
}

function read(o: Observation): Presence['state'] {
  const resolution = o.resolution;

  // No resolution recorded means we have no basis for a reading. Saying
  // "undetermined" is the honest answer; anything else would be inferred from
  // absence of evidence.
  if (resolution === undefined) return 'undetermined';

  // Our own failure is evidence of nothing about the jurisdiction. The survey
  // measured 2.3% of the registry here and found ours and theirs are not
  // reliably separable from one vantage, so the conservative reading is required
  // (FR-121). This must come first: it outranks anything else we think we saw.
  if (resolution.status === 'resolver_error') return 'undetermined';

  // The domain answered authoritatively that it publishes no web address.
  if (resolution.status !== 'address') return 'no_website';

  // An address exists, so something is published there. Whether we reached it is
  // a separate question, and a failure to reach it is not evidence of absence.
  if (ANSWERED.has(o.outcome)) return 'website';

  return 'undetermined';
}
