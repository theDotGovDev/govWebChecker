import type { SiteModel, SiteView, TierView, TrendChart, EcosystemView, AgencyView, DashboardTile, ExperienceView } from './model.js';
import type { CensusSeries, CensusMark } from './series.js';
import type { Divergence } from './divergence.js';
import { formatFigure, type Figure } from './figure.js';
import { interpret } from './interpret.js';

function escape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function number(n: number): string {
  return n.toLocaleString('en-US');
}

function day(iso: string): string {
  return iso.slice(0, 10);
}

/**
 * How an outcome reads to a general audience.
 *
 * The recorded value is shown alongside, never replaced. "Responded" rather than
 * "up": we observed a response at a moment, which is a weaker and more honest
 * claim than availability.
 */
const OUTCOME_LABEL: Record<string, string> = {
  success: 'Responded',
  http_error: 'Error response',
  timeout: 'No response in time',
  connection_failure: 'Could not connect',
  dns_failure: 'Name did not resolve',
  tls_failure: 'HTTPS failed',
  blocked: 'Refused our request',
  skipped: 'Not checked',
};

/**
 * Inline SVG icons — decorative, always aria-hidden, never the sole carrier of
 * meaning (the words are). Inline because the page is self-contained by rule:
 * no external asset may be requested.
 */
const ICON: Record<string, string> = {
  logo: `<svg class="logo" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><rect x="2" y="2" width="28" height="28" rx="7" fill="var(--accent)"/><path d="M7 20 l4 0 2.5-8 3 12 2.5-8 2 4 4 0" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  clock: `<svg class="icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M10 5.8V10l3 2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
  map: `<svg class="icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><rect x="3" y="3" width="6" height="6" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.7"/><rect x="11" y="3" width="6" height="6" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.7"/><rect x="3" y="11" width="6" height="6" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.7"/><rect x="11" y="11" width="6" height="6" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.7"/></svg>`,
  scale: `<svg class="icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M10 3v14M4 6h12M4 6l-2.2 5a2.6 2.6 0 0 0 4.4 0L4 6zm12 0l-2.2 5a2.6 2.6 0 0 0 4.4 0L16 6z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  gauge: `<svg class="icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M3 14a7 7 0 1 1 14 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M10 14l4-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="10" cy="14" r="1.4" fill="currentColor"/></svg>`,
  phone: `<svg class="icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><rect x="6" y="2.5" width="8" height="15" rx="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8.8 15.2h2.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`,
  search: `<svg class="icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><circle cx="8.5" cy="8.5" r="5.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12.6 12.6 17 17" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`,
};

/**
 * A part-to-whole bar for the three presence states — rects only, a 2px surface
 * gap between segments, every segment carrying a text label so color is never
 * the only channel.
 *
 * The colors are deliberately IDENTITY colors, not status colors. Green/red
 * would moralize exactly what this project refuses to: a domain with no website
 * is not failing, and one we could not determine is not either. Blue and orange
 * are the validated categorical pair; unknown wears neutral gray, because gray
 * is what honesty about "we do not know" looks like.
 */
function presenceBar(
  website: number,
  noWebsite: number,
  undetermined: number,
  idPrefix: string,
): string {
  const total = website + noWebsite + undetermined;
  if (total === 0) return '';
  const W = 1000;
  const H = 34;
  const GAP = 2;
  const segs = [
    { n: website, cls: 'seg-website', label: 'Have a website' },
    { n: noWebsite, cls: 'seg-none', label: 'No website to have' },
    { n: undetermined, cls: 'seg-unknown', label: 'Could not determine' },
  ].filter((s) => s.n > 0);
  let x = 0;
  const rects = segs
    .map((s, i) => {
      const w = Math.max(8, Math.round((s.n / total) * (W - GAP * (segs.length - 1))));
      const rect = `<rect class="${s.cls}" x="${x}" y="0" width="${w}" height="${H}" rx="4"/>`;
      x += w + GAP;
      return rect;
    })
    .join('');
  const legend = segs
    .map(
      (s) =>
        `<span class="key"><span class="swatch ${s.cls}"></span>${s.label} <strong>${number(s.n)}</strong></span>`,
    )
    .join('\n      ');
  return `<figure class="presence-viz" role="img" aria-labelledby="${idPrefix}-caption">
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${rects}</svg>
    <figcaption id="${idPrefix}-caption" class="keys">
      ${legend}
    </figcaption>
  </figure>`;
}


/**
 * A chart is a Figure at a different size (FR-281): the whole block carries one
 * method caption built through the same choke point as any figure, and the
 * points, marks and axis labels are parts of that one captioned figure.
 */
function chartFigure(idPrefix: string, title: string, inner: string, caption: string): string {
  return `<figure class="chart" role="img" aria-labelledby="${idPrefix}-t">
  <p class="chart-title" id="${idPrefix}-t">${title}</p>
  ${inner}
  <figcaption class="chart-method">${caption}</figcaption>
</figure>`;
}

/**
 * A connected daily line for the hourly monitoring — legitimate at this grain,
 * because hourly sampling is near-continuous at daily resolution (FR-283). The
 * census never comes through here; its readings stay discrete marks.
 */
function trendChart(chart: TrendChart, idPrefix: string, title: string, axis: string): string {
  const W = 1000;
  const H = 240;
  const M = { top: 14, right: 18, bottom: 34, left: 52 };
  const pts = chart.points;
  const values = pts.map((p) => p.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = Math.max((hi - lo) * 0.15, hi * 0.02, 1);
  const y0 = Math.max(0, lo - pad);
  const y1 = hi + pad;
  const x = (i: number): number =>
    pts.length === 1 ? W / 2 : M.left + (i * (W - M.left - M.right)) / (pts.length - 1);
  const y = (v: number): number => M.top + (1 - (v - y0) / (y1 - y0)) * (H - M.top - M.bottom);

  const ticks = [y0, (y0 + y1) / 2, y1].map((v) => ({
    v: Math.round(v * 10) / 10,
    py: y(v),
  }));
  const grid = ticks
    .map((t) => `<g><text class="tick" x="${M.left - 8}" y="${t.py + 4}" text-anchor="end">${t.v}</text><rect class="grid" x="${M.left}" y="${t.py}" width="${W - M.left - M.right}" height="1"/></g>`)
    .join('');
  const line = pts.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const dots = pts
    .map(
      (p, i) =>
        `<circle class="dot" cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="3.5"/>` +
        `<circle class="hit" cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="11"><title>${p.date}: ${Math.round(p.value * 10) / 10} (${number(p.samples)} readings)</title></circle>`,
    )
    .join('');
  const first = pts[0]!.date.slice(5);
  const last = pts[pts.length - 1]!.date.slice(5);
  const xlabels =
    `<text class="tick" x="${M.left}" y="${H - 8}">${first}</text>` +
    (pts.length > 1 ? `<text class="tick" x="${W - M.right}" y="${H - 8}" text-anchor="end">${last}</text>` : '');
  const inner = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="trend">
  ${grid}
  <text class="tick axis-name" x="${M.left - 8}" y="${M.top - 2}" text-anchor="end">${escape(axis)}</text>
  <polyline class="line" points="${line}"/>
  ${dots}
  ${xlabels}
</svg>`;
  return chartFigure(idPrefix, title, inner, formatFigure(chart.caption, { note: 'the line shows this, day by day' }));
}

/** Presence composition across kinds of government (FR-282). */
function ecosystemChart(eco: EcosystemView): string {
  const MAX_ROWS = 8;
  const shown = eco.types.slice(0, MAX_ROWS);
  const rest = eco.types.slice(MAX_ROWS);
  if (rest.length > 0) {
    const other = rest.reduce(
      (a, t) => ({
        type: `${rest.length} other kinds`,
        judged: a.judged + t.judged,
        website: a.website + t.website,
        no_website: a.no_website + t.no_website,
        undetermined: a.undetermined + t.undetermined,
      }),
      { type: '', judged: 0, website: 0, no_website: 0, undetermined: 0 },
    );
    shown.push(other);
  }
  const maxJudged = Math.max(...shown.map((t) => t.judged));
  const rows = shown
    .map((t) => {
      const W = 1000;
      const barW = Math.max(30, Math.round((t.judged / maxJudged) * W));
      const segs = [
        { n: t.website, cls: 'seg-website', label: 'have a website' },
        { n: t.no_website, cls: 'seg-none', label: 'no website to have' },
        { n: t.undetermined, cls: 'seg-unknown', label: 'could not determine' },
      ].filter((seg) => seg.n > 0);
      let xPos = 0;
      const rects = segs
        .map((seg) => {
          const w = Math.max(6, Math.round((seg.n / t.judged) * (barW - 2 * (segs.length - 1))));
          const r = `<rect class="${seg.cls}" x="${xPos}" y="0" width="${w}" height="20" rx="3"><title>${escape(t.type)}: ${number(seg.n)} ${seg.label}</title></rect>`;
          xPos += w + 2;
          return r;
        })
        .join('');
      return `<div class="eco-row">
    <span class="eco-label">${escape(t.type)}</span>
    <svg viewBox="0 0 ${W} 20" preserveAspectRatio="none" style="width:${(barW / W) * 100}%"> ${rects}</svg>
    <span class="eco-count">${number(t.judged)}</span>
  </div>`;
    })
    .join('\n');
  const legend = `<p class="keys">
    <span class="key"><span class="swatch seg-website"></span>Have a website</span>
    <span class="key"><span class="swatch seg-none"></span>No website to have</span>
    <span class="key"><span class="swatch seg-unknown"></span>Could not determine</span>
  </p>`;
  return chartFigure(
    'eco',
    'Web presence by kind of government — bar length is how many domains of that kind have been judged so far',
    rows + legend,
    formatFigure(eco.caption, { note: 'one latest reading per domain' }),
  );
}

/** Agencies on the one stated measure, carve-out intact (FR-284, FR-261). */
function agencySection(agencies: AgencyView[], caption: TrendChart | undefined): string {
  if (agencies.length === 0) return '';
  const rated = agencies.filter((a) => a.figure);
  const declining = agencies.filter((a) => a.declinesAutomation);
  const bars = rated
    .map((a) => {
      const v = a.figure!.value;
      return `<div class="eco-row">
    <span class="eco-label">${escape(a.agency)}</span>
    <svg viewBox="0 0 1000 20" preserveAspectRatio="none" style="width:${Math.max(3, v).toFixed(1)}%"><rect class="seg-website" x="0" y="0" width="1000" height="20" rx="3"><title>${escape(a.agency)}: ${Math.round(v * 10) / 10}% of ${number(a.figure!.samples)} readings answered, across ${a.sites === 1 ? '1 site' : `${a.sites} sites`}</title></rect></svg>
    <span class="eco-count">${(Math.round(v * 10) / 10).toFixed(1)}%</span>
  </div>`;
    })
    .join('\n');
  const declined = declining.length
    ? `<p>Not shown above, and deliberately not shown as zero: ${declining
        .map((a) => `<strong>${escape(a.agency)}</strong>`)
        .join(', ')} — every reading of ${declining.length === 1 ? 'its' : 'their'} sites was a
      refusal of automated traffic or a robots.txt exclusion we honor. Declining
      robots is a policy, not an outage, so these agencies have no rate rather
      than a bad one.</p>`
    : '';
  const inner = bars;
  const cap = caption
    ? formatFigure(caption.caption, { note: 'per-agency shares of these same readings' })
    : '';
  return `${chartFigure('agency', 'Share of our checks each agency\u2019s sites answered', inner, cap)}
${declined}`;
}

/**
 * What one tier says, with the population it covers attached — now led by the
 * plain-language reading, with the full figures one disclosure away for anyone
 * who wants the method in detail. The figures themselves are unchanged and
 * still carry their method; the disclosure changes where they sit, not what
 * they say.
 */
function tierPanel(tier: TierView): string {
  const pf = tier.presenceFigures;
  // The bar and its labeled counts are the plain-language layer; the same three
  // readings as full Figures — method and rule attached — sit one disclosure
  // away. The method never separates from its figure; only where the pair sits
  // on the page changes.
  const presenceViz = pf
    ? `${presenceBar(pf.website.value, pf.no_website.value, pf.undetermined.value, `presence-${tier.tier}`)}
      <p class="plain">A domain that publishes no website is not a broken website, and this
      page never counts it as one. Where we could not determine what is published,
      that is our limit, not the domain's failure.</p>`
    : '';
  const presenceFigures = pf
    ? `<p>
        Of what is published at each domain we judged:
        have a website ${formatFigure(pf.website)},
        publish no web address at all ${formatFigure(pf.no_website)},
        and we could not determine ${formatFigure(pf.undetermined)}.
        A domain that publishes no website is not a broken website, and this page
        never counts it as one. Where the determination is ours to make, the rule
        that made it is named beside the number.
      </p>`
    : '';

  // FR-223: what a tier CANNOT answer travels with its figures. The limits are
  // structural — cadence and population — so they are stated per tier, not once
  // in a footnote a reader has to connect back.
  const limits: Record<string, string> = {
    hot: 'An hourly reading of these hosts says nothing about the other sixteen thousand registered .gov domains.',
    broad:
      'A weekly reading cannot see a short interruption — a site down for thirty minutes between visits looks identical to one that never blinked. That question belongs to the hourly tier.',
    untiered: 'These rows predate the record distinguishing tiers, and are shown for completeness.',
  };
  const titles: Record<string, string> = {
    hot: 'The busiest federal sites, aiming for a check every hour',
    broad: 'Every registered .gov domain, aiming for a weekly check',
    untiered: 'Earlier observations',
  };
  const icon = tier.tier === 'hot' ? ICON['clock'] : tier.tier === 'broad' ? ICON['map'] : '';

  return `<div class="panel tier-panel">
  <h3>${icon} ${escape(titles[tier.tier] ?? tier.tier)}</h3>
  ${tier.answered ? `<p class="tier-headline"><strong>Answered:</strong> ${formatFigure(tier.answered)}</p>` : ''}
  ${presenceViz}
  <details class="depth">
    <summary>Method and limits</summary>
    ${presenceFigures}
    <p><strong>Population:</strong> ${escape(tier.population)}.</p>
    <p class="denominators">
      ${number(tier.domains)} domains, ${number(tier.observations)} observations,
      ${number(tier.responded)} of which got a successful response.
      ${tier.latestReading ? `Latest reading ${escape(tier.latestReading.slice(0, 16).replace('T', ' '))} UTC.` : ''}
    </p>
    <p><strong>What this tier cannot answer:</strong> ${escape(limits[tier.tier] ?? 'Not stated in the record.')}</p>
  </details>
</div>`;
}

/**
 * The census over time: one mark per cycle, and deliberately nothing drawn
 * between them. A weekly reading is a sample; a line between two samples
 * asserts knowledge of the six days between, which is absence rendered as data
 * (FR-230). So this is a row of marks, not a chart with a path — a restyle
 * cannot bring the line back, because no path exists to restyle.
 */
function censusMarkCard(m: CensusMark): string {
  const status = m.complete
    ? 'complete week'
    : `in progress — ${m.slicesRan} of ${m.slicesInFrame} daily passes have run`;
  const frameNote = m.frameChanged
    ? `<p class="notable">The frame changed mid-cycle (the registry changed underneath it), so these
       slices did not all sweep one frame and this cycle's coverage is not one claim.</p>`
    : '';
  return `<div class="mark panel">
  <h3>${escape(m.cycle)} <span class="spread">${escape(status)}</span></h3>
  ${presenceBar(m.presence.website.value, m.presence.no_website.value, m.presence.undetermined.value, `mark-${m.cycle}`)}
  <details class="depth">
    <summary>Figures with method</summary>
    <p>
      <span class="denominators">Judged ${number(m.domains)} ${m.domains === 1 ? 'domain' : 'domains'}</span>:
      have a website ${formatFigure(m.presence.website)},
      no web address ${formatFigure(m.presence.no_website)},
      could not determine ${formatFigure(m.presence.undetermined)}.
    </p>
  </details>
  ${frameNote}
</div>`;
}

function censusSeriesSection(series: CensusSeries): string {
  const marks = series.marks.map(censusMarkCard).join('\n');
  return `<section class="census-series">
<h2>${ICON['map']} The whole of .gov, week by week</h2>
<p class="tagline">
  Each domain is read about once a week, so each week gets one mark and nothing
  is drawn between the marks — nothing was measured between them. A week still
  in progress covers fewer domains, so its counts are not comparable to a
  finished one and are never presented as a movement.
</p>
<div class="cycle-grid">
${marks}
</div>
</section>`;
}

/**
 * A sparkline: the same series as the full chart, at tile size.
 *
 * Deliberately not a Figure on its own. It carries no axis, no labels and no
 * readable value — it is a shape showing direction, and the number it belongs to
 * is the Figure printed directly above it with its full method. A sparkline that
 * a reader could read a value off would be a published quantity without its
 * method; this one cannot be.
 */
function sparkline(chart: TrendChart): string {
  const pts = chart.points;
  if (pts.length < 2) return '';
  const W = 120;
  const H = 28;
  const values = pts.map((p) => p.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const x = (i: number): number => (i * W) / (pts.length - 1);
  const y = (v: number): number => 2 + (1 - (v - lo) / span) * (H - 4);
  const line = pts.map((p, i) => `${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true" focusable="false"><polyline points="${line}"/></svg>`;
}

const TILE_ICON: Record<string, string> = {
  'tile-answering': 'clock',
  'tile-speed': 'gauge',
  'tile-page-experience': 'phone',
  'tile-coverage': 'map',
};

/**
 * One tile: the question, the finding in words, then the figure with its method.
 *
 * That order is the point. A reader who does not know what "ms" means gets the
 * answer first; a reader who wants the number finds it, and its method, without
 * leaving the tile. The whole tile is the link to where the working is shown
 * (FR-311), so there is no small target to hit on a phone.
 */
function tile(t: DashboardTile): string {
  const icon = ICON[TILE_ICON[t.id] ?? 'search'] ?? '';
  // A band element is exempt from the output-level stripper, so it must earn
  // that exemption the same way every other band does: by carrying the
  // threshold that decided it and the citation for that threshold.
  // When a tile has a line, the figure printed above it IS that line's caption.
  // Not checked — sourced. A sparkline reads as "that number over time", and
  // taking the number from anywhere else would make it a chart of one thing
  // captioned as another; deriving both from one object means the mismatch
  // cannot be written rather than merely being caught.
  const shown = t.trend ? t.trend.caption : t.reading;
  const reading = t.band && shown ? interpret(shown, 'server_response') : undefined;
  const state = reading
    ? `<span class="band band--${reading.band}" title="${escape(reading.what)}: ${escape(reading.threshold)}. ${escape(reading.source)}">${escape(t.state)}</span>`
    : escape(t.state);
  return `<a class="tile${t.measured ? '' : ' tile--unmeasured'}" id="${escape(t.id)}" href="${escape(t.href)}">
  <p class="tile-q">${icon} ${escape(t.question)}</p>
  <p class="tile-state">${state}</p>
  ${shown ? `<p class="tile-figure">${formatFigure(shown)}</p>` : ''}
  ${t.trend ? sparkline(t.trend) : ''}
  <p class="tile-detail">${escape(t.detail)}</p>
  <span class="tile-more">See how this was measured</span>
</a>`;
}

/**
 * The checks behind the page-experience tile (US4, FR-330 to FR-332).
 *
 * The composite on the tile is analysis, and it is permitted only while the
 * parts stay visible — so every check is listed here with its counts, the
 * published line it was judged against, and who drew that line. A reader who
 * disagrees with the weighting can see exactly what went into it.
 */
function experienceSection(exp: ExperienceView): string {
  const rows = exp.checks
    .map((c) => {
      // Not a `band`: a band interprets one measurement against one published
      // threshold, and is exempt from the output-level stripper on that basis.
      // This summarises several pages, so it wears its own class and stays
      // subject to the stripper — it carries no number, and must not gain one.
      const verdict =
        c.passed + c.failed === 0
          ? '<span class="verdict verdict--unknown">Not evaluated</span>'
          : c.failed === 0
            ? '<span class="verdict verdict--good">Passes</span>'
            : c.passed === 0
              ? '<span class="verdict verdict--poor">Does not pass</span>'
              : '<span class="verdict verdict--mixed">Mixed</span>';
      // The count belongs beside the verdict: "Mixed" alone hides whether that
      // is most sites or a handful, which is the only part a reader can act on.
      const howMany = c.share
        ? `<div class="count">${formatFigure(c.share, {
            note: `${c.passed} of ${c.passed + c.failed} pages passed`,
          })}</div>`
        : '';
      return `<tr>
  <th scope="row">${escape(c.question)}</th>
  <td>${verdict}${howMany}</td>
  <td class="num">${c.typical ? formatFigure(c.typical) : '<span class="absence">— <span class="method">not measured on any page</span></span>'}</td>
  <td class="threshold">${c.threshold ? `${escape(c.threshold)} — ${escape(c.source)}` : 'no published threshold, so nothing is claimed'}</td>
</tr>`;
    })
    .join('\n');

  return `<div class="panel">
  <p>
    Each page is loaded once in a real browser on an emulated phone over a
    throttled connection, then judged against thresholds published by other
    people. Nothing below is a line this project drew.
  </p>
  <p class="tagline">Checks passed across the pages measured: ${formatFigure(exp.caption, { note: 'share of judged checks that passed' })}</p>
  <div class="scroll">
    <table>
      <thead><tr><th scope="col">Question</th><th scope="col">Result</th><th scope="col">Typical measurement</th><th scope="col">Judged against</th></tr></thead>
      <tbody>
${rows}
      </tbody>
    </table>
  </div>
</div>`;
}

function latencyCell(site: SiteView): string {
  // The figure is the median across observations, never the newest reading —
  // one reading is noise, not a response time (FR-011a). Until there are two,
  // the page says so rather than showing the single value it happens to have.
  const typical = site.typical;
  if (!typical) {
    const pending = site.latest ? 'not enough readings yet' : 'no measurement';
    return `<td class="num"><span class="nodata">${pending}</span></td>`;
  }
  // The band leads, the number follows. "482 ms" is not information for most
  // readers; "Slow — 482 ms" is, and the threshold that decided it rides in the
  // title so the reading is checkable rather than asserted (FR-301 to FR-303).
  const reading = interpret(typical.median, 'server_response');
  const badge = reading
    ? `<span class="band band--${reading.band}" title="${escape(reading.what)}: ${escape(reading.threshold)}. ${escape(reading.source)}">${escape(reading.label)}</span> `
    : '';
  return `<td class="num">${badge}${formatFigure(typical.median, {
    note: `spread ${number(typical.fastest_ms)}–${number(typical.slowest_ms)} ms`,
  })}</td>`;
}

function row(site: SiteView): string {
  const latest = site.latest;
  const outcome = latest ? (OUTCOME_LABEL[latest.outcome] ?? latest.outcome) : 'No data yet';
  const state = latest?.outcome === 'success' ? 'ok' : latest ? 'notable' : 'none';

  return `        <tr>
          <th scope="row"><a href="sites/${escape(site.host)}.html">${escape(site.host)}</a>
            <span class="spread"><a href="${escape(site.url)}" rel="noopener">visit site ↗</a></span></th>
          <td>${escape(site.suborganization ?? site.agency)}</td>
          <td><span class="state state--${state}">${escape(outcome)}</span>${
            latest?.status_code !== undefined ? `<span class="spread">HTTP ${latest.status_code}</span>` : ''
          }</td>
${latencyCell(site)}
          <td class="num">${site.observationCount > 0 ? `${number(site.responded)}/${number(site.observationCount)}` : '—'}</td>
          <td class="num">${latest ? escape(day(latest.checked_at)) : '—'}</td>
        </tr>`;
}

/** Shared design tokens — one place, used by the index and every listing shell. */
export function sharedCss(): string {
  return `
  :root {
    color-scheme: light;
    --ink: #16191c; --muted: #5b6770; --line: #d6dbdf; --bg: #fcfcfb;
    --panel: #f4f6f7; --ok: #1a7f4b; --notable: #a8500a; --link: #1a4480;
    --accent: #1a4480; --poor: #b3261e;
    --viz-website: #2a78d6; --viz-none: #eb6834; --viz-unknown: #8a8886;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      color-scheme: dark;
      --ink: #e8ebed; --muted: #a3adb5; --line: #333a40; --bg: #14171a;
      --panel: #1c2126; --ok: #5ec98d; --notable: #e5a35c; --link: #8ab4f8;
      --accent: #3987e5; --poor: #f2a099;
      --viz-website: #3987e5; --viz-none: #d95926; --viz-unknown: #9a988f;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 0 1rem 4rem; background: var(--bg); color: var(--ink);
    font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    -webkit-text-size-adjust: 100%;
  }
  .wrap { max-width: 62rem; margin: 0 auto; }
  h1 { font-size: clamp(1.5rem, 4vw, 2rem); margin: 0 0 .5rem; letter-spacing: -0.02em; }
  h2 { font-size: clamp(1.05rem, 3vw, 1.2rem); margin: 2.5rem 0 .75rem; display: flex; align-items: center; gap: .5rem; }
  h3 { display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
  a { color: var(--link); }
  .logo { width: 2.2rem; height: 2.2rem; flex: none; }
  .icon { width: 1.05em; height: 1.05em; flex: none; color: var(--accent); }
  header { padding: 2.25rem 0 1.5rem; border-bottom: 1px solid var(--line); }
  .masthead { display: flex; align-items: center; gap: .75rem; }
  .tagline { color: var(--muted); margin: .5rem 0 0; font-size: 1.02rem; max-width: 44rem; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(10.5rem, 1fr));
    gap: .75rem; margin: 1.5rem 0 0; padding: 0; list-style: none; }
  .stats li { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: .9rem 1rem; }
  .stats div { font-size: clamp(1.3rem, 4vw, 1.7rem); font-weight: 650; overflow-wrap: anywhere; }
  .stats span { color: var(--muted); font-size: .82rem; display: block; margin-top: .15rem; }
  .figure { font-weight: 650; }
  .figure .method, .absence .method {
    display: block; font-weight: 400; color: var(--muted); font-size: .78rem; line-height: 1.45; margin-top: .1rem;
  }
  .tier-headline .figure { font-size: clamp(1.6rem, 5vw, 2.2rem); }
  .presence-viz { margin: .75rem 0 .5rem; }
  .presence-viz svg { width: 100%; height: 34px; display: block; border-radius: 6px; }
  .seg-website { fill: var(--viz-website); }
  .seg-none { fill: var(--viz-none); }
  .seg-unknown { fill: var(--viz-unknown); }
  .keys { display: flex; flex-wrap: wrap; gap: .35rem 1.1rem; margin: .5rem 0 0; font-size: .85rem; color: var(--muted); }
  .key { display: inline-flex; align-items: center; gap: .4rem; }
  .key strong { color: var(--ink); font-variant-numeric: tabular-nums; }
  .swatch { width: .7rem; height: .7rem; border-radius: 3px; display: inline-block; flex: none; }
  .swatch.seg-website { background: var(--viz-website); }
  .swatch.seg-none { background: var(--viz-none); }
  .swatch.seg-unknown { background: var(--viz-unknown); }
  .cycle-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr)); gap: 1rem; }
  .cycle-grid .panel { margin: 0; }
  details.depth { margin-top: .75rem; border-top: 1px dashed var(--line); padding-top: .5rem; }
  details.depth summary { cursor: pointer; color: var(--link); font-size: .9rem; padding: .35rem 0; }
  details.depth summary:hover { text-decoration: underline; }
  .scroll { overflow-x: auto; margin: 0 -1rem; padding: 0 1rem; -webkit-overflow-scrolling: touch; }
  table { border-collapse: collapse; width: 100%; font-size: .92rem; min-width: 44rem; }
  caption { text-align: left; color: var(--muted); padding-bottom: .75rem; font-size: .9rem; }
  th, td { text-align: left; padding: .6rem .75rem; border-bottom: 1px solid var(--line); vertical-align: top; }
  thead th { font-size: .78rem; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); border-bottom-width: 2px; }
  tbody th { font-weight: 600; }
  .num { text-align: right; }
  td.num, .num .figure { font-variant-numeric: tabular-nums; }
  .spread { display: block; color: var(--muted); font-size: .78rem; font-weight: 400; }
  .nodata { color: var(--muted); font-style: italic; }
  .state { font-weight: 600; }
  .state--ok { color: var(--ok); }
  .state--notable { color: var(--notable); }
  .state--none { color: var(--muted); font-weight: 400; }
  .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 1.1rem 1.25rem; margin: 1rem 0; }
  .panel h3 { margin: 0 0 .5rem; font-size: 1rem; }
  .panel p, .panel li { color: var(--muted); font-size: .92rem; }
  .panel p:last-child { margin-bottom: 0; }
  .notable { color: var(--notable); }
  .plain { max-width: 44rem; }
  .chart { margin: 1.25rem 0; background: var(--panel); border: 1px solid var(--line);
    border-radius: 10px; padding: 1rem 1.1rem; }
  .chart-title { margin: 0 0 .75rem; font-weight: 600; font-size: .95rem; }
  .chart-method { color: var(--muted); font-size: .78rem; margin-top: .6rem; }
  .chart-method .method { display: inline; }
  .trend { width: 100%; height: clamp(150px, 30vw, 240px); display: block; }
  .trend .line { fill: none; stroke: var(--accent); stroke-width: 2.5;
    vector-effect: non-scaling-stroke; stroke-linejoin: round; stroke-linecap: round; }
  .trend .dot { fill: var(--accent); }
  .trend .hit { fill: transparent; }
  .trend .grid { fill: var(--line); }
  .trend .tick { fill: var(--muted); font-size: 13px; }
  .trend .axis-name { font-size: 12px; }
  .eco-row { display: grid; grid-template-columns: minmax(7rem, 12rem) 1fr auto;
    gap: .6rem; align-items: center; margin: .35rem 0; }
  .eco-row svg { height: 20px; display: block; min-width: 6px; }
  .eco-label { font-size: .85rem; overflow-wrap: anywhere; }
  .eco-count { font-size: .85rem; color: var(--muted); font-variant-numeric: tabular-nums; }
  .history svg { width: 100%; height: 26px; display: block; }
  .day-full, .day-part { fill: var(--viz-website); }
  .day-none { fill: var(--viz-none); }
  .day-gap { fill: none; stroke: var(--line); stroke-width: 1.5; }
  .band { display: inline-block; font-size: .74rem; font-weight: 650; letter-spacing: .01em;
    padding: .1rem .42rem; border-radius: 999px; border: 1.5px solid currentColor; white-space: nowrap; }
  .band--good { color: var(--ok); }
  .band--fair { color: var(--notable); }
  .band--poor { color: var(--poor); }
  .views { margin: 1.4rem 0; }
  .view { margin: 0 0 1.2rem; }
  .view img { display: block; width: 100%; height: auto; border: 1px solid var(--line);
    border-radius: 8px; background: #fff; }
  .view figcaption { margin-top: .45rem; font-size: .9rem; }
  .count { margin-top: .3rem; font-size: .85rem; }
  .views-missing { list-style: none; padding: 0; margin: .8rem 0 0; }
  .views-missing li { border-left: 3px solid var(--viz-unknown); padding: .35rem 0 .35rem .7rem;
    margin: .4rem 0; font-size: .9rem; color: var(--muted); }
  .verdict { display: inline-block; font-size: .74rem; font-weight: 650;
    padding: .1rem .42rem; border-radius: 999px; border: 1.5px solid currentColor; white-space: nowrap; }
  .verdict--good { color: var(--ok); }
  .verdict--mixed { color: var(--notable); }
  .verdict--poor { color: var(--poor); }
  .verdict--unknown { color: var(--muted); }
  .threshold { font-size: .82rem; color: var(--muted); }

  /* The first screen. Tiles before tables — the answer before the enumeration. */
  .dashboard { display: grid; gap: .85rem; margin: 1.4rem 0 2rem;
    grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); }
  .tile { display: block; background: var(--panel); border: 1px solid var(--line);
    border-left: 4px solid var(--accent); border-radius: 10px; padding: .95rem 1.05rem;
    color: inherit; text-decoration: none; }
  .tile:hover, .tile:focus-visible { border-color: var(--link); border-left-color: var(--link); }
  .tile--unmeasured { border-left-color: var(--viz-unknown); }
  .tile-q { display: flex; align-items: center; gap: .4rem; margin: 0 0 .45rem;
    font-size: .86rem; font-weight: 650; color: var(--muted); }
  .tile-state { margin: 0 0 .5rem; font-size: 1.35rem; font-weight: 700; line-height: 1.2; }
  .tile--unmeasured .tile-state { font-size: 1.05rem; color: var(--muted); font-weight: 600; }
  .tile-figure { margin: 0 0 .45rem; }
  .tile-detail { margin: .5rem 0 .55rem; font-size: .86rem; color: var(--muted); }
  .tile-more { font-size: .8rem; font-weight: 650; color: var(--link); }
  .tile-more::after { content: " →"; }
  .spark { display: block; width: 100%; height: 28px; margin: .1rem 0 .35rem; }
  .spark polyline { fill: none; stroke: var(--accent); stroke-width: 2;
    stroke-linecap: round; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
  details.standalone { margin: 1rem 0; border-top: 0; padding-top: 0; }
  @media (max-width: 560px) {
    .eco-row { grid-template-columns: 1fr auto; }
    .eco-label { grid-column: 1 / -1; margin-bottom: -0.2rem; }
  }
  .lookup label { display: block; color: var(--muted); font-size: .9rem; margin-bottom: .5rem; }
  .lookup input { width: 100%; font: inherit; padding: .65rem .8rem; border: 1.5px solid var(--line);
    border-radius: 8px; background: var(--bg); color: var(--ink); }
  .lookup input:focus-visible { outline: 3px solid var(--link); outline-offset: 1px; border-color: var(--link); }
  .lookup-results { list-style: none; margin: .5rem 0 0; padding: 0; }
  .lookup-results li { padding: .3rem 0; border-bottom: 1px solid var(--line); }
  .lookup-results li:last-child { border-bottom: 0; }
  footer { margin-top: 3rem; padding-top: 1.5rem; border-top: 1px solid var(--line); color: var(--muted); font-size: .85rem; }
  a:focus-visible, :focus-visible, summary:focus-visible { outline: 3px solid var(--link); outline-offset: 2px; }
  @media (max-width: 640px) {
    th, td { padding: .5rem .5rem; }
  }`;
}

/**
 * Renders the whole index as one self-contained page.
 *
 * Deliberately plain: no framework, no script, no external requests — a page
 * about how well government websites perform should not itself be slow, and a
 * page about public infrastructure should be reachable with a keyboard and a
 * screen reader. The layering is progressive: plain-language reading first,
 * visualization beside it, and the full method one disclosure away — but the
 * method never leaves the figure it belongs to (FR-201).
 */
export function renderSite(model: SiteModel, generatedAt: string): string {
  const { summary } = model;
  const window =
    summary.firstObserved && summary.lastObserved
      ? `${day(summary.firstObserved)} to ${day(summary.lastObserved)}`
      : 'no measurements yet';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>govWebChecker — how government websites are performing</title>
<meta name="description" content="Independent, outside-in measurements of the availability and speed of US government websites — with the method behind every number.">
<style>${sharedCss()}</style>
</head>
<body>
<div class="wrap">

<header>
  <div class="masthead">
    ${ICON['logo']}
    <h1>How government websites are performing</h1>
  </div>
  <p class="tagline">
    Independent, outside-in measurements of US government websites. Every figure
    here is something we observed, published with the method that produced it.
  </p>
</header>

<section class="dashboard" aria-label="At a glance">
  ${model.dashboard.map(tile).join('\n  ')}
</section>

${(() => {
  const hot = model.tiers.find((t) => t.tier === 'hot');
  const broad = model.tiers.find((t) => t.tier === 'broad');
  const untiered = model.tiers.find((t) => t.tier === 'untiered');
  return `
<h2 id="online-now">${ICON['clock']} Is government online right now?</h2>

<p class="tagline">
  The busiest federal websites, checked every hour from the same vantage. This
  answers whether the sites people use most are responding — it says nothing
  about the rest of government, which the next section covers.
</p>

${hot ? tierPanel(hot) : ''}
${model.answeredTrend ? trendChart(model.answeredTrend, 'trend-a', 'Share of hourly checks answered, by day', 'answered, %') : ''}
${model.latencyTrend ? trendChart(model.latencyTrend, 'trend-l', 'Typical response time, by day', 'median ms') : ''}
${untiered ? `<details class="depth standalone">
  <summary>About the earliest readings</summary>
  ${tierPanel(untiered)}
</details>` : ''}

<h2 id="dotgov-world">${ICON['map']} What does the .gov world look like?</h2>

<p class="tagline">
  Beyond the famous sites: every registered <code>.gov</code> domain — cities,
  counties, school districts, tribes, agencies — visited about once a week.
  Most of American government is small, and much of it never built a website at
  all. That is a fact about how government works, not a failure.
</p>

${broad ? tierPanel(broad) : ''}
${model.ecosystem ? ecosystemChart(model.ecosystem) : ''}

<p class="tagline">
  The two views above are different populations measured differently, and this
  page never combines them into one number — figures from one do not describe
  the other, and adding them together describes neither.
</p>

${model.censusSeries ? censusSeriesSection(model.censusSeries) : ''}

${disagreementSection(model.divergences)}

<h2 id="page-experience">${ICON['phone']} Are the pages good to use?</h2>

<p class="tagline">
  Answering is not the same as working. This is what a visitor actually
  experiences: how long until they can read something, whether the page holds
  still while it loads, whether it responds when they tap. Measured on an
  emulated phone over a throttled connection, because that is how most people
  arrive.
</p>

${model.experience
  ? experienceSection(model.experience)
  : `<div class="panel"><p>
      No pages have been loaded in a browser yet. That is a measurement nobody
      has taken — not a finding that anything is wrong.
    </p></div>`}

${model.agencies.length > 0 ? `<h2>${ICON['scale']} How do agencies compare?</h2>

<p class="tagline">
  The hourly-checked sites, grouped by the agency that runs them. One measure,
  stated: the share of our checks that got an answer. This reflects each
  agency's posture toward automated traffic as much as its reliability — which
  is why refusing automation is listed as a stance, never scored as zero.
</p>

${agencySection(model.agencies, model.answeredTrend)}` : ''}
`;
})()}
${
  model.census
    ? `<div class="panel">
  <h3>${ICON['search']} Weekly coverage so far</h3>
  <p>
    The census covers every registered US <code>.gov</code> domain over a cycle
    of about a week, one seventh each day. Coverage is checkable from the
    published record rather than taken on trust.
  </p>
  <div class="scroll">
  <table>
    <thead><tr><th scope="col">Week</th><th scope="col" class="num">Domains covered</th><th scope="col" class="num">Daily passes seen</th></tr></thead>
    <tbody>
    ${model.census.cycles
      .map(
        (c) =>
          `<tr><th scope="row">${escape(c.cycle)}</th><td class="num">${number(c.domains)}</td><td class="num">${c.slices.length} of 7</td></tr>`,
      )
      .join('\n    ')}
    </tbody>
  </table>
  </div>
  <p>
    A week showing fewer than seven daily passes is incomplete coverage, and is
    shown as incomplete rather than presented as a full sweep.
  </p>
</div>`
    : ''
}

<section class="lookup-section">
<h2>${ICON['search']} Look up any .gov domain</h2>
<div class="panel lookup" data-lookup hidden>
  <label for="lookup-input">Type a domain — your city, county, school district, or agency:</label>
  <input id="lookup-input" type="search" autocomplete="off" spellcheck="false"
    placeholder="e.g. alamosa.gov" inputmode="url">
  <ul id="lookup-results" class="lookup-results"></ul>
</div>
<noscript><p class="tagline">Every domain has its own page at
<code>sites/&lt;domain&gt;.html</code> — for example <code>sites/alamosa.gov.html</code>.
The hourly-tier table below also links each of its sites.</p></noscript>
</section>
<script>
// Progressive enhancement only (FR-271): the panel is hidden until this runs,
// so a reader without script sees the noscript route, never a dead control.
// The index it searches is a same-origin asset (FR-270); nothing leaves the
// site's origin.
(function () {
  'use strict';
  var panel = document.querySelector('[data-lookup]');
  if (!panel || typeof fetch !== 'function') return;
  panel.hidden = false;
  var input = document.getElementById('lookup-input');
  var out = document.getElementById('lookup-results');
  var hosts = null;
  var loading = null;
  function load() {
    if (!loading) {
      loading = fetch('sites/index.json')
        .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
        .then(function (list) { hosts = list; })
        .catch(function () {
          out.innerHTML = '<li class="nodata">Search is unavailable right now — every domain still has a page at sites/&lt;domain&gt;.html.</li>';
        });
    }
    return loading;
  }
  function esc(t) {
    return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function show() {
    var q = input.value.trim().toLowerCase();
    if (!hosts || q.length < 2) { out.innerHTML = ''; return; }
    var hits = [];
    for (var i = 0; i < hosts.length && hits.length < 12; i++) {
      if (hosts[i].indexOf(q) !== -1) hits.push(hosts[i]);
    }
    out.innerHTML = hits.length
      ? hits.map(function (h) {
          return '<li><a href="sites/' + esc(h) + '.html">' + esc(h) + '</a></li>';
        }).join('')
      : '<li class="nodata">No .gov domain matches — the registry may not include it, or it may be spelled differently.</li>';
  }
  input.addEventListener('input', function () { load().then(show); });
})();
</script>

<h2>${ICON['clock']} Every hourly-checked site, in detail</h2>

<p class="tagline">
  Every site links to its own page with its full history and how to reach us
  about it.
</p>

<div class="scroll">
<table>
  <caption>
    Ordered by public traffic, which is how sites were selected for measurement.
    Typical response is the median across every reading we have, not the latest
    one. “Responded” counts how many of our checks got an answer.
  </caption>
  <thead>
    <tr>
      <th scope="col">Site</th>
      <th scope="col">Agency</th>
      <th scope="col">What we saw</th>
      <th scope="col" class="num">Typical response</th>
      <th scope="col" class="num">Responded</th>
      <th scope="col" class="num">Checked</th>
    </tr>
  </thead>
  <tbody>
${model.sites.map(row).join('\n')}
  </tbody>
</table>
</div>

<h2>How to read this</h2>

<div class="panel">
  <h3>Absence is not failure</h3>
  <p>
    Roughly one registered <code>.gov</code> domain in nine publishes no web
    address at all. Those domains exist for email, for a redirect, for internal
    use, or are simply held. A government that never published a website here is
    a different fact from a government whose website is down, and this page keeps
    them apart. Where our own name lookup failed, we say we could not determine
    it rather than attributing anything to the jurisdiction.
  </p>
</div>

<div class="panel">
  <h3>These are measurements, not verdicts</h3>
  <p>
    “Responded” means a site answered us at the moment we asked. It is not a
    claim about uptime, and a site that did not respond to us is not necessarily
    down for you — it may have been slow, briefly unavailable, or declining
    automated traffic specifically.
  </p>
</div>

<div class="panel">
  <h3>Where we measure from changes what we see</h3>
  <p>
    Checks run from a shared cloud server in a data centre${
      summary.vantages.length > 0 ? ` (${escape(summary.vantages.join(', '))})` : ''
    }.
    Every figure on this page therefore measures the <strong>network path</strong>
    from that vantage to the site — never a property of the site alone.
    Many of these sites sit behind content delivery networks, so what we time is
    largely the nearest cache rather than the site itself. These numbers are
    useful for spotting large changes and clear outliers. They are
    <strong>not</strong> what a person on a home or mobile connection
    experiences, and they should not be used to rank two sites whose figures are
    close together.
  </p>
</div>

<div class="panel">
  <h3>Sampling is occasional, so gaps are gaps</h3>
  <p>
    We aim to check each site hourly rather than continuously, which gives a
    short interruption a fair chance of landing in the record without pretending
    to be outage detection — an outage between checks is still invisible to us,
    and one we catch is dated to when we looked. Where we have no measurement,
    this page says so rather than showing a zero.
  </p>
  <p>
    The cadence is a target, not a promise. Checks are scheduled on GitHub
    Actions, which delivers scheduled runs on a best-effort basis and can be
    late or skip a slot entirely — over 26&ndash;27 August 2026 the hourly
    schedule fired twice in fifteen hours. So every figure states the interval
    its readings actually arrived at alongside the cadence they were aiming for,
    and a thinner stretch of the record means we looked less often, not that the
    sites changed.
  </p>
</div>

<div class="panel">
  <h3>We are a polite guest on someone else&rsquo;s infrastructure</h3>
  <p>
    This project sends no more traffic to a site than an ordinary visitor would.
    Requests to one site are spaced apart, never run in parallel against a single
    server, identify themselves with a link back to this project, and back off
    further when a site is struggling. Site operators who want the traffic to
    stop can say so and it will.
  </p>
</div>

<h2>Check our working</h2>

<div class="panel">
  <p>
    The raw measurements are published as plain text files in the repository —
    one line per observation, each carrying the method that produced it. Nothing
    on this page is derived from anything else.
  </p>
  <p>
    The project also ships a <code>verify</code> command that reads those files
    and reports whether our own rate limits were respected, using only the
    published timestamps. Anyone can run it against our data and reach their own
    conclusion without trusting this page.
  </p>
</div>

<footer>
  <p>
    Measured ${escape(window)}. Generated ${escape(generatedAt)} from
    ${number(summary.observations)} observations of ${number(summary.targets)} sites
    — ${number(summary.withData)} with measurements, ${number(summary.withoutData)} awaiting a first check.
  </p>
  <p>
    <a href="https://github.com/theDotGovDev/govWebChecker">Source and methodology on GitHub</a>.
    The record behind every figure is published at
    <a href="https://github.com/theDotGovDev/govWebChecker/tree/main/data/availability">data/availability</a>,
    and <code>npm run verify</code> proves its guarantees from the record alone —
    the same check anyone can run without trusting this page.
    Not affiliated with any agency measured.
  </p>
</footer>

</div>
</body>
</html>
`;
}

/**
 * Where our two instruments disagree about the same site.
 *
 * Published even when empty. "We compared and found none" is a finding; a
 * section that disappears when it has nothing to say leaves a reader unable to
 * tell a clean result from a check nobody ran — the same reason absence is its
 * own type rather than a zero.
 *
 * It deliberately does not adjudicate. Either reading can be the true one: a
 * site really can be up for a plain request and broken in a browser. So the
 * page reports the disagreement with both counts and leaves the conclusion to
 * the reader, which is also the only honest thing to do when the two numbers
 * come from instruments that fail differently.
 */
function disagreementSection(found: Divergence[]): string {
  const rows = found
    .map(
      (d) => `<tr><td><a href="./sites/${escape(d.host)}.html">${escape(d.host)}</a></td>` +
        `<td>${d.httpSuccesses} of ${d.httpTotal}</td>` +
        `<td>${d.browserTotal - d.browserFailures} of ${d.browserTotal}</td></tr>`,
    )
    .join('\n');

  const body =
    found.length === 0
      ? `<p>We compared every site\u2019s two records and found none that disagree: no site
     answers our plain request while failing to load in a real browser. That is
     what we want to see, and it is stated here rather than left out so the
     absence of a problem is distinguishable from the absence of a check.</p>`
      : `<p>These sites answer our plain request but do not load in a real browser. A
     server can return a page that is a refusal, a challenge screen or a
     security warning, and only the browser notices. We do not say which reading
     is right \u2014 both are things we saw \u2014 but a rate built on the first
     column alone would be counting pages a visitor could not use.</p>
   <div class="scroll">
   <table>
     <thead><tr><th>Site</th><th>Answered our request</th><th>Loaded in a browser</th></tr></thead>
     <tbody>
${rows}
     </tbody>
   </table>
   </div>`;

  return `<h2 id="disagreement">Where our two methods disagree</h2>

<p class="tagline">
  Every one of these sites is measured twice over, by methods that fail
  differently: an hourly request, and a daily load in a real browser.
</p>

${body}

<p class="note">
  A single odd reading is not counted. A site has to fail most of at least three
  browser checks before it appears here \u2014 one bad reading is data, not a
  characterisation of an institution.
</p>`;
}
