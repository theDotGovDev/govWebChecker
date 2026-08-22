/**
 * A DNS-only census of the published .gov registry.
 *
 * WHY THIS EXISTS
 *
 * Feature 003 has to distinguish "no public website exists at this domain" from
 * "a website exists and is down" (spec.md FR-116 to FR-119). Most registered
 * .gov domains are not the front door of a website — they carry email, they
 * redirect, they are simply held — and recording those as failures would publish
 * an accusation against thousands of small jurisdictions at once.
 *
 * How much of the registry that actually affects is an empirical question, and
 * this answers it before the design is fixed rather than after.
 *
 * It also answers the canonical-URL question (FR-120, FR-121) as a side effect:
 * a domain whose apex has no address but whose `www` does would be reported as
 * having no website by a checker that only ever tries the apex.
 *
 * WHAT IT SENDS
 *
 * DNS queries only, to the runner's resolver. Not one HTTP request reaches any
 * government web server, so this costs the jurisdictions being surveyed
 * nothing — which is what makes it safe to run against all 16,535 at once under
 * Principle I. The only HTTP request made is for the registry CSV itself.
 *
 * This is measurement, and it is deliberately re-runnable: the registry changes,
 * and the answer will drift.
 */

import dns from 'node:dns';
import fs from 'node:fs/promises';

const REGISTRY_URL =
  'https://raw.githubusercontent.com/cisagov/dotgov-data/main/current-full.csv';

/**
 * Bounded so the survey stays a well-behaved resolver client. Public DNS handles
 * far more than this routinely, but nothing here is urgent enough to justify
 * leaning on shared infrastructure.
 */
const CONCURRENCY = 40;
const QUERY_TIMEOUT_MS = 5_000;
const OUT_CSV = process.env.SURVEY_OUT ?? '/tmp/dns-survey.csv';

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
    return { ok: Array.isArray(value) && value.length > 0, code: null };
  } catch (err) {
    return { ok: false, code: err?.code ?? 'UNKNOWN' };
  }
}

async function hasAddress(name) {
  const a = await ask(() => resolver.resolve4(name));
  if (a.ok) return { ok: true, code: null };
  const aaaa = await ask(() => resolver.resolve6(name));
  if (aaaa.ok) return { ok: true, code: null };
  // ENOTFOUND means the name itself is absent; ENODATA means it exists but
  // publishes no address. Collapsing those two is exactly the mistake this
  // survey exists to avoid.
  return { ok: false, code: a.code === 'ENODATA' || aaaa.code === 'ENODATA' ? 'ENODATA' : a.code };
}

/**
 * Classes are about what the jurisdiction published, not about whether we
 * succeeded. `resolve_error` is ours; everything else is theirs.
 */
async function classify(domain) {
  const apex = await hasAddress(domain);
  const www = await hasAddress(`www.${domain}`);

  if (apex.ok && www.ok) return { klass: 'apex_and_www', code: '', note: '' };
  if (apex.ok) return { klass: 'apex_only', code: '', note: '' };
  if (www.ok) return { klass: 'www_only', code: apex.code ?? '', note: 'apex has no address' };

  const mx = await ask(() => resolver.resolveMx(domain));
  if (mx.ok) return { klass: 'mx_only', code: apex.code ?? '', note: 'email, no web address' };

  const codes = [apex.code, www.code, mx.code].filter(Boolean);
  const joined = codes.join('|');
  if (codes.includes('ETIMEOUT') || codes.includes('ESERVFAIL') || codes.includes('EREFUSED')) {
    return { klass: 'resolve_error', code: joined, note: '' };
  }
  // NXDOMAIN vs NODATA is resolver-dependent: some resolvers report a name that
  // does not exist as ENODATA rather than ENOTFOUND. The raw-code histogram
  // printed at the end says whether this resolver drew the distinction at all,
  // so a "0 nxdomain" result cannot be mistaken for evidence.
  if (codes.every((c) => c === 'ENOTFOUND')) return { klass: 'nxdomain', code: joined, note: 'name does not exist' };
  if (codes.includes('ENODATA')) return { klass: 'name_no_service', code: joined, note: 'no address, no mail' };
  return { klass: 'resolve_error', code: joined, note: '' };
}

async function mapWithLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  let done = 0;
  const worker = async () => {
    for (let i = next++; i < items.length; i = next++) {
      results[i] = await fn(items[i], i);
      if (++done % 1000 === 0) console.log(`  ...${done}/${items.length}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function table(rows, headers) {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => String(r[i]).length)),
  );
  const line = (cells) => cells.map((c, i) => String(c).padEnd(widths[i])).join('  ');
  console.log(line(headers));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const r of rows) console.log(line(r));
}

const CLASSES = [
  'apex_and_www',
  'apex_only',
  'www_only',
  'mx_only',
  'name_no_service',
  'nxdomain',
  'resolve_error',
];

async function main() {
  console.log(`fetching ${REGISTRY_URL}`);
  const response = await fetch(REGISTRY_URL);
  if (!response.ok) throw new Error(`registry fetch failed: ${response.status}`);
  const csv = await response.text();

  const lines = csv.split(/\r?\n/).slice(1).filter((l) => l.trim() !== '');
  const entries = lines.map((line) => {
    const [domain, type] = splitCsvLine(line);
    return { domain: domain.toLowerCase(), type: type || 'Unknown' };
  });
  console.log(`${entries.length} domains in the registry\n`);

  const started = Date.now();
  const results = await mapWithLimit(entries, CONCURRENCY, async (e) => ({
    ...e,
    ...(await classify(e.domain)),
  }));
  const elapsed = ((Date.now() - started) / 1000).toFixed(0);

  const byClass = new Map();
  const byType = new Map();
  const byCode = new Map();
  for (const r of results) {
    byClass.set(r.klass, (byClass.get(r.klass) ?? 0) + 1);
    if (r.code) byCode.set(r.code, (byCode.get(r.code) ?? 0) + 1);
    if (!byType.has(r.type)) byType.set(r.type, new Map());
    const m = byType.get(r.type);
    m.set(r.klass, (m.get(r.klass) ?? 0) + 1);
  }

  const total = results.length;
  const pct = (n) => `${((n / total) * 100).toFixed(1)}%`;

  console.log(`\n=== Resolution class, all ${total} domains (${elapsed}s) ===\n`);
  table(
    CLASSES.map((k) => [k, byClass.get(k) ?? 0, pct(byClass.get(k) ?? 0)]),
    ['class', 'count', 'share'],
  );

  console.log('\n=== By registry domain type ===\n');
  const types = [...byType.keys()].sort();
  table(
    types.map((t) => {
      const m = byType.get(t);
      const sub = [...m.values()].reduce((a, b) => a + b, 0);
      return [t, sub, ...CLASSES.map((k) => m.get(k) ?? 0)];
    }),
    ['type', 'total', ...CLASSES],
  );

  // The two figures the spec decision actually turns on.
  const noWeb =
    (byClass.get('mx_only') ?? 0) +
    (byClass.get('name_no_service') ?? 0) +
    (byClass.get('nxdomain') ?? 0);
  const wwwOnly = byClass.get('www_only') ?? 0;

  // Self-diagnosis: whether this resolver distinguishes "name does not exist"
  // from "name exists but publishes nothing". If ENOTFOUND never appears, the
  // nxdomain figure above is an artefact of the resolver, not a fact about the
  // registry — and must not be read as one.
  console.log('\n=== Raw resolver codes, for domains with no web address ===\n');
  if (byCode.size === 0) {
    console.log('(none — every domain had a web address)');
  } else {
    table(
      [...byCode.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => [c, n]),
      ['code', 'count'],
    );
    const distinguishes = [...byCode.keys()].some((c) => c.includes('ENOTFOUND'));
    console.log(
      `\nresolver distinguishes NXDOMAIN: ${distinguishes ? 'yes' : 'NO — treat the nxdomain/name_no_service split as unreliable here'}`,
    );
  }

  console.log(`\n=== Verdict ===\n`);
  console.log(`domains with NO web address at apex or www : ${noWeb} (${pct(noWeb)})`);
  console.log(`  -> these would be recorded as failures if absence is not modelled (FR-116)`);
  console.log(`domains reachable ONLY at www, not at apex : ${wwwOnly} (${pct(wwwOnly)})`);
  console.log(`  -> these would be recorded as failures by an apex-only URL rule (FR-120)`);
  console.log(`resolver errors (ours, not theirs)         : ${byClass.get('resolve_error') ?? 0}`);

  const out = ['domain,type,class,note', ...results.map((r) => `${r.domain},${r.type},${r.klass},${r.note}`)];
  await fs.writeFile(OUT_CSV, out.join('\n') + '\n');
  console.log(`\nfull per-domain results written to ${OUT_CSV}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
