import { USER_AGENT } from '../politeness/user-agent.js';

export interface RobotsGroup {
  agents: string[];
  allow: string[];
  disallow: string[];
}

export interface RobotsRules {
  groups: RobotsGroup[];
}

/** The token we match ourselves against in a robots.txt group. */
const OUR_TOKEN = USER_AGENT.split('/')[0]!.toLowerCase();

/**
 * A deliberately small robots.txt parser.
 *
 * Handles the directives that decide whether we may fetch a page — User-agent
 * grouping, Disallow, and Allow — and ignores the rest. A dependency for this is
 * not warranted when the subset that governs our behavior is this small.
 */
export function parseRobots(body: string): RobotsRules {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | undefined;
  let lastLineWasAgent = false;

  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (line === '') continue;

    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === 'user-agent') {
      if (!current || !lastLineWasAgent) {
        current = { agents: [], allow: [], disallow: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastLineWasAgent = true;
      continue;
    }

    lastLineWasAgent = false;
    if (!current) continue;
    if (field === 'disallow' && value !== '') current.disallow.push(value);
    if (field === 'allow' && value !== '') current.allow.push(value);
  }

  return { groups };
}

/**
 * Whether a path may be fetched.
 *
 * A group naming us specifically wins over the wildcard group, per the robots
 * convention. Within the applicable group the longest matching rule wins, and
 * Allow beats Disallow at equal length — so a site can carve an exception out of
 * a broad prohibition and we will honor it.
 */
export function isAllowed(rules: RobotsRules, path: string): boolean {
  const specific = rules.groups.find((g) => g.agents.includes(OUR_TOKEN));
  const wildcard = rules.groups.find((g) => g.agents.includes('*'));
  const group = specific ?? wildcard;
  if (!group) return true;

  const longest = (patterns: string[]): number =>
    patterns.filter((p) => path.startsWith(p)).reduce((best, p) => Math.max(best, p.length), -1);

  const disallowed = longest(group.disallow);
  if (disallowed === -1) return true;
  return longest(group.allow) >= disallowed;
}
