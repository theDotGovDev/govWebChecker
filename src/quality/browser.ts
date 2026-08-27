import { existsSync, readdirSync } from 'node:fs';

/**
 * Finding the browser the deep check drives.
 *
 * `puppeteer-core` deliberately ships no browser and refuses to launch without an
 * explicit `executablePath`. That is a reasonable design and it cost this project
 * a defect that every test passed: production supplied the path only from
 * `CHROME_PATH`, the collection workflow never set it, and each integration test
 * set it *itself* before running. So the tests proved the code worked in an
 * environment they had arranged and the workflow had not — the first real run
 * would have failed on every target, and reported it as `check_failed`, which
 * reads like the sites' problem rather than ours.
 *
 * So resolution lives here, in production, and the tests use this. A test that
 * arranges its own environment is testing itself.
 */

/** Where a browser is looked for, in order. */
const CANDIDATES = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
];

export interface FindOptions {
  /** Overrides the fixed list; used to prove the failure message. */
  candidates?: string[];
}

/**
 * The first browser this machine offers, or undefined.
 *
 * An explicit `CHROME_PATH` always wins and is never second-guessed — it is how
 * someone says which browser to measure with, and quietly preferring a different
 * one would change what was measured.
 */
export function findBrowser(options: FindOptions = {}): string | undefined {
  const explicit = process.env['CHROME_PATH'];
  if (explicit) return explicit;

  for (const path of options.candidates ?? CANDIDATES) {
    if (existsSync(path)) return path;
  }

  // A Playwright-managed Chromium, which is what a container built for browser
  // work usually has instead of a system package.
  const store = process.env['PLAYWRIGHT_BROWSERS_PATH'] ?? '/opt/pw-browsers';
  if (existsSync(store)) {
    for (const entry of readdirSync(store).sort()) {
      if (!entry.startsWith('chromium')) continue;
      for (const suffix of ['chrome-linux/chrome', 'chrome-linux/headless_shell']) {
        const path = `${store}/${entry}/${suffix}`;
        if (existsSync(path)) return path;
      }
    }
  }
  return undefined;
}

/**
 * The browser, or an error that says how to fix it.
 *
 * Deliberately not a silent fallback to "no captures": a deep check without a
 * browser has measured nothing, and pretending otherwise would publish a run of
 * failures that look like the sites' doing.
 */
export function requireBrowser(options: FindOptions = {}): string {
  const found = findBrowser(options);
  if (found) return found;
  throw new Error(
    'no browser found to run the deep check with — install Chrome on the runner ' +
      'or set CHROME_PATH to an executable',
  );
}
