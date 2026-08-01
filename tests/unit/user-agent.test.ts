import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { USER_AGENT, requestHeaders } from '../../src/politeness/user-agent.js';

describe('traffic identification (FR-002, Principle III)', () => {
  test('names the project', () => {
    assert.match(USER_AGENT, /govWebChecker/i);
  });

  test('carries a URL an operator can follow to make it stop', () => {
    const url = USER_AGENT.match(/https?:\/\/\S+/)?.[0];
    assert.ok(url, `no operator-facing URL in User-Agent: "${USER_AGENT}"`);
  });

  test('every generated header set includes it', () => {
    const headers = requestHeaders();
    assert.equal(headers['user-agent'], USER_AGENT);
  });

  test('a caller cannot override it', () => {
    // Passing a competing header must not win. Identification is not optional,
    // so there is deliberately no code path that removes or replaces it.
    const headers = requestHeaders({ 'user-agent': 'definitely-not-us' } as Record<string, string>);
    assert.equal(
      headers['user-agent'],
      USER_AGENT,
      'a caller-supplied User-Agent must not replace the project identification',
    );
  });

  test('the constant itself is frozen', () => {
    assert.throws(
      () => {
        // @ts-expect-error deliberately attempting a mutation the type system forbids
        USER_AGENT = 'something-else';
      },
      { name: 'TypeError' },
    );
  });
});
