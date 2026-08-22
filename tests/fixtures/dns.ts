/**
 * A resolver that answers from a table instead of the network.
 *
 * Every DNS-dependent test uses this. No test may resolve a real name — the
 * constitution forbids tests that need the internet to pass, and half of what the
 * census decides (absence versus failure, which URL form to request) is decided
 * before any HTTP request is sent. Testing that against live DNS would make the
 * suite depend on what the world happens to be publishing today.
 */

export type RecordType = 'A' | 'AAAA' | 'MX';

/** What a resolver would say for one name. Absent entries throw ENOTFOUND. */
export interface StubZone {
  [name: string]: {
    A?: string[];
    AAAA?: string[];
    MX?: string[];
    /** Set to fail this name with a specific code, whatever else is present. */
    error?: string;
  };
}

export interface StubResolver {
  resolve(name: string, type: RecordType): Promise<string[]>;
  /** Names asked about, in order. Lets a test assert what was NOT looked up. */
  readonly asked: string[];
}

/**
 * `ENOTFOUND` means the name does not exist; `ENODATA` means it exists but
 * publishes nothing of that type. Collapsing the two is exactly the mistake the
 * DNS survey was built to avoid, so the stub keeps them distinct: a name absent
 * from the zone is ENOTFOUND, a name present without the requested type is
 * ENODATA.
 */
export function stubResolver(zone: StubZone): StubResolver {
  const asked: string[] = [];
  return {
    asked,
    async resolve(name: string, type: RecordType): Promise<string[]> {
      asked.push(`${type} ${name}`);
      const entry = zone[name];
      if (entry === undefined) throw Object.assign(new Error('not found'), { code: 'ENOTFOUND' });
      if (entry.error !== undefined) throw Object.assign(new Error(entry.error), { code: entry.error });
      const records = entry[type];
      if (records === undefined || records.length === 0) {
        throw Object.assign(new Error('no data'), { code: 'ENODATA' });
      }
      return records;
    },
  };
}
