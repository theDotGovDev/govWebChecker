/**
 * Sites our two instruments disagree about.
 *
 * Every hot-tier host is measured twice over by methods that fail differently:
 * an hourly HTTP request, and a daily load in a real browser. A server can
 * answer 200 while serving a block page, a bot challenge or a security
 * interstitial — that passes the HTTP check and fails the browser. So a
 * disagreement is the only signal this project has that a published "answered"
 * rate might be counting pages nobody could actually use.
 *
 * It costs no traffic. Both records already exist; this reads them (Principle:
 * re-probe only when the question needs it).
 *
 * What it deliberately does NOT do is decide which instrument is right. Either
 * reading may be the true one — a site really can be up for a plain request and
 * broken for a browser — so the finding is the disagreement itself, reported
 * with the counts behind it, and a reader is left to draw the conclusion.
 */

export interface CountedRow {
  host: string;
  outcome: string;
}

export interface Divergence {
  host: string;
  httpSuccesses: number;
  httpTotal: number;
  browserFailures: number;
  browserTotal: number;
}

/**
 * How many browser readings a host needs before a divergence can be claimed.
 *
 * Three, because one is not a characterisation and two cannot outvote a fluke.
 * This constant exists because of a specific mistake: `www.gsaadvantage.gov`
 * failed one browser check on 2026-08-27 and was carried as an open finding for
 * three days on the strength of it. The four browser runs after it all
 * succeeded and the HTTP record was 178/178. The site was fine; the finding was
 * an artefact of believing a single reading.
 */
export const MIN_BROWSER_RUNS = 3;

/** The browser outcome that means we got a measurement. Anything else failed. */
const MEASURED = 'measured';

/**
 * `skipped` means robots.txt told us not to look and we obeyed. Counting our own
 * politeness as a failed render would turn an instruction we honoured into a
 * finding against the site that gave it.
 */
const NOT_A_FAILURE = new Set([MEASURED, 'skipped']);

/**
 * The HTTP side has to look healthy for a disagreement to exist at all.
 *
 * A host both methods report as failing is not a disagreement — it is a
 * consistent fact about the site's posture, already published. `www.bls.gov` is
 * 0% by both, and there is nothing for this to add.
 */
const HTTP_HEALTHY = 0.8;

/** The browser side has to fail more often than not, so a flake cannot qualify. */
const BROWSER_BROKEN = 0.5;

export function divergences(http: CountedRow[], browser: CountedRow[]): Divergence[] {
  const byHost = new Map<string, { ok: number; total: number }>();
  for (const row of http) {
    const cell = byHost.get(row.host) ?? { ok: 0, total: 0 };
    cell.total += 1;
    if (row.outcome === 'success') cell.ok += 1;
    byHost.set(row.host, cell);
  }

  const browsed = new Map<string, { failed: number; total: number }>();
  for (const row of browser) {
    const cell = browsed.get(row.host) ?? { failed: 0, total: 0 };
    cell.total += 1;
    if (!NOT_A_FAILURE.has(row.outcome)) cell.failed += 1;
    browsed.set(row.host, cell);
  }

  const found: Divergence[] = [];
  for (const [host, b] of browsed) {
    if (b.total < MIN_BROWSER_RUNS) continue;
    const h = byHost.get(host);
    if (h === undefined || h.total === 0) continue;
    if (h.ok / h.total < HTTP_HEALTHY) continue;
    if (b.failed / b.total <= BROWSER_BROKEN) continue;
    found.push({
      host,
      httpSuccesses: h.ok,
      httpTotal: h.total,
      browserFailures: b.failed,
      browserTotal: b.total,
    });
  }
  return found.sort((a, b) => a.host.localeCompare(b.host));
}
