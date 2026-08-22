import type { SiteModel, SiteView, TierView } from './model.js';

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

function latencyCell(site: SiteView): string {
  // The figure is the median across observations, never the newest reading —
  // one reading is noise, not a response time (FR-011a). Until there are two,
  // the page says so rather than showing the single value it happens to have.
  const typical = site.typical;
  if (!typical) {
    const pending = site.latest ? 'not enough readings yet' : 'no measurement';
    return `<td class="num"><span class="nodata">${pending}</span></td>`;
  }
  return (
    `<td class="num"><strong>${number(typical.median_ms)} ms</strong>` +
    `<span class="spread">${number(typical.fastest_ms)}–${number(typical.slowest_ms)} ms ` +
    `over ${number(typical.readings)}</span></td>`
  );
}

function row(site: SiteView): string {
  const latest = site.latest;
  const outcome = latest ? (OUTCOME_LABEL[latest.outcome] ?? latest.outcome) : 'No data yet';
  const state = latest?.outcome === 'success' ? 'ok' : latest ? 'notable' : 'none';

  return `        <tr>
          <th scope="row"><a href="${escape(site.url)}" rel="noopener">${escape(site.host)}</a></th>
          <td>${escape(site.suborganization ?? site.agency)}</td>
          <td><span class="state state--${state}">${escape(outcome)}</span>${
            latest?.status_code !== undefined ? `<span class="spread">HTTP ${latest.status_code}</span>` : ''
          }</td>
${latencyCell(site)}
          <td class="num">${site.observationCount > 0 ? `${number(site.responded)}/${number(site.observationCount)}` : '—'}</td>
          <td class="num">${latest ? escape(day(latest.checked_at)) : '—'}</td>
        </tr>`;
}

/**
 * Renders the whole site as one self-contained page.
 *
 * Deliberately plain: no framework, no build step beyond this function, no
 * external requests. A page about how well government websites perform should
 * not itself be slow, and a page about accessibility should be reachable with a
 * keyboard and a screen reader — so this uses real table semantics, states
 * every outcome in words rather than by colour alone, and carries its
 * methodology on the page rather than behind a link.
 */
/**
 * What one tier says, with the population it covers attached.
 *
 * Every figure here is per-tier. There is deliberately no combined number: the
 * two tiers are different populations, and the census will show a far higher
 * failure and absence rate than 58 curated federal hosts — because the
 * population differs, not because government websites got worse. A single
 * headline across both would be wrong in a way that is very hard to retract
 * (SC-107).
 */
function tierPanel(tier: TierView): string {
  const measured = tier.presence.website + tier.presence.no_website + tier.presence.undetermined;
  const presence =
    measured > 0
      ? `<p>
        Of ${number(measured)} domains where we established what is published:
        <strong>${number(tier.presence.website)}</strong> have a website,
        <strong>${number(tier.presence.no_website)}</strong> publish no web address at all, and
        <strong>${number(tier.presence.undetermined)}</strong> we could not determine.
        A domain that publishes no website is not a broken website, and this page
        never counts it as one.
      </p>`
      : '';

  return `<div class="panel">
  <h3>${escape(tier.tier === 'hot' ? 'Hourly tier' : tier.tier === 'broad' ? 'Census tier' : 'Earlier observations')}</h3>
  <p><strong>Population:</strong> ${escape(tier.population)}.</p>
  <p>
    ${number(tier.domains)} domains, ${number(tier.observations)} observations,
    ${number(tier.responded)} of which got a successful response.
  </p>
  ${presence}
</div>`;
}

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
<title>govWebChecker — how federal websites are performing</title>
<meta name="description" content="Independent, outside-in measurements of the availability and speed of the most-visited US federal government websites.">
<style>
  :root {
    --ink: #16191c; --muted: #5b6770; --line: #d6dbdf; --bg: #ffffff;
    --panel: #f5f7f8; --ok: #1a7f4b; --notable: #a8500a; --link: #1a4480;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --ink: #e8ebed; --muted: #a3adb5; --line: #333a40; --bg: #14171a;
      --panel: #1c2126; --ok: #5ec98d; --notable: #e5a35c; --link: #8ab4f8;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 0 1.25rem 4rem; background: var(--bg); color: var(--ink);
    font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  }
  .wrap { max-width: 60rem; margin: 0 auto; }
  header { padding: 3rem 0 1.5rem; border-bottom: 1px solid var(--line); }
  h1 { font-size: 1.9rem; margin: 0 0 .5rem; letter-spacing: -0.02em; }
  .tagline { color: var(--muted); margin: 0; font-size: 1.05rem; max-width: 44rem; }
  h2 { font-size: 1.15rem; margin: 2.5rem 0 .75rem; }
  a { color: var(--link); }
  .stats { display: flex; flex-wrap: wrap; gap: 2rem; margin: 1.5rem 0 0; padding: 0; list-style: none; }
  .stats div { font-size: 1.5rem; font-weight: 600; }
  .stats span { color: var(--muted); font-size: .85rem; display: block; }
  .scroll { overflow-x: auto; margin: 0 -1.25rem; padding: 0 1.25rem; }
  table { border-collapse: collapse; width: 100%; font-size: .92rem; min-width: 44rem; }
  caption { text-align: left; color: var(--muted); padding-bottom: .75rem; font-size: .9rem; }
  th, td { text-align: left; padding: .6rem .75rem; border-bottom: 1px solid var(--line); vertical-align: top; }
  thead th { font-size: .78rem; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); border-bottom-width: 2px; }
  tbody th { font-weight: 600; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .spread { display: block; color: var(--muted); font-size: .78rem; font-weight: 400; }
  .nodata { color: var(--muted); font-style: italic; }
  .state { font-weight: 600; }
  .state--ok { color: var(--ok); }
  .state--notable { color: var(--notable); }
  .state--none { color: var(--muted); font-weight: 400; }
  .panel { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 1.25rem 1.5rem; margin: 1rem 0; }
  .panel h3 { margin: 0 0 .5rem; font-size: 1rem; }
  .panel p, .panel li { color: var(--muted); font-size: .92rem; }
  .panel p:last-child { margin-bottom: 0; }
  footer { margin-top: 3rem; padding-top: 1.5rem; border-top: 1px solid var(--line); color: var(--muted); font-size: .85rem; }
  a:focus-visible, :focus-visible { outline: 3px solid var(--link); outline-offset: 2px; }
</style>
</head>
<body>
<div class="wrap">

<header>
  <h1>How federal websites are performing</h1>
  <p class="tagline">
    Independent, outside-in measurements of the most-visited US government
    websites. Every figure here is something we observed, with the method
    that produced it.
  </p>
  <ul class="stats">
    <li><div>${number(summary.targets)}</div><span>sites in the hourly tier</span></li>
    <li><div>${number(summary.observations)}</div><span>observations recorded</span></li>
    <li><div>${escape(window)}</div><span>measurement window</span></li>
  </ul>
</header>

<h2>Two tiers, two populations</h2>

<p class="tagline">
  This project measures government websites in two different ways, over two
  different populations. Figures from one do not describe the other, and adding
  them together describes neither — so they are never combined here.
</p>

${model.tiers.map(tierPanel).join('\n')}
${
  model.census
    ? `<div class="panel">
  <h3>Census coverage</h3>
  <p>
    The census covers every registered US <code>.gov</code> domain over a cycle
    of about a week, one seventh each day. Coverage is checkable from the
    published record rather than taken on trust.
  </p>
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
  <p>
    A cycle showing fewer than seven slices is an incomplete cycle, and is shown
    as incomplete rather than presented as a full sweep.
  </p>
</div>`
    : ''
}

<h2>Latest measurement for each hourly-tier site</h2>

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
    says so rather than showing a zero${
      model.discardedRuns > 0
        ? `. ${number(model.discardedRuns)} run${model.discardedRuns === 1 ? '' : 's'} that produced no
    successful measurement at all — most likely a fault on our side rather than
    every site failing at once — ${model.discardedRuns === 1 ? 'is' : 'are'} excluded here`
        : ''
    }.
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
    conclusion without trusting our code.
  </p>
</div>

<footer>
  <p>
    Generated ${escape(generatedAt)} from
    ${number(summary.observations)} observations of ${number(summary.targets)} sites
    — ${number(summary.withData)} with measurements, ${number(summary.withoutData)} awaiting a first check.
  </p>
  <p>
    <a href="https://github.com/theDotGovDev/govWebChecker">Source, raw data, and methodology on GitHub</a>.
    Not affiliated with any agency measured.
  </p>
</footer>

</div>
</body>
</html>
`;
}
