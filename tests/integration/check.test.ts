import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { installNoNetworkGuard, removeNoNetworkGuard } from '../fixtures/no-network.js';
import { fastServer, slowServer, silentServer, statusServer, blockingServer } from '../fixtures/servers.js';
import { untrustedTlsServer, tlsHandshakeFailureServer, refusedUrl, failingLookup } from '../fixtures/failing.js';
import { performCheck } from '../../src/checker/check.js';

before(() => installNoNetworkGuard());
after(() => removeNoNetworkGuard());

const OPTS = { timeoutMs: 2_000, maxRedirects: 5 };

describe('a single check', () => {
  test('records elapsed time and final status for a healthy target', async () => {
    const f = await fastServer();
    try {
      const result = await performCheck(f.url, OPTS);
      assert.equal(result.outcome, 'success');
      assert.equal(result.statusCode, 200);
      assert.ok(typeof result.elapsedMs === 'number' && result.elapsedMs >= 0);
      assert.deepEqual(result.redirectChain, []);
      assert.equal(result.finalUrl, f.url);
    } finally {
      await f.close();
    }
  });

  test('measures a slow target as slow, not as a failure', async () => {
    const f = await slowServer(250);
    try {
      const result = await performCheck(f.url, OPTS);
      assert.equal(result.outcome, 'success');
      assert.ok(result.elapsedMs! >= 250, `elapsed ${result.elapsedMs}ms should reflect the delay`);
    } finally {
      await f.close();
    }
  });

  test('classifies a timeout and reports the time waited', async () => {
    const f = await silentServer();
    try {
      const result = await performCheck(f.url, { timeoutMs: 300, maxRedirects: 5 });
      assert.equal(result.outcome, 'timeout');
      assert.ok(result.waitedMs! >= 300);
      assert.equal(result.elapsedMs, undefined, 'a timeout has no latency measurement');
    } finally {
      await f.close();
    }
  });

  test('classifies a refused connection distinctly from an HTTP error', async () => {
    const url = await refusedUrl();
    const result = await performCheck(url, OPTS);
    assert.equal(result.outcome, 'connection_failure');
  });

  test('classifies a DNS failure distinctly', async () => {
    const result = await performCheck('http://not-a-real-host.invalid/', {
      ...OPTS,
      lookup: failingLookup,
    });
    assert.equal(result.outcome, 'dns_failure');
  });

  test('classifies an untrusted certificate as a TLS failure', async () => {
    const f = await untrustedTlsServer();
    try {
      const result = await performCheck(f.url, OPTS);
      assert.equal(result.outcome, 'tls_failure');
    } finally {
      await f.close();
    }
  });

  test('classifies a failed handshake as a TLS failure, not a connection failure', async () => {
    const f = await tlsHandshakeFailureServer();
    try {
      const result = await performCheck(f.url, OPTS);
      assert.equal(result.outcome, 'tls_failure');
    } finally {
      await f.close();
    }
  });

  test('classifies a server error as http_error', async () => {
    const f = await statusServer(500);
    try {
      const result = await performCheck(f.url, OPTS);
      assert.equal(result.outcome, 'http_error');
      assert.equal(result.statusCode, 500);
    } finally {
      await f.close();
    }
  });

  test('classifies refusal of automated traffic as blocked', async () => {
    const f = await blockingServer(/govWebChecker/i);
    try {
      const result = await performCheck(f.url, OPTS);
      assert.equal(
        result.outcome,
        'blocked',
        'a 403 to our User-Agent is a fact about access, distinct from down',
      );
    } finally {
      await f.close();
    }
  });

  test('follows redirects, records the chain, and measures the final URL', async () => {
    const target = await fastServer('destination');
    const server = http.createServer((_req, res) => {
      res.writeHead(302, { location: target.url });
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as AddressInfo;
    const start = `http://127.0.0.1:${port}/`;
    try {
      const result = await performCheck(start, OPTS);
      assert.equal(result.outcome, 'success');
      assert.deepEqual(result.redirectChain, [start]);
      assert.equal(result.finalUrl, target.url);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
      await target.close();
    }
  });

  test('stops after the redirect limit rather than looping forever', async () => {
    const server = http.createServer((_req, res) => {
      res.writeHead(302, { location: '/again' });
      res.end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const { port } = server.address() as AddressInfo;
    try {
      const result = await performCheck(`http://127.0.0.1:${port}/`, { timeoutMs: 2_000, maxRedirects: 3 });
      assert.equal(result.outcome, 'http_error');
      assert.equal(result.redirectChain.length, 3);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });

  test('sends the identifying User-Agent', async () => {
    const f = await fastServer();
    try {
      await performCheck(f.url, OPTS);
      assert.match(String(f.requests[0]?.headers['user-agent']), /govWebChecker/);
    } finally {
      await f.close();
    }
  });

  test('does not return a page body (FR-015)', async () => {
    const f = await fastServer('<html>secret content</html>');
    try {
      const result = await performCheck(f.url, OPTS);
      assert.ok(
        !JSON.stringify(result).includes('secret content'),
        'the check result must not carry page content',
      );
    } finally {
      await f.close();
    }
  });
});
