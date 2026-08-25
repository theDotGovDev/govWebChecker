import type { SiteModel, SiteView, TierView } from './model.js';
import type { CensusSeries, CensusMark } from './series.js';
import { formatFigure, type Figure } from './figure.js';

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
    hot: 'The busiest federal sites, checked every hour',
    broad: 'Every registered .gov domain, checked weekly',
    untiered: 'Earlier observations',
  };
  const icon = tier.tier === 'hot' ? ICON['clock'] : tier.tier === 'broad' ? ICON['map'] : '';

  return `<div class="panel tier-panel">
  <h3>${icon} ${escape(titles[tier.tier] ?? tier.tier)}</h3>
  ${tier.answered ? `<p class="tier-headline"><strong>Answered:</strong> ${formatFigure(tier.answered)}</p>` : ''}
  ${presenceViz}
  <details class="depth">
    <summary>Details for this tier</summary>
    ${presenceFigures}
    <p><strong>Population:</strong> ${escape(tier.population)}.</p>
    <p>
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
    ? 'complete cycle'
    : `in progress — ${m.slicesRan} of ${m.slicesInFrame} slices have run`;
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
      Judged ${number(m.domains)} ${m.domains === 1 ? 'domain' : 'domains'}:
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
<h2>${ICON['map']} The census over time</h2>
<p class="tagline">
  One reading per cycle. Nothing is drawn between cycles, because nothing was
  measured between them — a weekly census cannot say what happened on the days
  it did not look. An in-progress cycle covers fewer domains, so its counts are
  not comparable to a complete one and are never presented as a movement.
</p>
<div class="cycle-grid">
${marks}
</div>
</section>`;
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
  // The spread rides inside the figure's method so no latency token exists
  // outside a Figure — the output-level guarantee the tests hold.
  return `<td class="num">${formatFigure(typical.median, {
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
    --accent: #1a4480;
    --viz-website: #2a78d6; --viz-none: #eb6834; --viz-unknown: #8a8886;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      color-scheme: dark;
      --ink: #e8ebed; --muted: #a3adb5; --line: #333a40; --bg: #14171a;
      --panel: #1c2126; --ok: #5ec98d; --notable: #e5a35c; --link: #8ab4f8;
      --accent: #3987e5;
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
    Independent, outside-in measurements of US government websites — the busiest
    federal sites checked every hour, and every registered <code>.gov</code>
    domain checked weekly. Every figure here is something we observed, with the
    method that produced it.
  </p>
  <ul class="stats">
    <li><div>${number(summary.targets)}</div><span>sites in the hourly tier</span></li>
    <li><div>${number(summary.observations)}</div><span>observations recorded</span></li>
    <li><div>${escape(window)}</div><span>measurement window</span></li>
  </ul>
</header>

<h2>${ICON['scale']} Two tiers, two populations</h2>

<p class="tagline">
  This project measures government websites in two different ways, over two
  different populations. Figures from one do not describe the other, and adding
  them together describes neither — so they are never combined here.
</p>

${[...model.tiers]
  .sort((a, b) => ['hot', 'broad', 'untiered'].indexOf(a.tier) - ['hot', 'broad', 'untiered'].indexOf(b.tier))
  .map(tierPanel)
  .join('\n')}
${model.censusSeries ? censusSeriesSection(model.censusSeries) : ''}
${
  model.census
    ? `<div class="panel">
  <h3>${ICON['search']} Census coverage</h3>
  <p>
    The census covers every registered US <code>.gov</code> domain over a cycle
    of about a week, one seventh each day. Coverage is checkable from the
    published record rather than taken on trust.
  </p>
  <div class="scroll">
  <table>
    <thead><tr><th scope="col">Cycle</th><th scope="col" class="num">Domains covered</th><th scope="col" class="num">Slices seen</th></tr></thead>
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
    A cycle showing fewer than seven slices is an incomplete cycle, and is shown
    as incomplete rather than presented as a full sweep.
  </p>
</div>`
    : ''
}

<h2>${ICON['clock']} Latest measurement for each hourly-tier site</h2>

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
    Sites are checked hourly rather than continuously, which gives a short
    interruption a fair chance of landing in the record without pretending to be
    outage detection — an outage between checks is still invisible to us, and one
    we catch is dated to when we looked. Where we have no measurement, this page
    says so rather than showing a zero.
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
    Generated ${escape(generatedAt)} from
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
