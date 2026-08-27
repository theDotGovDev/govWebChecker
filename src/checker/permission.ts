import { RateLimiter } from '../politeness/rate-limiter.js';
import { fetchTextForEvaluation } from './check.js';
import { pinnedLookup, ResolutionCache } from './resolve.js';
import { parseRobots, isAllowed } from './robots.js';

export interface PermissionDecision {
  allowed: boolean;
  /** UTC moment the limiter released the robots.txt fetch. */
  requestedAt: string;
}

export interface PermissionOptions {
  timeoutMs: number;
  maxRedirects: number;
}

/**
 * Asks a site's `robots.txt` whether we may fetch a path, before we fetch it.
 *
 * Shared by the availability pass and the deep quality pass because both are
 * requests to the same machine for the same path, and a rule about who may read
 * a page does not become weaker because a second kind of check wants it. If
 * anything the deep check needs this more: it loads the page and its
 * subresources rather than one document.
 *
 * The robots fetch is itself a request, so it spends the same budget and goes to
 * the same pinned address as the check that follows.
 *
 * Only an explicit, readable prohibition stops us. An unreachable `robots.txt`
 * is not consent, but it is not a refusal either — treating a fetch failure as a
 * block would silently stop measuring every site having a bad day.
 */
export async function robotsAllows(
  url: string,
  host: string,
  options: PermissionOptions,
  limiter: RateLimiter,
  backends: ResolutionCache,
): Promise<PermissionDecision> {
  const robotsUrl = new URL('/robots.txt', url).toString();
  const backend = await backends.get(host);
  const granted = await limiter.acquire(host, backend.address);
  const requestedAt = new Date(granted).toISOString();
  const body = await fetchTextForEvaluation(robotsUrl, {
    timeoutMs: options.timeoutMs,
    maxRedirects: options.maxRedirects,
    ...(backend.address !== undefined && backend.family !== undefined
      ? { lookup: pinnedLookup(backend.address, backend.family) }
      : {}),
  });

  if (body === undefined) return { allowed: true, requestedAt };
  return { allowed: isAllowed(parseRobots(body), new URL(url).pathname), requestedAt };
}
