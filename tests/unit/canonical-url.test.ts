import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalUrl, URL_RULE } from '../../src/census/url.js';
import type { NameResolution } from '../../src/checker/resolve.js';

const resolved = (apex: boolean, www: boolean): NameResolution => ({
  status: apex || www ? 'address' : 'no_service',
  apex,
  www,
});

/**
 * A census supplies a domain name, not a URL, so the rule that derives one is
 * part of the measurement rather than an implementation detail. It is stated in
 * full at research.md R4 and recorded on every observation, because a reader has
 * to know what was actually requested rather than infer it (FR-129).
 */
describe('deriving the URL to check (FR-126 to FR-130)', () => {
  test('prefers the apex when both forms resolve', () => {
    const url = canonicalUrl('alamosa.gov', resolved(true, true));
    assert.equal(url, 'https://alamosa.gov/');
  });

  test('uses www when only www resolves', () => {
    // 348 domains in the registry. An apex-only rule reports every one as absent.
    const url = canonicalUrl('alamosa.gov', resolved(false, true));
    assert.equal(url, 'https://www.alamosa.gov/');
  });

  test('uses the apex when only the apex resolves', () => {
    // And 567 the other way, which a www-only rule would lose.
    const url = canonicalUrl('alamosa.gov', resolved(true, false));
    assert.equal(url, 'https://alamosa.gov/');
  });

  test('is https, always', () => {
    // No http fallback. An https failure on a government site is a finding, not
    // an artefact to work around — falling back would mask exactly the transport
    // problem this project exists to record, and would spend a struggling site's
    // resources to soften a true observation about it.
    for (const res of [resolved(true, true), resolved(false, true), resolved(true, false)]) {
      assert.match(canonicalUrl('alamosa.gov', res)!, /^https:\/\//);
    }
  });

  test('yields nothing when the domain publishes no web address', () => {
    // There is no URL to derive, and inventing one would send a request to a
    // name we already know publishes nothing.
    assert.equal(canonicalUrl('alamosa.gov', resolved(false, false)), undefined);
  });

  test('yields nothing when our own resolution failed', () => {
    const res: NameResolution = {
      status: 'resolver_error',
      apex: false,
      www: false,
      codes: ['ESERVFAIL'],
    };
    assert.equal(canonicalUrl('alamosa.gov', res), undefined);
  });

  test('names its version, so a later rule is visible as a change', () => {
    assert.match(URL_RULE, /^canonical\/\d+$/);
  });

  test('normalises the domain', () => {
    assert.equal(canonicalUrl('Alamosa.GOV', resolved(true, false)), 'https://alamosa.gov/');
  });
});
