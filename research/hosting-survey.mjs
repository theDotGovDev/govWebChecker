/**
 * How concentrated is `.gov` web hosting, and would a per-IP rate-limit key work?
 *
 * WHY THIS EXISTS
 *
 * `001`'s politeness limits key on hostname and on registrable domain. FR-003a
 * added the domain-level limit because distinct hostnames of one agency commonly
 * share a backend. Feature `003` reopens that hole one level up: thousands of
 * small city and county `.gov` sites sit behind a handful of shared vendors, so
 * many *distinct registrable domains* can resolve to one origin. Neither limit
 * can see that, and Principle I is NON-NEGOTIABLE — which is why FR-133 blocks
 * raising concurrency until the gap is closed.
 *
 * Closing it means choosing a rate-limit key that reflects the backend actually
 * contacted rather than the name used to reach it. Which key is a design
 * question, but *whether any of them works* is an empirical one, and this
 * answers it before the design is fixed rather than after.
 *
 * The trap this is built to avoid: a CDN's anycast address is shared by
 * thousands of unrelated sites without being a shared origin. Keying on it would
 * throttle sites that share nothing, while a genuine shared vendor origin — the
 * case that actually matters — could hide behind that same noise. So the report
 * names who is behind each cluster (measured, via the AS name) instead of
 * reporting cluster sizes as if every cluster meant the same thing.
 *
 * WHAT IT SENDS
 *
 * DNS queries only, to the runner's resolver and to Team Cymru's public
 * IP-to-ASN DNS service. Not one HTTP request reaches any government web server,
 * so this costs the surveyed jurisdictions nothing — the same property that made
 * `dns-survey.mjs` safe to run against all 16,535 domains at once. The only HTTP
 * request made is for the registry CSV itself.
 *
 * Team Cymru publish the ASN mapping over DNS precisely so it can be looked up
 * without a client library or an API key, which is why it is used here rather
 * than taking a dependency. Lookups are cached per address, so the query count
 * is the number of distinct addresses, not the number of domains.
 */

import dns from 'node:dns';
import fs from 'node:fs/promises';

const REGISTRY_URL =
  'https://raw.githubusercontent.com/cisagov/dotgov-data/main/current-full.csv';

const CONCURRENCY = 40;
/** Lower for Cymru: it is one volunteer-run service, not a resolver fleet. */
const ASN_CONCURRENCY = 15;
const QUERY_TIMEOUT_MS = 5_000;
const MAX_CNAME_HOPS = 6;
const OUT_CSV = process.env.SURVEY_OUT ?? '/tmp/hosting-survey.csv';

/**
 * The broad tier covers the frame over a cycle of about a week, one seventh per
 * run (FR-111). Concentration in the *whole frame* is the wrong number to design
 * against — what a backend actually feels is the concentration inside one run.
 */
const SLICES = 7;
/** FR-132: hosts in flight stay at the order of a dozen. */
const WORKERS = 12;

const resolver = new dns.promises.Resolver({ timeout: QUERY_TIMEOUT_MS, tries: 2 });

/** Splits one CSV line, honoring double-quoted fields that contain commas. */
function splitCsvLine(line) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields.map((f) => f.trim());
}

/** Never throws. Returns what the resolver said, including why it said no. */
async function ask(fn) {
  try {
    const value = await fn();
    const ok = Array.isArray(value) && value.length > 0;
    return { ok, value: ok ? value : [], code: ok ? null : 'ENODATA' };
  } catch (err) {
    return { ok: false, value: [], code: err?.code ?? 'UNKNOWN' };
  }
}

const clean = (name) => String(name).toLowerCase().replace(/\.$/, '');

/**
 * Same two-label rule as `src/politeness/domain.ts`, and it carries the same
 * known limit: it is wrong for multi-label public suffixes. Here it is applied
 * to CNAME targets and nameservers, which are overwhelmingly `.com`/`.net`
 * vendor names, so the rule holds for the cases this survey turns on. Anything
 * it gets wrong shows up as a named cluster in the report rather than silently.
 */
function registrableDomain(host) {
  const labels = clean(host)
    .split('.')
    .filter((l) => l.length > 0);
  return labels.length <= 2 ? labels.join('.') : labels.slice(-2).join('.');
}

/**
 * The DNS operator behind a nameserver name.
 *
 * Large operators spread one service across many names — Route 53 answers from
 * `awsdns-01.com`, `-02.net`, `-03.org`, `-04.co.uk`; Azure from `azure-dns.com`,
 * `.net`, `.info`, `.org`. Keying on the registrable domain would scatter one
 * operator across four clusters and understate exactly the concentration this
 * survey exists to find, so the numeric suffix and the TLD are both dropped.
 *
 * A second-level name genuinely ending in `-<digits>` would be merged with its
 * siblings by this rule. That pattern is a nameserver-family convention rather
 * than something a jurisdiction would register, and any collision shows up as a
 * named cluster in the report rather than silently.
 */
function nameserverFamily(host) {
  const sld = registrableDomain(host).split('.')[0] ?? '';
  return sld.replace(/-\d+$/, '');
}

/** The /24 an address sits in. A coarser origin guess than the address itself. */
function slash24(ip) {
  const parts = ip.split('.');
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}.0/24` : '';
}

/**
 * Follows the CNAME chain by hand. `resolve4` follows it for us but discards it,
 * and the chain is the most legible evidence of who is hosting a site — a
 * `*.civicplus.com` target names the vendor outright, where an address does not.
 */
async function chase(name) {
  const chain = [];
  let current = name;
  for (let hop = 0; hop < MAX_CNAME_HOPS; hop++) {
    const r = await ask(() => resolver.resolveCname(current));
    if (!r.ok) break;
    const next = clean(r.value[0]);
    if (chain.includes(next)) break;
    chain.push(next);
    current = next;
  }
  const a = await ask(() => resolver.resolve4(name));
  const aaaa = a.ok ? { ok: false, value: [], code: null } : await ask(() => resolver.resolve6(name));
  return {
    chain,
    v4: a.value.slice().sort(),
    v6: aaaa.value.slice().sort(),
    code: a.ok || aaaa.ok ? '' : (a.code ?? 'UNKNOWN'),
  };
}

/**
 * What a check would actually contact for this domain.
 *
 * Both forms, because FR-127 requires trying both and because an apex that
 * redirects to `www` sends a second request to whatever `www` resolves to. The
 * union is therefore the set of backends one check can reach, which is the set a
 * rate-limit key has to cover.
 */
async function resolveWebPresence(domain) {
  const apex = await chase(domain);
  const www = await chase(`www.${domain}`);

  const v4 = [...new Set([...apex.v4, ...www.v4])].sort();
  const v6 = [...new Set([...apex.v6, ...www.v6])].sort();
  const chain = [...new Set([...apex.chain, ...www.chain])];

  const ns = await ask(() => resolver.resolveNs(domain));

  // `www.x.gov CNAME x.gov` is the commonest record in the registry and says
  // nothing about who hosts the site. Counting it as a vendor would inflate this
  // key's coverage with thousands of clusters of one.
  const external = chain.filter((t) => t !== domain && !t.endsWith(`.${domain}`));
  // The end of the chain is the vendor's own name for the site; intermediate
  // hops are often the customer's own alias and say nothing about hosting.
  const target = external.length > 0 ? external[external.length - 1] : '';

  return {
    domain,
    v4,
    v6,
    cname_target: target,
    cname_vendor: target ? registrableDomain(target) : '',
    ns_vendor: ns.ok ? nameserverFamily(ns.value[0]) : '',
    has_web: v4.length > 0 || v6.length > 0,
    // Why we saw no address. A resolver that is failing us looks identical to a
    // domain that publishes nothing unless the codes are kept and read.
    code: [apex.code, www.code].filter(Boolean).join('|'),
  };
}

/** Team Cymru publish origin ASN under a reversed-octet name. TXT, no API key. */
async function originAsn(ip) {
  const reversed = ip.split('.').reverse().join('.');
  const r = await ask(() => resolver.resolveTxt(`${reversed}.origin.asn.cymru.com`));
  if (!r.ok) return { asn: '', prefix: '' };
  const [asnField, prefix] = r.value[0].join('').split('|').map((f) => f.trim());
  // The field holds every AS originating the prefix; the first is enough to name
  // the operator, and a multi-origin prefix is not a distinction worth carrying.
  return { asn: (asnField ?? '').split(/\s+/)[0] ?? '', prefix: prefix ?? '' };
}

async function asnName(asn) {
  const r = await ask(() => resolver.resolveTxt(`AS${asn}.asn.cymru.com`));
  if (!r.ok) return `AS${asn}`;
  const fields = r.value[0].join('').split('|').map((f) => f.trim());
  return fields[fields.length - 1] || `AS${asn}`;
}

async function mapWithLimit(items, limit, fn, label) {
  const results = new Array(items.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    for (let i = next++; i < items.length; i = next++) {
      results[i] = await fn(items[i], i);
      if (++done % 1000 === 0) console.log(`  ${label} ...${done}/${items.length}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * FNV-1a, used only to model a stable slice assignment for the concentration
 * figures below. FR-112 requires the assignment be deterministic and stable but
 * does not fix a function, so this stands in for whatever `003` adopts. Any
 * assignment that spreads domains independently of their hosting gives the same
 * answer, and one that does not would be a different bug.
 */
function sliceOf(domain) {
  let h = 0x811c9dc5;
  for (let i = 0; i < domain.length; i++) {
    h ^= domain.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % SLICES;
}

function table(rows, headers) {
  if (rows.length === 0) {
    console.log('(none)');
    return;
  }
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => String(r[i]).length)),
  );
  const line = (cells) => cells.map((c, i) => String(c).padEnd(widths[i])).join('  ');
  console.log(line(headers));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const r of rows) console.log(line(r));
}

/**
 * Groups domains by every value a key produces for them.
 *
 * A domain with several addresses belongs to several clusters, which overstates
 * concentration slightly — a check contacts one address, not all of them. The
 * overstatement errs toward finding more sharing than exists, which is the only
 * direction Principle I permits erring in when the question is whether a limit
 * is needed.
 */
function cluster(rows, keysOf) {
  const clusters = new Map();
  for (const r of rows) {
    for (const k of new Set(keysOf(r))) {
      if (!k) continue;
      if (!clusters.has(k)) clusters.set(k, []);
      clusters.get(k).push(r.domain);
    }
  }
  return clusters;
}

function concentration(clusters, covered, total) {
  const sizes = [...clusters.values()].map((v) => v.length);
  // Distinct domains, not the sum of cluster sizes. A domain with several A
  // records belongs to several clusters, so summing counts it once per address
  // and inflates every figure it appears in — badly, since multi-A is the norm
  // for exactly the platform-fronted domains that form the largest clusters.
  const atLeast = (n) => {
    const seen = new Set();
    for (const members of clusters.values()) {
      if (members.length >= n) for (const d of members) seen.add(d);
    }
    return seen.size;
  };
  return {
    covered,
    coverage: total > 0 ? `${((covered / total) * 100).toFixed(1)}%` : '-',
    clusters: clusters.size,
    largest: sizes.length > 0 ? Math.max(...sizes) : 0,
    in2: atLeast(2),
    in10: atLeast(10),
    in50: atLeast(50),
    in200: atLeast(200),
  };
}

async function main() {
  console.log(`fetching ${REGISTRY_URL}`);
  const response = await fetch(REGISTRY_URL);
  if (!response.ok) throw new Error(`registry fetch failed: ${response.status}`);
  const csv = await response.text();

  const lines = csv.split(/\r?\n/).slice(1).filter((l) => l.trim() !== '');
  const entries = lines.map((line) => {
    const [domain, type] = splitCsvLine(line);
    return { domain: clean(domain), type: type || 'Unknown' };
  });
  // Bounded runs are for smoke-testing the script itself. The reported figures
  // are only meaningful over the whole frame, so the report says when it is set.
  const limit = Number(process.env.SURVEY_LIMIT ?? 0);
  if (limit > 0) entries.length = Math.min(entries.length, limit);
  console.log(`${entries.length} domains in the registry${limit > 0 ? ` (SURVEY_LIMIT=${limit} — NOT a full census)` : ''}\n`);

  const started = Date.now();
  const resolved = await mapWithLimit(
    entries,
    CONCURRENCY,
    async (e) => ({ ...e, ...(await resolveWebPresence(e.domain)) }),
    'resolve',
  );

  // Only domains that publish a web address ever receive an HTTP request, so
  // only they can contribute pressure to a shared backend. The other ~10.9%
  // are `003`'s absence problem (FR-116), not this one.
  const web = resolved.filter((r) => r.has_web);
  const noWeb = resolved.filter((r) => !r.has_web);

  // Self-diagnosis, before any figure below is worth reading.
  //
  // A resolver that fails us produces exactly the same observation as a domain
  // that publishes no website: no address. The runner-vantage baseline from
  // `survey-dns` run 32544034683 is 10.9% with no web address, and this survey's
  // whole subject — small municipal domains — is the population a weak resolver
  // loses first. A materially higher rate here means the concentration figures
  // below are drawn from a biased subset and must not be read as a census.
  const BASELINE_NO_WEB = 10.9;
  const noWebPct = (noWeb.length / resolved.length) * 100;
  console.log(
    `\n${web.length} domains publish a web address; ${noWeb.length} do not ` +
      `(${noWebPct.toFixed(1)}%, runner baseline ${BASELINE_NO_WEB}%)`,
  );

  const codes = new Map();
  for (const r of noWeb) if (r.code) codes.set(r.code, (codes.get(r.code) ?? 0) + 1);
  console.log('\nResolver codes for domains where we saw no web address:\n');
  table(
    [...codes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([c, n]) => [c, n]),
    ['code', 'count'],
  );

  // ENODATA is the domain answering that it publishes nothing. ESERVFAIL and
  // ETIMEOUT are our path failing, and are the signature of a vantage that
  // cannot see the small domains this survey is about.
  const ours = [...codes.entries()]
    .filter(([c]) => /ESERVFAIL|ETIMEOUT|ECONNREFUSED|EREFUSED/.test(c))
    .reduce((a, [, n]) => a + n, 0);
  const oursPct = (ours / resolved.length) * 100;
  const trustworthy = noWebPct <= BASELINE_NO_WEB + 3 && oursPct <= 3;
  console.log(
    `\nfailures attributable to us: ${ours} (${oursPct.toFixed(1)}%)\n` +
      `vantage verdict: ${
        trustworthy
          ? 'OK — resolution matches the runner baseline, figures below are a census'
          : 'NOT A CENSUS — this resolver lost materially more domains than a runner does. ' +
            'The figures below describe the subset it could see, and understate concentration ' +
            'among exactly the small jurisdictions this survey is about. Re-run on a runner.'
      }\n`,
  );

  const ips = [...new Set(web.flatMap((r) => r.v4))];
  console.log(`looking up origin ASN for ${ips.length} distinct addresses (Team Cymru, over DNS)`);
  const origins = new Map();
  const originResults = await mapWithLimit(ips, ASN_CONCURRENCY, originAsn, 'asn');
  ips.forEach((ip, i) => origins.set(ip, originResults[i]));

  const asns = [...new Set([...origins.values()].map((o) => o.asn).filter(Boolean))];
  console.log(`naming ${asns.length} distinct networks`);
  const names = new Map();
  const nameResults = await mapWithLimit(asns, ASN_CONCURRENCY, asnName, 'asname');
  asns.forEach((a, i) => names.set(a, nameResults[i]));

  const elapsed = ((Date.now() - started) / 1000).toFixed(0);

  for (const r of web) {
    r.asns = [...new Set(r.v4.map((ip) => origins.get(ip)?.asn).filter(Boolean))];
    r.slice = sliceOf(r.domain);
  }

  const label = (asn) => (asn ? `AS${asn} ${names.get(asn) ?? ''}`.trim() : '(no ASN answer)');

  const keys = [
    { name: 'ip (A record)', of: (r) => r.v4, show: (k) => `${k}  [${label(origins.get(k)?.asn ?? '')}]` },
    { name: '/24 network', of: (r) => r.v4.map(slash24), show: (k) => k },
    { name: 'origin ASN', of: (r) => r.asns, show: (k) => label(k) },
    { name: 'CNAME vendor', of: (r) => [r.cname_vendor], show: (k) => k },
    { name: 'NS vendor', of: (r) => [r.ns_vendor], show: (k) => k },
  ];

  console.log(`\n=== Concentration of ${web.length} web-publishing domains (${elapsed}s) ===\n`);
  console.log('"in >=N" counts domains sitting in a cluster of at least N domains.\n');
  table(
    keys.map((k) => {
      const c = cluster(web, k.of);
      const covered = web.filter((r) => k.of(r).some(Boolean)).length;
      const s = concentration(c, covered, web.length);
      return [k.name, s.coverage, s.clusters, s.largest, s.in2, s.in10, s.in50, s.in200];
    }),
    ['key', 'coverage', 'clusters', 'largest', 'in >=2', 'in >=10', 'in >=50', 'in >=200'],
  );

  for (const k of keys) {
    const c = cluster(web, k.of);
    const top = [...c.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 15);
    console.log(`\n=== Largest clusters by ${k.name} ===\n`);
    table(
      top.map(([key, members]) => [
        members.length,
        k.show(key),
        members.slice(0, 3).join(' '),
      ]),
      ['domains', 'key', 'examples'],
    );
  }

  // Is a large address cluster a shared origin, or a CDN's shared front door?
  //
  // This is the distinction the whole design turns on, and it cannot be read off
  // a cluster size — a Cloudflare anycast address and a municipal vendor's server
  // both look like "one address, many domains". Rather than assert the answer
  // from a hardcoded CDN list, ask the members: a domain fronted by a platform
  // CNAMEs to that platform's own name, and the platform names itself. So the
  // dominant CNAME target among a cluster's members is measured evidence of what
  // the cluster is, and a cluster of direct-A domains with no CNAME at all is the
  // signature of ordinary shared hosting.
  const ipClusters = cluster(web, (r) => r.v4);
  const byIp = new Map();
  for (const r of web) for (const ip of r.v4) {
    if (!byIp.has(ip)) byIp.set(ip, []);
    byIp.get(ip).push(r);
  }

  console.log('\n=== What is behind each large address cluster ===\n');
  console.log(
    'The members name it. "(direct A)" means the domains publish an address with no\n' +
      'CNAME, which is what ordinary shared hosting looks like — and what a per-address\n' +
      'key is for. A platform name means the cluster is that platform\'s front door.\n',
  );
  table(
    [...ipClusters.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 20)
      .map(([ip, members]) => {
        const rows = byIp.get(ip) ?? [];
        const vendors = new Map();
        for (const r of rows) {
          const v = r.cname_vendor || '(direct A)';
          vendors.set(v, (vendors.get(v) ?? 0) + 1);
        }
        const ranked = [...vendors.entries()].sort((a, b) => b[1] - a[1]);
        const [topVendor, topCount] = ranked[0] ?? ['?', 0];
        return [
          members.length,
          ip,
          label(origins.get(ip)?.asn ?? ''),
          `${topVendor} (${((topCount / rows.length) * 100).toFixed(0)}%)`,
        ];
      }),
    ['domains', 'address', 'network', 'what its members say they are'],
  );

  // The number the design actually turns on. Whole-frame concentration says how
  // much sharing exists; this says how much of it a single run can deliver at
  // once, which is what a backend experiences and what FR-132 is holding back.
  console.log(`\n=== Pressure inside one broad-tier run (1/${SLICES} slice, ${WORKERS} workers) ===\n`);
  console.log(
    `A cluster of at least ${WORKERS} domains in one slice can occupy every worker\n` +
      'simultaneously — the whole run pointed at one backend, which is exactly what\n' +
      'Principle I forbids and what neither existing limit can currently prevent.\n',
  );
  table(
    keys.map((k) => {
      let worstCluster = 0;
      let saturating = 0;
      // Distinct domains again — see `concentration`. Summing cluster sizes here
      // roughly doubled this figure, which is the difference between "half the
      // frame is exposed" and "a quarter of it is".
      const atRisk = new Set();
      for (let s = 0; s < SLICES; s++) {
        const inSlice = web.filter((r) => r.slice === s);
        const c = cluster(inSlice, k.of);
        for (const members of c.values()) {
          worstCluster = Math.max(worstCluster, members.length);
          if (members.length >= WORKERS) {
            saturating++;
            for (const d of members) atRisk.add(d);
          }
        }
      }
      return [
        k.name,
        worstCluster,
        saturating,
        atRisk.size,
        `${((atRisk.size / web.length) * 100).toFixed(1)}%`,
      ];
    }),
    [
      'key',
      'largest in a slice',
      `clusters >=${WORKERS}`,
      'domains in them',
      'share of frame',
    ],
  );

  // The aggregate of the same question, over every domain a per-address key would
  // actually bind. If most of them are platform-fronted, a per-address key mostly
  // throttles capacity providers and the gap needs a different answer. If most are
  // direct-A or vendor-fronted, it binds the shared origins it was meant to.
  const saturating = new Set();
  for (let sl = 0; sl < SLICES; sl++) {
    const inSlice = web.filter((r) => r.slice === sl);
    for (const members of cluster(inSlice, (r) => r.v4).values()) {
      if (members.length >= WORKERS) for (const d of members) saturating.add(d);
    }
  }
  const bound = web.filter((r) => saturating.has(r.domain));
  const boundBy = new Map();
  for (const r of bound) {
    const v = r.cname_vendor || '(direct A)';
    boundBy.set(v, (boundBy.get(v) ?? 0) + 1);
  }
  console.log(
    `\n=== What the ${bound.length} domains in saturating address clusters actually are ===\n`,
  );
  table(
    [...boundBy.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([v, n]) => [n, `${((n / bound.length) * 100).toFixed(1)}%`, v]),
    ['domains', 'share', 'fronted by'],
  );

  const v6only = web.filter((r) => r.v4.length === 0).length;
  console.log(`\nIPv6-only (excluded from the address and ASN keys): ${v6only}`);
  console.log(`Addresses with no origin ASN answer: ${[...origins.values()].filter((o) => !o.asn).length}`);

  const out = [
    'domain,type,slice,v4,cname_target,cname_vendor,ns_vendor,asns',
    ...web.map((r) =>
      [
        r.domain,
        r.type,
        r.slice,
        r.v4.join(' '),
        r.cname_target,
        r.cname_vendor,
        r.ns_vendor,
        r.asns.join(' '),
      ]
        .map((f) => (String(f).includes(',') ? `"${f}"` : f))
        .join(','),
    ),
  ];
  await fs.writeFile(OUT_CSV, out.join('\n') + '\n');
  console.log(`\nfull per-domain results written to ${OUT_CSV}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
