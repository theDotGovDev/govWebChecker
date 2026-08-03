import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { nextDelayMs } from '../../src/politeness/backoff.js';

const BASE = 1_000;
const MAX = 60_000;

describe('backoff after failure (FR-006)', () => {
  test('a healthy target waits exactly the base interval', () => {
    assert.equal(nextDelayMs({ baseMs: BASE, maxMs: MAX, consecutiveFailures: 0 }), BASE);
  });

  test('a failing target always waits LONGER, never shorter', () => {
    for (let failures = 1; failures <= 10; failures++) {
      const delay = nextDelayMs({ baseMs: BASE, maxMs: MAX, consecutiveFailures: failures });
      assert.ok(
        delay > BASE,
        `after ${failures} failures the wait was ${delay}ms, not longer than the ${BASE}ms base. ` +
          'A struggling site must receive less traffic from us, never more.',
      );
    }
  });

  test('the wait grows monotonically with consecutive failures', () => {
    let previous = nextDelayMs({ baseMs: BASE, maxMs: MAX, consecutiveFailures: 0 });
    for (let failures = 1; failures <= 6; failures++) {
      const delay = nextDelayMs({ baseMs: BASE, maxMs: MAX, consecutiveFailures: failures });
      assert.ok(delay >= previous, `wait shrank from ${previous}ms to ${delay}ms`);
      previous = delay;
    }
  });

  test('the wait is capped so a target is not abandoned forever', () => {
    const delay = nextDelayMs({ baseMs: BASE, maxMs: MAX, consecutiveFailures: 50 });
    assert.equal(delay, MAX);
  });

  test('recovery returns to the base interval, and never below it', () => {
    const recovered = nextDelayMs({ baseMs: BASE, maxMs: MAX, consecutiveFailures: 0 });
    assert.equal(recovered, BASE);
    assert.ok(recovered >= BASE, 'recovery must never tighten below the normal cadence');
  });
});
