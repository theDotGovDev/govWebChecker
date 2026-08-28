import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The six schedule queues, checked as a set.
 *
 * They exist because GitHub delays scheduled events and holds only one pending
 * run per workflow, so an hourly cron collapses under a delay longer than an
 * hour. Six six-hourly workflows keep delivering — but only if they actually
 * stagger. Six schedules that drifted onto the same hours would look like six
 * queues and behave like one, and nothing else in the repo would notice.
 */
describe('the check schedules cover the day between them', () => {
  const dir = path.resolve('.github/workflows');
  const callers = fs.readdirSync(dir).filter((f) => /^check-[a-z]\.yml$/.test(f)).sort();
  const read = (f: string) => fs.readFileSync(path.join(dir, f), 'utf8');

  function hoursOf(text: string): number[] {
    const cron = text.match(/- cron: '([^']+)'/)?.[1];
    assert.ok(cron, 'a caller must declare a cron');
    const [, hours] = cron.split(/\s+/);
    return hours!.split(',').map(Number);
  }

  test('there are six of them', () => {
    assert.equal(callers.length, 6, `found ${callers.join(', ')}`);
  });

  test('every hour of the day is covered exactly once', () => {
    const seen = new Map<number, string[]>();
    for (const file of callers) {
      for (const hour of hoursOf(read(file))) {
        seen.set(hour, [...(seen.get(hour) ?? []), file]);
      }
    }
    const missing = [...Array(24).keys()].filter((h) => !seen.has(h));
    const doubled = [...seen].filter(([, files]) => files.length > 1);
    assert.deepEqual(missing, [], 'an uncovered hour is a guaranteed gap in the record');
    assert.deepEqual(doubled, [], 'two schedules on one hour waste a queue that another hour needs');
  });

  test('no two fire in the same minute of the hour', () => {
    // Staggering the minute matters as much as the hour: GitHub names the top of
    // the hour as a high-load period, and identical minutes would queue together.
    const minutes = callers.map((f) => read(f).match(/- cron: '(\d+)/)![1]!);
    assert.equal(new Set(minutes).size, 6, `minutes collide: ${minutes.join(', ')}`);
    assert.ok(
      minutes.every((m) => !['0', '00', '15', '30', '45'].includes(m)),
      `a popular minute invites the delay this design exists to avoid: ${minutes.join(', ')}`,
    );
  });

  test('each caller delegates rather than carrying its own copy of the job', () => {
    for (const file of callers) {
      assert.match(read(file), /uses: \.\/\.github\/workflows\/check\.yml/, file);
    }
  });

  test('the collector owns the traffic group, and the callers do not', () => {
    // Declaring the group in both places deadlocks: the caller would hold
    // `target-traffic` while the job it called queued for the same group.
    assert.match(read('check.yml'), /group: target-traffic/);
    for (const file of callers) {
      assert.doesNotMatch(read(file), /concurrency:/, `${file} must not take the group its callee needs`);
    }
  });

  test('the collector carries a schedule of its own, as the proven seventh queue', () => {
    // It used to be asserted that it must NOT, on the grounds that it would
    // double-collect. That reasoning is obsolete: the cadence floor means a
    // second run inside the hour sends nothing, so redundancy is free.
    //
    // And the cost of the old rule was real. Removing this schedule replaced the
    // one queue GitHub was demonstrably still delivering with six unproven ones,
    // and collection went from three runs a day to none.
    assert.match(read('check.yml'), /- cron: '\d+ [\d,]+ \* \* \*'/);
  });

  test('every caller can be triggered by hand', () => {
    // Six schedule-only workflows are six that cannot be tested. When none of
    // them fired for twelve hours there was no way to tell a registration lag
    // from a call that never worked.
    for (const file of callers) {
      assert.match(read(file), /workflow_dispatch:/, `${file} cannot be exercised without waiting for cron`);
    }
  });
});
