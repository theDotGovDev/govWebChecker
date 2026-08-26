import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { CAPTURE_PROFILES, CHANGE_RULE, hasMeaningfullyChanged } from '../../src/quality/capture.js';
import { standaloneCapturer } from '../../src/quality/runner.js';
import { USER_AGENT } from '../../src/politeness/user-agent.js';

/**
 * The WebKit profile, exercised in the engine it claims to be.
 *
 * Safari is 16.47% of browsers and renders on its own engine, so a Blink capture
 * labelled as Safari would be a claim about what a visitor sees that is simply
 * untrue. This is the test that the label is earned.
 *
 * Against a local server on 127.0.0.1 — never a government site.
 */
describe('the Safari view is taken by Safari (D5)', () => {
  let server: http.Server;
  let url: string;
  let current = '';
  const seen: { path: string; userAgent: string }[] = [];

  const page = (hero: string) =>
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Fixture Agency</title><style>body{margin:0;font-family:system-ui}' +
    'header{background:#1a4480;color:#fff;padding:1.5rem 1rem}' +
    '.hero{height:160px}.card{border:1px solid #d6dbdf;margin:1rem;padding:1rem}' +
    '</style></head><body><header><h1>Fixture Agency</h1></header>' +
    `<div class="hero" id="hero" style="background:#ffffff"></div>` +
    // Painted late, so a capture that does not wait for the page to settle gets
    // a different view every time — the failure the Blink path had.
    `<script>setTimeout(()=>{document.getElementById('hero').style.background='${hero}'},350)</script>` +
    ['Permits', 'Records', 'Payments'].map((c) => `<div class="card"><h2>${c}</h2></div>`).join('') +
    '</body></html>';

  const webkitProfile = CAPTURE_PROFILES.find((p) => p.engine === 'webkit')!;

  before(async () => {
    current = page('#c9d4e2');
    server = http.createServer((req, res) => {
      seen.push({ path: req.url ?? '', userAgent: req.headers['user-agent'] ?? '' });
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(current);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  });

  after(() => server?.close());

  test('the view is actually rendered by WebKit, not by Blink wearing its name', async () => {
    const view = await standaloneCapturer()(url, webkitProfile);
    assert.ok(view.bytes > 0);
    const request = seen.find((r) => r.path === '/')!;
    assert.match(request.userAgent, /AppleWebKit\/605/,
      `the page must be requested by WebKit itself: ${request.userAgent}`);
    assert.doesNotMatch(request.userAgent, /Chrome\/\d/,
      'a Blink user agent here would mean the label is wrong');
    assert.match(request.userAgent, /iPhone/, 'and as a phone, which is what the profile claims');
  });

  test('the request still says who we are', async () => {
    // Principle III does not weaken because a different browser is driving.
    const request = seen.find((r) => r.path === '/')!;
    assert.ok(request.userAgent.includes(USER_AGENT),
      `an operator must be able to tell what this traffic is: ${request.userAgent}`);
    assert.match(request.userAgent, /github\.com\/theDotGovDev\/govWebChecker/);
  });

  test('the hash is the same width as every other profile, and comparable over time', async () => {
    const first = await standaloneCapturer()(url, webkitProfile);
    assert.equal(first.hash.length, CHANGE_RULE.bits);
    const again = await standaloneCapturer()(url, webkitProfile);
    assert.equal(hasMeaningfullyChanged(first.hash, again.hash), false,
      `two views of one unchanged page differed (${first.bytes} then ${again.bytes} bytes)`);
  });

  test('a change on the Safari view is detected too', async () => {
    const before_ = await standaloneCapturer()(url, webkitProfile);
    current = page('#8b1a1a');
    const after_ = await standaloneCapturer()(url, webkitProfile);
    assert.equal(hasMeaningfullyChanged(before_.hash, after_.hash), true);
  });

  test('the stored view stays small', async () => {
    current = page('#c9d4e2');
    const view = await standaloneCapturer()(url, webkitProfile);
    assert.ok(view.bytes < 60_000, `${(view.bytes / 1024).toFixed(1)} KB`);
  });
});
