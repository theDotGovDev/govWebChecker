import dns from 'node:dns';
import net from 'node:net';
import type { LookupFunction } from 'node:net';

export interface Resolution {
  /** The backend this request will actually be sent to, when we could establish one. */
  address?: string;
  family?: 4 | 6;
}

/**
 * What a domain publishes, as DNS reports it.
 *
 * `resolver_error` is ours; every other value is a fact about the jurisdiction.
 * That separation is the whole point — the survey measured 2.3% of the registry
 * failing to resolve for us, and a failure of ours recorded as "publishes
 * nothing" is an accusation we have no evidence for (FR-121).
 */
export type ResolutionStatus =
  | 'address'
  | 'mail_only'
  | 'no_service'
  | 'nxdomain'
  | 'resolver_error';

export interface NameResolution {
  status: ResolutionStatus;
  /** Does the apex publish a web address. */
  apex: boolean;
  /** Does the `www` form. */
  www: boolean;
  /** Raw resolver codes, so a reader can second-guess the class. Absent when resolved. */
  codes?: string[];
}

/** The slice of a DNS resolver this needs. Injected so no test resolves a real name. */
export interface NameResolver {
  resolve(name: string, type: 'A' | 'AAAA' | 'MX'): Promise<string[]>;
}

/** Codes that mean our path failed, not that the domain answered. */
const OURS = /^(ESERVFAIL|ETIMEOUT|EREFUSED|ECONNREFUSED|EAI_AGAIN)$/;

/**
 * Picks which address to contact when a host publishes several.
 *
 * Two properties matter, and they pull in opposite directions.
 *
 * *Stable per host*, so the address recorded against a domain is the same from
 * run to run and a reader comparing two observations is comparing the same
 * backend. Taking whatever the resolver listed first fails this — resolvers
 * rotate their answers deliberately.
 *
 * *Spread across hosts*, so a vendor running four machines does not have every
 * one of its customers pinned onto one of them. Concentrating them would defeat
 * the address limit by manufacturing the very cluster it exists to bound.
 *
 * Hashing the host and indexing into the sorted addresses gives both. Sorting
 * first is what makes it independent of resolver ordering.
 */
export function chooseAddress(host: string, addresses: readonly string[]): string | undefined {
  if (addresses.length === 0) return undefined;
  const sorted = [...addresses].sort();
  let hash = 0x811c9dc5;
  for (let i = 0; i < host.length; i++) {
    hash ^= host.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return sorted[hash % sorted.length];
}

/**
 * A resolver replacement that answers with one address and nothing else.
 *
 * This is what makes the address limit real rather than decorative. Without it
 * we would account for one address and then hand the URL to Node, which resolves
 * again at connect time and may reach a different machine — leaving the record
 * asserting a spacing guarantee about a backend we did not contact.
 */
export function pinnedLookup(address: string, family: 4 | 6): LookupFunction {
  return ((
    _hostname: string,
    options: dns.LookupOptions | ((...args: never[]) => void),
    callback?: (...args: never[]) => void,
  ) => {
    const done = (typeof options === 'function' ? options : callback) as (
      err: NodeJS.ErrnoException | null,
      address: string | dns.LookupAddress[],
      family?: number,
    ) => void;
    const opts = typeof options === 'function' ? {} : options;

    if (opts.all) {
      done(null, [{ address, family }]);
      return;
    }
    done(null, address, family);
  }) as LookupFunction;
}

/**
 * Establishes which backend a host resolves to.
 *
 * Costs the target nothing: the queries go to a resolver, never to the
 * jurisdiction's web server, which is what makes it affordable to do for every
 * check under Principle I.
 *
 * Never throws. A host we cannot resolve yields no address, and the caller then
 * falls back to the name-keyed limits rather than failing open — we must not
 * claim to know where a request went (FR-121).
 */
export async function resolveBackend(host: string): Promise<Resolution> {
  // A target given as a literal address needs no lookup, and asking for one
  // would fail.
  const literal = net.isIP(host);
  if (literal === 4 || literal === 6) return { address: host, family: literal };

  for (const family of [4, 6] as const) {
    try {
      const records = await dns.promises.resolve(host, family === 4 ? 'A' : 'AAAA');
      const address = chooseAddress(host, records as string[]);
      if (address !== undefined) return { address, family };
    } catch {
      // Deliberately swallowed. Why resolution failed is the checker's business
      // to record as an outcome, not this function's to decide.
    }
  }
  return {};
}

/** The production resolver, adapting `node:dns` to the injectable shape. */
export const systemResolver: NameResolver = {
  resolve: (name, type) => dns.promises.resolve(name, type) as Promise<string[]>,
};

async function published(
  name: string,
  resolver: NameResolver,
  codes: string[],
): Promise<boolean> {
  for (const type of ['A', 'AAAA'] as const) {
    try {
      const records = await resolver.resolve(name, type);
      if (records.length > 0) return true;
      codes.push('ENODATA');
    } catch (err) {
      codes.push((err as NodeJS.ErrnoException)?.code ?? 'UNKNOWN');
      // A name that does not exist will not exist for AAAA either.
      if ((err as NodeJS.ErrnoException)?.code === 'ENOTFOUND') return false;
    }
  }
  return false;
}

/**
 * Establishes what a domain publishes: a web address, mail only, nothing, or
 * nothing we could determine.
 *
 * Both the apex and the `www` form are asked about, because neither alone is
 * sufficient — the survey found 567 domains answering only at the apex and 348
 * only at `www`, and the `www`-only rate ranges from 0.9% to 41.7% depending on
 * the registry type, so a single-form rule would distort comparisons between
 * jurisdictions rather than merely lose rows (FR-127).
 *
 * Never throws. Why resolution failed is data.
 */
export async function classifyName(
  domain: string,
  resolver: NameResolver,
): Promise<NameResolution> {
  const codes: string[] = [];
  const apex = await published(domain, resolver, codes);
  const www = await published(`www.${domain}`, resolver, codes);

  if (apex || www) return { status: 'address', apex, www };

  let mail = false;
  try {
    mail = (await resolver.resolve(domain, 'MX')).length > 0;
  } catch (err) {
    codes.push((err as NodeJS.ErrnoException)?.code ?? 'UNKNOWN');
  }

  // Our failures outrank everything. A domain we could not reach must not be
  // reported as one that answered, whatever else we managed to learn about it.
  const status: ResolutionStatus = codes.some((c) => OURS.test(c))
    ? 'resolver_error'
    : mail
      ? 'mail_only'
      : codes.every((c) => c === 'ENOTFOUND')
        ? 'nxdomain'
        : 'no_service';

  return { status, apex: false, www: false, codes };
}

/**
 * Remembers resolutions for the life of one run.
 *
 * A single check resolves the same host up to three times — robots.txt, the page
 * itself, and again per redirect hop — and they must all agree, or the limiter
 * would account for one backend while the socket reached another.
 *
 * Deliberately per-run and never persisted. Addresses drift, and a cached map
 * outliving the run that built it would make the record state a backend that was
 * not the one contacted.
 */
export class ResolutionCache {
  readonly #entries = new Map<string, Promise<Resolution>>();

  get(host: string): Promise<Resolution> {
    let existing = this.#entries.get(host);
    if (existing === undefined) {
      existing = resolveBackend(host);
      this.#entries.set(host, existing);
    }
    return existing;
  }
}
