import type { Observation, Presence } from '../record/types.js';
import { registrableDomain } from '../politeness/domain.js';
import { figure, formatFigure, type Figure } from './figure.js';

/**
 * One site's page (D2, D3). Keyed on HOST, never target_id: the record carries
 * 61 hot-tier target_ids over 58 hosts because the id scheme changed and three
 * hosts kept both. Keyed on target_id, www.irs.gov gets two pages each stating
 * half its sample count — an FR-201 violation made of an identity accident
 * (research R7). The ids are carried as provenance instead, and the old rows
 * keep theirs: the record is append-only and history is not rewritten to look
 * tidier.
 */
export interface DayCell {
  date: string;
  /** Readings that day; 0 means the day is a gap, not a judgement. */
  n: number;
  ok: number;
}

export interface Listing {
  host: string;
  /** Daily history for the strip; present with two or more days of readings (FR-285). */
  history?: { days: DayCell[]; caption: Figure };
  /** The registered name, as a grouping — never as the unit (D3). */
  domain: string;
  targetIds: string[];
  tier: 'hot' | 'broad' | 'untiered';
  readings: number;
  /** The most recent reading, which is what the page leads with. */
  latest: Observation;
  state: Presence['state'] | 'unjudged';
  cadence: 'hourly' | 'weekly';
  firstChecked: string;
  lastChecked: string;
  answered?: Figure;
}

export interface DomainGroup {
  domain: string;
  listings: Listing[];
}

export function listings(rows: Observation[]): Listing[] {
  const byHost = new Map<string, Observation[]>();
  for (const o of rows) {
    const list = byHost.get(o.host);
    if (list) list.push(o);
    else byHost.set(o.host, [o]);
  }

  const result: Listing[] = [];
  for (const [host, list] of byHost) {
    list.sort((a, b) => a.checked_at.localeCompare(b.checked_at));
    const latest = list[list.length - 1]!;
    const tier = latest.tier ?? 'untiered';
    const succeeded = list.filter((o) => o.outcome === 'success').length;
    const answered =
      succeeded > 0
        ? figure({
            value: (100 * succeeded) / list.length,
            unit: 'percent',
            tier: tier === 'broad' ? 'broad' : 'hot',
            population: 1,
            window: { from: list[0]!.checked_at, to: latest.checked_at },
            samples: list.length,
            vantage: [...new Set(list.map((o) => o.method.vantage))].sort().join(', '),
          })
        : undefined;

    // The history strip's cells: one per calendar day from first to last
    // reading, days with nothing measured included as gaps — a missing day
    // that silently vanished would read as continuity that never happened
    // (FR-233). Two or more days of readings earn a strip; a lone reading is
    // presented as a lone reading.
    const byDay = new Map<string, { n: number; ok: number }>();
    for (const o of list) {
      const d = o.checked_at.slice(0, 10);
      const cell = byDay.get(d) ?? { n: 0, ok: 0 };
      cell.n += 1;
      if (o.outcome === 'success') cell.ok += 1;
      byDay.set(d, cell);
    }
    let history: Listing['history'];
    if (byDay.size >= 2) {
      const days: DayCell[] = [];
      const first = new Date(list[0]!.checked_at.slice(0, 10) + 'T00:00:00Z');
      const last = new Date(latest.checked_at.slice(0, 10) + 'T00:00:00Z');
      for (let t = first.getTime(); t <= last.getTime(); t += 86_400_000) {
        const date = new Date(t).toISOString().slice(0, 10);
        const cell = byDay.get(date);
        days.push({ date, n: cell?.n ?? 0, ok: cell?.ok ?? 0 });
      }
      history = {
        days,
        caption: figure({
          value: (100 * succeeded) / list.length,
          unit: 'percent',
          tier: tier === 'broad' ? 'broad' : 'hot',
          population: 1,
          window: { from: list[0]!.checked_at, to: latest.checked_at },
          samples: list.length,
          vantage: [...new Set(list.map((o) => o.method.vantage))].sort().join(', '),
        }),
      };
    }

    result.push({
      host,
      ...(history ? { history } : {}),
      domain: registrableDomain(host),
      targetIds: [...new Set(list.map((o) => o.target_id))].sort(),
      tier: tier === 'broad' ? 'broad' : tier === 'hot' ? 'hot' : 'untiered',
      readings: list.length,
      latest,
      state: latest.presence?.state ?? 'unjudged',
      cadence: tier === 'broad' ? 'weekly' : 'hourly',
      firstChecked: list[0]!.checked_at,
      lastChecked: latest.checked_at,
      ...(answered ? { answered } : {}),
    });
  }
  return result.sort((a, b) => a.host.localeCompare(b.host));
}

export function domainGroups(list: Listing[]): DomainGroup[] {
  const byDomain = new Map<string, Listing[]>();
  for (const l of list) {
    const group = byDomain.get(l.domain);
    if (group) group.push(l);
    else byDomain.set(l.domain, [l]);
  }
  return [...byDomain.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([domain, ls]) => ({ domain, listings: ls }));
}

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function when(iso: string): string {
  return `${iso.slice(0, 16).replace('T', ' ')} UTC`;
}

const CORRECTION = `<p class="correction">
  Something wrong here? A correction lands as a new observation superseding the
  old — history is never rewritten. An operator can also ask for this site to be
  removed from checking, and the request is honored without argument:
  <a href="https://github.com/theDotGovDev/govWebChecker/issues">open an issue</a>.
</p>`;

/**
 * The undetermined page is the one page in seven with nothing to report but our
 * own failure, at census scale. It leads — first words, not a footnote — with
 * what is unknown, and the jurisdiction's name appears only as the subject of
 * OUR failure, never beside a failure state (FR-246).
 */
function undeterminedBody(l: Listing): string {
  const tried = l.latest.url;
  return `<p class="lead"><strong>We could not establish a connection to this site.</strong></p>
<p>That says nothing about whether the site works for a person visiting it — the
gap may be our resolver, our network path, or automated-traffic filtering. What
is recorded is our own inability, with its timestamp, not a fact about
${escape(l.host)}.</p>
<p>We tried ${escape(tried)} at ${when(l.lastChecked)} (checked ${l.cadence}).</p>`;
}

function noWebsiteBody(l: Listing): string {
  return `<p class="lead"><strong>${escape(l.host)} publishes no web address.</strong></p>
<p>The name is registered and its DNS answered us: there is no website here to
check. Registered domains exist for email, for internal use, or are simply held.
Publishing no website is a different fact from a website that stopped
answering, and this page never confuses the two. No request was sent — DNS already answered the
question, and asking again would spend the jurisdiction's resources to learn it
twice.</p>
<p>Determined ${when(l.lastChecked)} (checked ${l.cadence}, rule ${escape(l.latest.presence?.rule ?? '')}).</p>`;
}

function websiteBody(l: Listing): string {
  const latest = l.latest;
  // Refusal and restraint are not failure. A 403 to our User-Agent is the site
  // filtering automation — it answered, with a refusal, and that is not
  // evidence about whether it is up. A robots skip means nothing was sent at
  // all, so there is nothing the reading could claim.
  const status =
    latest.outcome === 'success'
      ? `answered at ${when(l.lastChecked)}`
      : latest.outcome === 'http_error'
        ? `answered with an error (HTTP ${latest.status_code ?? '?'}) at ${when(l.lastChecked)} — a website exists here, and at that moment it was broken`
        : latest.outcome === 'blocked'
          ? `declined our automated request (HTTP ${latest.status_code ?? '?'}) at ${when(l.lastChecked)}. Refusing automation is a choice sites make, not a statement about whether the site is up for a person visiting it`
          : latest.outcome === 'skipped'
            ? `was not checked: ${escape(latest.skip_reason ?? 'skipped by rule')}, and we honor that — nothing was sent`
            : `did not answer (${latest.outcome}) at ${when(l.lastChecked)}`;
  return `<p class="lead">Latest reading: ${escape(l.host)} ${status}.</p>
${l.answered ? `<p>Answered ${formatFigure(l.answered)}.</p>` : ''}
<p>Checked ${l.cadence}; ${l.readings === 1 ? 'one reading so far — presented as one reading, not a history' : `${l.readings} readings since ${when(l.firstChecked)}`}.</p>`;
}

/**
 * The site's own history, drawn before its numbers (FR-285). One cell per
 * calendar day: blue when every reading answered, orange when none did, blue at
 * partial opacity in between, and a neutral gap cell for a day nothing was
 * measured — absence is absence, never good or bad (FR-233). The same identity
 * palette as everywhere else, for the same reason: a refusal is not a failure
 * and a gap is not a verdict.
 */
function historyStrip(h: NonNullable<Listing['history']>): string {
  const W = 1000;
  const gap = 3;
  const cw = (W - gap * (h.days.length - 1)) / h.days.length;
  const cells = h.days
    .map((d, i) => {
      const x = (i * (cw + gap)).toFixed(1);
      const cls = d.n === 0 ? 'day-gap' : d.ok === 0 ? 'day-none' : d.ok === d.n ? 'day-full' : 'day-part';
      const opacity = cls === 'day-part' ? ` opacity="${(0.35 + 0.65 * (d.ok / d.n)).toFixed(2)}"` : '';
      const title =
        d.n === 0
          ? `${d.date}: nothing measured`
          : `${d.date}: ${d.ok} of ${d.n} readings answered`;
      return `<rect class="${cls}" x="${x}" y="0" width="${cw.toFixed(1)}" height="26" rx="3"${opacity}><title>${title}</title></rect>`;
    })
    .join('');
  return `<figure class="chart history" role="img" aria-labelledby="hist-t">
  <p class="chart-title" id="hist-t">Each day of our readings — filled when answered, hollow days are days nothing was measured</p>
  <svg viewBox="0 0 ${W} 26" preserveAspectRatio="none">${cells}</svg>
  <figcaption class="chart-method">${formatFigure(h.caption, { note: 'the strip shows this, day by day' })}</figcaption>
</figure>`;
}

export function renderListing(l: Listing): string {
  const body =
    l.state === 'undetermined'
      ? undeterminedBody(l)
      : l.state === 'no_website'
        ? noWebsiteBody(l)
        : websiteBody(l);
  const provenance =
    l.targetIds.length > 1
      ? `<p class="spread">This history spans ${l.targetIds.length} record identifiers
        (${l.targetIds.map(escape).join(', ')}) — an internal naming change, joined here so
        the readings stay one history.</p>`
      : '';
  return `<article class="listing" data-host="${escape(l.host)}">
<h1>${escape(l.host)}</h1>
${l.history ? historyStrip(l.history) : ''}
${body}
${provenance}
${CORRECTION}
</article>`;
}

export function renderDomainGroup(g: DomainGroup): string {
  const items = g.listings
    .map((l) => `<li><a href="./${escape(l.host)}.html">${escape(l.host)}</a> — checked ${l.cadence}, last ${when(l.lastChecked)}</li>`)
    .join('\n');
  return `<article class="domain-group" data-domain="${escape(g.domain)}">
<h1>${escape(g.domain)}</h1>
<p>${g.listings.length === 1 ? '1 site checked' : `${g.listings.length} sites checked`} under this
registered domain. That is a count of what we know of, not of what exists: we do
not have a source for this domain's other sites, and an unlisted site is
unchecked, not covered.</p>
<ul>
${items}
</ul>
${CORRECTION}
</article>`;
}
