import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, readdirSync } from 'node:fs';
import { lighthouseRunner, PRESETS } from '../../src/quality/runner.js';
import { USER_AGENT } from '../../src/politeness/user-agent.js';

/**
 * Point the runner at whatever browser this machine has.
 *
 * Production reads `CHROME_PATH` or lets chrome-launcher search; a CI runner has
 * Chrome installed and needs neither. A development container often has one
 * somewhere else entirely, and a politeness guarantee that quietly stops running
 * there is worse than one that never existed — so this searches, and fails
 * loudly rather than skipping when it finds nothing.
 */
function findBrowser(): string | undefined {
  if (process.env['CHROME_PATH']) return process.env['CHROME_PATH'];
  const candidates = [
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  const pw = process.env['PLAYWRIGHT_BROWSERS_PATH'] ?? '/opt/pw-browsers';
  if (existsSync(pw)) {
    for (const dir of readdirSync(pw)) {
      if (dir.startsWith('chromium')) candidates.push(`${pw}/${dir}/chrome-linux/chrome`);
    }
  }
  return candidates.find((c) => existsSync(c));
}

/**
 * What a deep check actually sends, observed at a local server.
 *
 * The unit tests check the flags this project builds. They cannot check what
 * Chrome and Lighthouse do with them, and that gap is where a politeness
 * guarantee goes quietly wrong: the flags were right and the traffic was not.
 *
 * The constitution requires the Principle III limits to have tests that fail if
 * a limit is removed or loosened. This is that test for identification, and it
 * has to drive the real browser to be worth anything.
 *
 * Against a local server on 127.0.0.1 — never a government site.
 */
describe('every request a deep check makes says who it is (Principle III, FR-002)', () => {
  let server: http.Server;
  let url: string;
  const seen: { path: string; userAgent: string }[] = [];

  before(async () => {
    const browser = findBrowser();
    // Not skipped: the constitution requires the Principle III limits to have
    // tests that fail if a limit is loosened, and a test that vanishes when the
    // environment is inconvenient is a limit nobody is checking.
    assert.ok(browser, 'no browser found — set CHROME_PATH so this guarantee can be checked');
    process.env['CHROME_PATH'] = browser;

    const body =
      '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>Fixture Agency</title></head><body><h1>Fixture Agency</h1>' +
      '<p>A local page standing in for a government site.</p></body></html>';
    server = http.createServer((req, res) => {
      seen.push({ path: req.url ?? '', userAgent: req.headers['user-agent'] ?? '' });
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(body);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    await lighthouseRunner(PRESETS['mobile'])(url);
  });

  after(() => server.close());

  test('the tool reaches the fixture at all', () => {
    assert.ok(seen.length > 0, 'no requests observed — the rest of this describe would be vacuous');
    assert.ok(seen.some((r) => r.path === '/'), 'the page itself must have been requested');
  });

  test('not one request arrives anonymous', () => {
    // The standard preset fetches more than the page: the agentic-browsing audit
    // asks for /llms.txt and /robots.txt, and those went out under Chrome's own
    // user agent until this was caught. An operator seeing unexplained traffic
    // cannot tell a courteous monitor from an attack unless every request says
    // who it is — not merely the interesting ones.
    const anonymous = seen.filter((r) => !r.userAgent.includes('govWebChecker'));
    assert.deepEqual(anonymous, [],
      'every request must carry the project name and a URL an operator can follow');
  });

  test('the identification carries a URL an operator can follow to make it stop', () => {
    for (const r of seen) {
      assert.match(r.userAgent, /https:\/\/github\.com\/theDotGovDev\/govWebChecker/,
        `${r.path} identifies the project but offers no way to reach us`);
    }
  });

  test('identifying the traffic does not replace the device the page is emulating', () => {
    // Sites serve different pages to different agents. Substituting our name for
    // the device string would change which page we measured, so the page request
    // carries both — the device first, our identification appended.
    const page = seen.find((r) => r.path === '/')!;
    assert.ok(page.userAgent.startsWith(PRESETS['mobile']!.deviceUserAgent.slice(0, 30)),
      `the page must still be requested as the emulated device: ${page.userAgent}`);
    assert.ok(page.userAgent.includes(USER_AGENT));
  });
});
