import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { CAPTURE_PROFILES, CHANGE_RULE } from '../../src/quality/capture.js';
import { standaloneCapturer } from '../../src/quality/runner.js';

/**
 * A capture must survive the page's own security policy.
 *
 * The first live run died here. Reducing a view to a hash means handing the
 * image to a browser as a `data:` URI and reading it back — and the WebKit path
 * did that on the *captured site's own page*, which inherits that site's
 * Content-Security-Policy. A `connect-src` restriction, which is ordinary on a
 * government site, blocks the fetch: `TypeError: Load failed`.
 *
 * The Blink paths never had the bug because they already used a blank page. This
 * fixture is a page that says no, so the difference is visible.
 *
 * Against a local server on 127.0.0.1 — never a government site.
 */
describe('a page cannot forbid us from measuring it (live-run defect)', () => {
  let server: http.Server;
  let url: string;

  before(async () => {
    const body =
      '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>Fixture Agency</title><style>body{margin:0;font-family:system-ui}' +
      'header{background:#1a4480;color:#fff;padding:1.5rem 1rem}' +
      '.card{border:1px solid #999;margin:1rem;padding:1rem}</style></head><body>' +
      '<header><h1>Fixture Agency</h1></header>' +
      '<div class="card">Permits</div><div class="card">Records</div></body></html>';
    server = http.createServer((_req, res) => {
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        // The policy a cautious government site ships. `connect-src 'self'`
        // forbids fetching a data: URI from this page's context.
        'content-security-policy':
          "default-src 'self'; connect-src 'self'; img-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'",
      });
      res.end(body);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  });

  after(() => server?.close());

  for (const profile of CAPTURE_PROFILES.filter((p) => p.formFactor !== 'phone' || p.engine === 'webkit')) {
    test(`${profile.id} captures a page that forbids connections`, async () => {
      const view = await standaloneCapturer()(url, profile);
      assert.equal(view.hash.length, CHANGE_RULE.bits,
        'the hash must be produced despite the page policy');
      assert.ok(view.bytes > 0);
      assert.ok(view.hash.includes('1'), 'and be of the rendered page, not of nothing');
    });
  }
});
