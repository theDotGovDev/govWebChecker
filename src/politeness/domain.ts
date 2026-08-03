/**
 * The rate-limiting key that groups hostnames likely sharing a backend.
 *
 * KNOWN LIMIT: this takes the last two labels, which is correct for every `.gov`
 * — the entire scope of the current release — and wrong for multi-label public
 * suffixes such as `state.tx.us`, which arrive with state and local government.
 *
 * The fix is the Public Suffix List, deliberately not taken as a dependency for a
 * case the current target scope cannot produce (research.md R4). Every caller goes
 * through this one function, so that day is a one-function change.
 */
export function registrableDomain(host: string): string {
  const labels = host
    .toLowerCase()
    .replace(/\.$/, '')
    .split('.')
    .filter((label) => label.length > 0);

  if (labels.length <= 2) return labels.join('.');
  return labels.slice(-2).join('.');
}
