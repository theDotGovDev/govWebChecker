const PROJECT_URL = 'https://github.com/theDotGovDev/govWebChecker';

/**
 * Identifies our traffic to site operators (FR-002, Principle III).
 *
 * An operator seeing unexplained requests cannot tell a courteous monitor from an
 * attack unless the traffic says who it is and how to make it stop. There is
 * deliberately no way to override this — see `requestHeaders`.
 */
export const USER_AGENT = `govWebChecker/0.1.0 (+${PROJECT_URL})` as const;

/**
 * Headers for an outbound request. Caller-supplied headers are applied first, so
 * the identification always wins: identification is not a default, it is a
 * guarantee.
 */
export function requestHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    accept: 'text/html,application/xhtml+xml',
    ...extra,
    'user-agent': USER_AGENT,
  };
}
