import type { NameResolution } from '../checker/resolve.js';

/**
 * The URL a census domain is checked at.
 *
 * A census supplies a domain name, not a curated URL, so the rule that derives
 * one is part of the measurement rather than an implementation detail. It is
 * recorded on every observation (FR-129) so a reader knows what was actually
 * requested rather than inferring it.
 *
 * The rule, stated in full because FR-128 requires scheme, order and redirect
 * handling all to be covered:
 *
 * 1. Scheme is `https`. There is no `http` fallback.
 * 2. Where resolution shows only one of the apex and `www` has an address, that
 *    form is used and the other is never requested (FR-130).
 * 3. Where both have an address, the apex is used.
 * 4. Redirects are followed and the chain recorded, so an apex that redirects to
 *    `www` is visible as a redirect rather than pre-empted (FR-122).
 *
 * WHY BOTH FORMS: measured. 348 domains answer only at `www` and 567 only at the
 * apex, so either single-form rule misreports hundreds as absent. Worse, the
 * `www`-only rate ranges from 0.9% for City Election domains to 41.7% for Federal
 * Judicial, so a single-form rule would distort comparisons between jurisdiction
 * types rather than merely lose rows.
 *
 * WHY NO `http` FALLBACK: an `https` failure on a government website is a
 * finding, not a measurement artefact to be worked around. Falling back would
 * mask exactly the transport problem this project exists to record, and would
 * double the request count for every site whose `https` is already broken —
 * spending a struggling target's resources to soften a true observation about it.
 * The cost is contained rather than ignored: such a domain reads `undetermined`
 * rather than `no_website`, so we decline to conclude anything about whether a
 * website exists there.
 */

export const URL_RULE = 'canonical/1';

/**
 * Returns the URL to request, or `undefined` when there is none to derive.
 *
 * `undefined` is not a failure. A domain that publishes no web address has no
 * URL, and inventing one would send a request to a name we already know publishes
 * nothing — traffic spent to learn something DNS already told us.
 */
export function canonicalUrl(domain: string, resolution: NameResolution): string | undefined {
  if (resolution.status !== 'address') return undefined;

  const name = domain.toLowerCase().replace(/\.$/, '');
  if (resolution.apex) return `https://${name}/`;
  if (resolution.www) return `https://www.${name}/`;

  // `address` with neither form set is a contradiction the classifier cannot
  // produce. Returning nothing is the safe reading of an impossible input.
  return undefined;
}
