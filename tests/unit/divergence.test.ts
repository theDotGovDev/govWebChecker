import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { divergences, MIN_BROWSER_RUNS } from '../../src/site/divergence.js';

/**
 * Where our two methods disagree about the same site.
 *
 * Every hot-tier host is measured twice over, by methods that fail differently:
 * an hourly HTTP request, and a daily load in a real browser. A site that
 * answers 200 while serving a block page, a challenge screen or an interstitial
 * passes the first and fails the second. That disagreement is the only signal
 * this project has that a published "answered" rate might be counting pages a
 * person could not actually use — and it costs nothing to compute, because both
 * records already exist.
 *
 * The rule that matters most here is the one about not believing a single
 * reading. `www.gsaadvantage.gov` failed one browser check on 2026-08-27 and
 * was carried as an open finding for three days; the four browser runs after it
 * all succeeded, and the HTTP record was 178/178. One observation is not a
 * characterisation of an institution, and this is the code that has to know it.
 */
describe('a divergence is only a finding once it persists', () => {
  const http = (host: string, n: number, outcome = 'success') =>
    Array.from({ length: n }, () => ({ host, outcome }));
  const browser = (host: string, outcomes: string[]) =>
    outcomes.map((outcome) => ({ host, outcome }));

  test('a host healthy over HTTP and failing every browser run is reported', () => {
    const found = divergences(http('a.gov', 100), browser('a.gov', ['check_failed', 'check_failed', 'check_failed']));
    assert.equal(found.length, 1, JSON.stringify(found));
    assert.equal(found[0]!.host, 'a.gov');
  });

  test('one failed browser run among successes is NOT a finding', () => {
    // The gsaadvantage case, verbatim: one failure, then four clean runs.
    const found = divergences(
      http('www.gsaadvantage.gov', 178),
      browser('www.gsaadvantage.gov', ['check_failed', 'measured', 'measured', 'measured', 'measured']),
    );
    assert.deepEqual(found, [], 'a single bad reading is data, not a characterisation');
  });

  test('a host too new to have been browsed enough times is not judged', () => {
    // With one browser run there is nothing to distinguish a real divergence
    // from a transient one, and guessing would name an institution on n=1.
    const found = divergences(http('b.gov', 50), browser('b.gov', ['check_failed']));
    assert.deepEqual(found, [], `fewer than ${MIN_BROWSER_RUNS} browser runs cannot support a finding`);
  });

  test('a host both methods agree is refusing is not a divergence', () => {
    // www.bls.gov is 0% by both. That is a consistent, already-published fact
    // about the site's posture, not a disagreement between our instruments.
    const found = divergences(
      http('www.bls.gov', 100, 'blocked'),
      browser('www.bls.gov', ['check_failed', 'check_failed', 'check_failed']),
    );
    assert.deepEqual(found, []);
  });

  test('a host neither method has a problem with is not a divergence', () => {
    const found = divergences(http('c.gov', 100), browser('c.gov', ['measured', 'measured', 'measured']));
    assert.deepEqual(found, []);
  });

  test('a browser skip is not a browser failure', () => {
    // robots.txt telling us not to look is the site's instruction, honoured.
    // Counting it as a failed render would turn our own politeness into a
    // finding against the site.
    const found = divergences(
      http('secure.login.gov', 100),
      browser('secure.login.gov', ['skipped', 'skipped', 'skipped']),
    );
    assert.deepEqual(found, []);
  });

  test('the report carries the counts a reader needs to check it', () => {
    const found = divergences(http('a.gov', 100), browser('a.gov', ['check_failed', 'check_failed', 'measured']));
    assert.equal(found.length, 1);
    const d = found[0]!;
    assert.equal(d.httpSuccesses, 100);
    assert.equal(d.httpTotal, 100);
    assert.equal(d.browserFailures, 2);
    assert.equal(d.browserTotal, 3);
  });

  test('a host with no browser readings at all is silent, not a finding', () => {
    assert.deepEqual(divergences(http('d.gov', 100), []), []);
  });
});
