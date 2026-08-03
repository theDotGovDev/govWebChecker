import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installNoNetworkGuard, removeNoNetworkGuard } from '../fixtures/no-network.js';
import { robotsServer } from '../fixtures/servers.js';
import { isAllowed, parseRobots } from '../../src/checker/robots.js';

before(() => installNoNetworkGuard());
after(() => removeNoNetworkGuard());

describe('robots.txt (FR-005, FR-008)', () => {
  test('allows a path no rule disallows', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /private\n');
    assert.equal(isAllowed(rules, '/'), true);
  });

  test('disallows a matching path prefix', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /private\n');
    assert.equal(isAllowed(rules, '/private/page'), false);
  });

  test('an empty Disallow permits everything', () => {
    const rules = parseRobots('User-agent: *\nDisallow:\n');
    assert.equal(isAllowed(rules, '/anything'), true);
  });

  test('Disallow: / blocks the whole site', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /\n');
    assert.equal(isAllowed(rules, '/'), false);
  });

  test('a rule naming us specifically wins over the wildcard group', () => {
    const rules = parseRobots(
      'User-agent: *\nDisallow: /\n\nUser-agent: govWebChecker\nDisallow:\n',
    );
    assert.equal(isAllowed(rules, '/'), true, 'a group naming our agent takes precedence');
  });

  test('Allow overrides a broader Disallow', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /docs\nAllow: /docs/public\n');
    assert.equal(isAllowed(rules, '/docs/private'), false);
    assert.equal(isAllowed(rules, '/docs/public/a'), true);
  });

  test('ignores comments and blank lines', () => {
    const rules = parseRobots('# a comment\n\nUser-agent: *\n  Disallow: /x  \n');
    assert.equal(isAllowed(rules, '/x'), false);
  });

  test('a missing robots.txt means everything is allowed', () => {
    const rules = parseRobots('');
    assert.equal(isAllowed(rules, '/'), true);
  });

  test('serves from the fixture without requesting the target page', async () => {
    const f = await robotsServer('User-agent: *\nDisallow: /\n');
    try {
      // Proves the fixture answers robots.txt; the run-level assertion that a
      // disallowed target is never fetched lives in run.test.ts.
      const res = await fetch(new URL('/robots.txt', f.url));
      assert.match(await res.text(), /Disallow: \//);
    } finally {
      await f.close();
    }
  });
});
