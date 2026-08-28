import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { dueForCheck, MIN_CHECK_INTERVAL_MS } from '../../src/checker/due.js';

/**
 * The floor that lets the schedule be over-provisioned without over-collecting.
 *
 * GitHub does not drop scheduled events so much as *delay* them, and it holds
 * only one pending run per workflow — so an eleven-hour delay collapses eleven
 * pending hourly runs into one. The answer is several workflows with their own
 * schedule queues, which means more runs arriving than the cadence calls for,
 * some of them bunched together as a backlog drains.
 *
 * So the cadence floor moves out of the cron and into the code, where it cannot
 * be forgotten. This is the same promotion as the concurrency fix: a guarantee
 * that held only within one process, made to hold across runs by reading the
 * record. The cron becomes a best-effort trigger; this decides whether traffic
 * is actually sent.
 */
describe('a check is due only when the record says the last one is old enough', () => {
  const HOSTS = ['www.irs.gov', 'www.ssa.gov'];
  const now = Date.parse('2026-08-27T12:00:00Z');
  const row = (host: string, checked_at: string) => ({ host, checked_at });

  test('a fresh reading means not due, and no traffic is sent', () => {
    const verdict = dueForCheck(
      [row('www.irs.gov', '2026-08-27T11:30:00Z')],
      HOSTS,
      now,
    );
    assert.equal(verdict.due, false, '30 minutes is inside the floor');
    assert.match(verdict.reason, /30m/, `the reason must say how recent: ${verdict.reason}`);
  });

  test('a reading older than the floor means due', () => {
    const verdict = dueForCheck(
      [row('www.irs.gov', '2026-08-27T11:00:00Z')],
      HOSTS,
      now,
    );
    assert.equal(verdict.due, true, '60 minutes is past the 55-minute floor');
  });

  test('an empty record is due — the first run must not be blocked', () => {
    assert.equal(dueForCheck([], HOSTS, now).due, true);
  });

  test('the newest reading governs, not the oldest', () => {
    // All-or-nothing runs mean every host shares a cadence; one host checked
    // recently means the run just happened, whatever the others say.
    const verdict = dueForCheck(
      [row('www.irs.gov', '2026-08-20T00:00:00Z'), row('www.ssa.gov', '2026-08-27T11:59:00Z')],
      HOSTS,
      now,
    );
    assert.equal(verdict.due, false, 'a stale host does not license a burst against a fresh one');
  });

  test('only the hosts about to be checked are considered', () => {
    // `--only` narrows the set, and so must the floor: another host's reading
    // says nothing about whether this one is due.
    const verdict = dueForCheck(
      [row('other.gov', '2026-08-27T11:59:00Z')],
      ['www.irs.gov'],
      now,
    );
    assert.equal(verdict.due, true, "another host's freshness is not this host's");
  });

  test('a reading counts whichever collector took it', () => {
    // The census and the hourly check can reach the same host. Traffic is
    // traffic, so a census reading of this host holds the floor too — the row's
    // tier is deliberately not consulted.
    const censusRow = { host: 'www.irs.gov', checked_at: '2026-08-27T11:59:00Z', tier: 'broad' };
    const verdict = dueForCheck([censusRow], HOSTS, now);
    assert.equal(verdict.due, false);
  });

  test('a timestamp in the future is not treated as ancient', () => {
    const verdict = dueForCheck(
      [row('www.irs.gov', '2026-08-27T18:00:00Z')],
      HOSTS,
      now,
    );
    assert.equal(verdict.due, false, 'clock skew must not open the floor');
  });

  test('the floor is under an hour, so an on-time hourly run is never skipped', () => {
    // A run arriving exactly on its hourly slot, a minute early, must still
    // work. A floor of a full hour would silently halve the cadence.
    assert.ok(MIN_CHECK_INTERVAL_MS < 3_600_000, 'the floor must leave room for jitter');
    assert.ok(MIN_CHECK_INTERVAL_MS > 30 * 60_000, 'and must still bound the traffic');
  });
});
