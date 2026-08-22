import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { classifyName } from '../../src/checker/resolve.js';
import { stubResolver } from '../fixtures/dns.js';

/**
 * Turning DNS into evidence rather than inference.
 *
 * The census has to tell "this government never published a website" from "this
 * government's website is down". The survey measured the stakes: 1,807 domains —
 * one registered `.gov` in nine — publish no web address at all, so a census that
 * cannot draw the distinction publishes 1,807 accusations every cycle.
 *
 * Resolution costs the target nothing, since the queries go to a resolver rather
 * than to the jurisdiction's server. That is what makes it affordable to do for
 * every domain under Principle I, and it converts the largest category in the
 * census from guesswork into recorded fact.
 */
describe('classifying what a domain publishes (FR-120)', () => {
  test('an address at both apex and www', async () => {
    const dns = stubResolver({
      'alamosa.gov': { A: ['192.0.2.1'] },
      'www.alamosa.gov': { A: ['192.0.2.1'] },
    });
    const result = await classifyName('alamosa.gov', dns);
    assert.equal(result.status, 'address');
    assert.equal(result.apex, true);
    assert.equal(result.www, true);
  });

  test('an address at www only', async () => {
    // 348 domains in the registry are shaped this way. An apex-only rule reports
    // every one of them as absent.
    const dns = stubResolver({
      'alamosa.gov': { MX: ['mail.alamosa.gov'] },
      'www.alamosa.gov': { A: ['192.0.2.1'] },
    });
    const result = await classifyName('alamosa.gov', dns);
    assert.equal(result.status, 'address');
    assert.equal(result.apex, false);
    assert.equal(result.www, true);
  });

  test('an address at the apex only', async () => {
    // And 567 are shaped this way, which a www-only rule would lose.
    const dns = stubResolver({ 'alamosa.gov': { A: ['192.0.2.1'] } });
    const result = await classifyName('alamosa.gov', dns);
    assert.equal(result.status, 'address');
    assert.equal(result.apex, true);
    assert.equal(result.www, false);
  });

  test('mail service and no web address', async () => {
    const dns = stubResolver({ 'alamosa.gov': { MX: ['mail.alamosa.gov'] } });
    const result = await classifyName('alamosa.gov', dns);
    assert.equal(result.status, 'mail_only');
  });

  test('a name that exists and publishes nothing', async () => {
    const dns = stubResolver({ 'alamosa.gov': {} });
    const result = await classifyName('alamosa.gov', dns);
    assert.equal(result.status, 'no_service');
  });

  test('a name that does not exist', async () => {
    const dns = stubResolver({});
    const result = await classifyName('alamosa.gov', dns);
    assert.equal(result.status, 'nxdomain');
  });

  test('an IPv6-only domain still counts as publishing an address', async () => {
    const dns = stubResolver({ 'alamosa.gov': { AAAA: ['2001:db8::1'] } });
    const result = await classifyName('alamosa.gov', dns);
    assert.equal(result.status, 'address');
  });

  test('our own resolver failure is never recorded as the domain publishing nothing', async () => {
    // FR-121. The survey measured 2.3% in this category and noted the two are not
    // reliably separable from one vantage, so the conservative reading is
    // required: we say we failed, not that they published nothing.
    for (const code of ['ESERVFAIL', 'ETIMEOUT', 'EREFUSED', 'ECONNREFUSED']) {
      const dns = stubResolver({
        'alamosa.gov': { error: code },
        'www.alamosa.gov': { error: code },
      });
      const result = await classifyName('alamosa.gov', dns);
      assert.equal(
        result.status,
        'resolver_error',
        `${code} must classify as ours, not as the jurisdiction publishing nothing`,
      );
      assert.notEqual(result.status, 'no_service');
    }
  });

  test('keeps the raw resolver codes so a reader can second-guess the class', async () => {
    const dns = stubResolver({ 'alamosa.gov': { error: 'ESERVFAIL' } });
    const result = await classifyName('alamosa.gov', dns);
    assert.ok(result.codes && result.codes.length > 0, 'codes must be preserved');
    assert.ok(result.codes.includes('ESERVFAIL'));
  });

  test('a domain with an address carries no codes — there is nothing to explain', async () => {
    const dns = stubResolver({ 'alamosa.gov': { A: ['192.0.2.1'] } });
    const result = await classifyName('alamosa.gov', dns);
    assert.equal(result.codes, undefined);
  });

  test('does not ask about www when the apex already answers, unless it must', async () => {
    // Both forms are classified because FR-127 needs to know about both. This
    // pins that we ask exactly twice and not more — the cost is DNS, but an
    // unbounded lookup count would still be a bug worth catching.
    const dns = stubResolver({
      'alamosa.gov': { A: ['192.0.2.1'] },
      'www.alamosa.gov': { A: ['192.0.2.1'] },
    });
    await classifyName('alamosa.gov', dns);
    const names = new Set(dns.asked.map((a) => a.split(' ')[1]));
    assert.deepEqual([...names].sort(), ['alamosa.gov', 'www.alamosa.gov']);
  });
});
