import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { registrableDomain } from '../../src/politeness/domain.js';

describe('registrableDomain', () => {
  test('collapses a subdomain to its registrable domain', () => {
    assert.equal(registrableDomain('www.irs.gov'), 'irs.gov');
    assert.equal(registrableDomain('benefits.va.gov'), 'va.gov');
    assert.equal(registrableDomain('my.health.va.gov'), 'va.gov');
  });

  test('leaves an already-registrable domain alone', () => {
    assert.equal(registrableDomain('irs.gov'), 'irs.gov');
  });

  test('is case-insensitive and ignores a trailing dot', () => {
    assert.equal(registrableDomain('WWW.IRS.GOV'), 'irs.gov');
    assert.equal(registrableDomain('www.irs.gov.'), 'irs.gov');
  });

  test('groups the hosts of one agency together', () => {
    const hosts = ['www.va.gov', 'benefits.va.gov', 'myhealth.va.gov'];
    const domains = new Set(hosts.map(registrableDomain));
    assert.equal(domains.size, 1, 'all VA hosts must share one rate-limit key');
  });

  // Documents the known limit recorded in research.md R4. The two-label rule is
  // correct for every .gov, which is this release's entire scope. It is wrong for
  // multi-label public suffixes, which arrive with state and local government.
  // This test asserts CURRENT behavior so the day it changes is deliberate.
  test('KNOWN LIMIT: multi-label public suffixes are not handled', () => {
    assert.equal(
      registrableDomain('www.dot.state.tx.us'),
      'tx.us',
      'two-label rule returns tx.us; the correct answer is dot.state.tx.us. ' +
        'Fixing this means adopting the Public Suffix List — see research.md R4.',
    );
  });
});
