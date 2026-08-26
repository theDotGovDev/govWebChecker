import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { deepCheck, readingFromRun, type ToolRun } from '../../src/quality/deep-check.js';
import { RateLimiter } from '../../src/politeness/rate-limiter.js';

/**
 * A Lighthouse result, cut down to the fields a reading is built from.
 *
 * Deliberately includes `categories` — the tool's composite scores — because one
 * of the guarantees below is that they are *not* carried into the record.
 */
function lhr(overrides: Record<string, unknown> = {}) {
  return {
    lighthouseVersion: '13.4.1',
    fetchTime: '2026-08-26T10:15:00.000Z',
    finalDisplayedUrl: 'https://example.gov/',
    configSettings: {
      formFactor: 'mobile',
      screenEmulation: { width: 412, height: 823, deviceScaleFactor: 1.75, mobile: true, disabled: false },
      throttling: { rttMs: 150, throughputKbps: 1638.4, cpuSlowdownMultiplier: 4 },
      throttlingMethod: 'simulate',
    },
    categories: {
      performance: { id: 'performance', title: 'Performance', score: 0.87 },
      accessibility: { id: 'accessibility', title: 'Accessibility', score: 0.95 },
    },
    audits: {
      'largest-contentful-paint': { id: 'largest-contentful-paint', score: 0.9, numericValue: 2412.3, numericUnit: 'millisecond' },
      'cumulative-layout-shift': { id: 'cumulative-layout-shift', score: 1, numericValue: 0.021, numericUnit: 'unitless' },
      'total-blocking-time': { id: 'total-blocking-time', score: 0.8, numericValue: 190, numericUnit: 'millisecond' },
      'speed-index': { id: 'speed-index', score: 0.7, numericValue: 3300, numericUnit: 'millisecond' },
      'first-contentful-paint': { id: 'first-contentful-paint', score: 0.95, numericValue: 1100, numericUnit: 'millisecond' },
      'server-response-time': { id: 'server-response-time', score: 1, numericValue: 240, numericUnit: 'millisecond' },
      'total-byte-weight': { id: 'total-byte-weight', score: 0.6, numericValue: 2_400_000, numericUnit: 'byte' },
      'uses-responsive-images': { id: 'uses-responsive-images', score: 0.5, scoreDisplayMode: 'binary' },
      ...(overrides['audits'] as object ?? {}),
    },
    ...overrides,
  } as unknown as Parameters<typeof readingFromRun>[0];
}

const context = {
  run_id: '2026-08-26T10:00:00Z/quality/abc12345',
  target_id: 'example-gov',
  host: 'example.gov',
  url: 'https://example.gov/',
  vantage: 'github-actions/ubuntu-24.04',
  preset: 'lighthouse:default/mobile',
};

function limiter() {
  return new RateLimiter({ hostIntervalMs: 0, domainIntervalMs: 0, addressIntervalMs: 0 });
}

/**
 * A deep reading is a bigger claim than an availability reading — it says how a
 * page performed for an emulated visitor on an emulated connection. Principle V
 * therefore applies harder, not more loosely: the emulation *is* the method, and
 * a number without it is not comparable to anything.
 */
describe('a deep reading carries the emulation that produced it (FR-321)', () => {
  test('the tool, its version, the preset, the device and the network are all recorded', () => {
    const r = readingFromRun(lhr(), context);
    assert.equal(r.method.tool, 'lighthouse');
    assert.equal(r.method.tool_version, '13.4.1');
    assert.equal(r.method.preset, 'lighthouse:default/mobile');
    assert.equal(r.method.device.form_factor, 'mobile');
    assert.equal(r.method.device.width, 412);
    assert.equal(r.method.device.height, 823);
    assert.equal(r.method.network.rtt_ms, 150);
    assert.equal(r.method.network.throughput_kbps, 1638.4);
    assert.equal(r.method.network.cpu_slowdown, 4);
    assert.equal(r.method.vantage, 'github-actions/ubuntu-24.04');
  });

  test('a reading with no emulation recorded is not produced at all', () => {
    const naked = lhr({ configSettings: { formFactor: 'mobile' } });
    assert.throws(() => readingFromRun(naked, context), /emulation/i,
      'a number whose network and screen are unknown is not comparable and must not be stored');
  });
});

/**
 * D3: the record is the *measured* layer. Lighthouse's category scores are a
 * weighted composite — legitimate analysis, and reproducible from the audit
 * values plus a published weighting, which is exactly why they do not need to be
 * stored. Storing them would put a derived figure in the layer that is supposed
 * to hold only what was observed.
 */
describe('the record stores what was measured, not what the tool concluded (D3)', () => {
  test('raw audit values are stored with their units', () => {
    const r = readingFromRun(lhr(), context);
    assert.deepEqual(r.metrics['largest_contentful_paint'], { value: 2412.3, unit: 'millisecond' });
    assert.deepEqual(r.metrics['cumulative_layout_shift'], { value: 0.021, unit: 'unitless' });
    assert.deepEqual(r.metrics['total_byte_weight'], { value: 2_400_000, unit: 'byte' });
    assert.deepEqual(r.metrics['server_response_time'], { value: 240, unit: 'millisecond' });
  });

  test("the tool's composite category scores are not carried into the record", () => {
    const json = JSON.stringify(readingFromRun(lhr(), context));
    assert.doesNotMatch(json, /"score"/, 'a per-audit or category score is a derived figure');
    assert.doesNotMatch(json, /0\.87|0\.95/, 'the performance and accessibility composites must not appear');
    assert.doesNotMatch(json, /categor/i);
  });

  test('an audit the tool did not measure contributes no metric rather than a zero', () => {
    // The fixture omits `interactive` entirely and reports `server-response-time`
    // as pass/fail with no number. Both are absences, and absence is shown as
    // absence — never as zero, which would read as an instantaneous page.
    const r = readingFromRun(
      lhr({ audits: { 'server-response-time': { id: 'server-response-time', score: 1 } } }),
      context,
    );
    assert.ok(!('time_to_interactive' in r.metrics),
      'an audit the tool never reported must not appear as a measurement of zero');
    assert.ok(!('server_response_time' in r.metrics),
      'a pass/fail audit has no number, and a fabricated zero would be the fastest reading on the site');
    assert.ok(!('uses_responsive_images' in r.metrics),
      'only the published metric list is carried into the record');
    for (const [name, m] of Object.entries(r.metrics)) {
      assert.equal(typeof m.value, 'number', `${name} must hold a measured number`);
      assert.ok(m.unit.length > 0, `${name} must state its unit`);
    }
  });
});

describe('a deep check is one visitor, once (FR-322, FR-324)', () => {
  test('the tool is run exactly once per target', async () => {
    let calls = 0;
    const run: ToolRun = async () => { calls += 1; return lhr(); };
    await deepCheck(context, { run, limiter: limiter() });
    assert.equal(calls, 1, 'a second navigation to build a sample is prohibited');
  });

  test('a failed run is recorded as a failed check and never retried', async () => {
    let calls = 0;
    const run: ToolRun = async () => { calls += 1; throw new Error('NO_FCP: page did not paint'); };
    const r = await deepCheck(context, { run, limiter: limiter() });
    assert.equal(calls, 1, 'retrying against a site that just failed is what Principle I forbids');
    assert.equal(r.outcome, 'check_failed');
    assert.match(r.check_failure!, /NO_FCP/);
    assert.deepEqual(r.metrics, {}, 'a failed check reports no metrics, not zeroed ones');
  });

  test('a check failure is never expressed in availability terms (FR-324)', async () => {
    const run: ToolRun = async () => { throw new Error('protocol timeout'); };
    const r = await deepCheck(context, { run, limiter: limiter() });
    assert.equal(r.dimension, 'quality');
    const json = JSON.stringify(r);
    for (const availability of ['timeout', 'http_error', 'connection_failure', 'dns_failure']) {
      assert.doesNotMatch(json, new RegExp(`"outcome":\\s*"${availability}"`),
        'a tool that could not measure the page says nothing about whether the site was up');
    }
  });

  test('the check waits for the limiter before navigating', async () => {
    const order: string[] = [];
    const slow = new RateLimiter({ hostIntervalMs: 0, domainIntervalMs: 0, addressIntervalMs: 0 });
    const original = slow.acquire.bind(slow);
    slow.acquire = async (host: string, address?: string) => {
      order.push('acquire');
      return original(host, address);
    };
    const run: ToolRun = async () => { order.push('navigate'); return lhr(); };
    await deepCheck(context, { run, limiter: slow });
    assert.deepEqual(order, ['acquire', 'navigate'],
      'the limiter is the only thing standing between this and unbounded traffic');
  });
});

/**
 * The tool holds frames of the rendered page in memory — that is how it measures
 * paint at all, and the constitution permits it. What it must never do is put one
 * in the record: this project stores measurements of a site, not the site.
 */
describe('no part of the page reaches the reading (Principle IV)', () => {
  test('a result carrying rendered frames yields a reading carrying none', () => {
    const withFrames = lhr({
      audits: {
        'final-screenshot': { id: 'final-screenshot', details: { data: 'data:image/webp;base64,AAAA' } },
        'screenshot-thumbnails': {
          id: 'screenshot-thumbnails',
          details: { items: [{ data: 'data:image/jpeg;base64,BBBB' }] },
        },
        'largest-contentful-paint': {
          id: 'largest-contentful-paint', numericValue: 2412.3, numericUnit: 'millisecond',
          details: { debugData: { snippet: '<h1>Some page text</h1>' } },
        },
      },
    });
    const json = JSON.stringify(readingFromRun(withFrames, context));
    assert.doesNotMatch(json, /data:image/, 'a rendered frame is the page, not a measurement of it');
    assert.doesNotMatch(json, /Some page text/, 'nor is a snippet of its content');
    assert.doesNotMatch(json, /details/, 'a reading copies named metrics; it does not filter a result');
    assert.equal(JSON.parse(json).metrics.largest_contentful_paint.value, 2412.3);
  });
});

/**
 * The availability record dates a reading to the moment the limiter released it,
 * not to a clock read later, so the gap between two published timestamps is the
 * gap the limiter arithmetic actually produced. A deep reading has to do the
 * same, or the record's spacing could not be checked by a reader — and the tool's
 * own `fetchTime` is a different clock in a different process.
 */
describe('a reading is dated to when the limiter released it', () => {
  test('checked_at is the grant moment, not the tool\'s fetchTime', async () => {
    const lim = limiter();
    let granted = 0;
    const original = lim.acquire.bind(lim);
    lim.acquire = async (host: string, address?: string) => {
      granted = await original(host, address);
      return granted;
    };
    // The tool reports a fetchTime from a year that never happened, so a reading
    // that trusted it would be unmistakable.
    const run: ToolRun = async () => lhr({ fetchTime: '2001-01-01T00:00:00.000Z' });
    const r = await deepCheck(context, { run, limiter: lim });
    assert.equal(r.checked_at, `${new Date(granted).toISOString().slice(0, 19)}Z`);
    assert.doesNotMatch(r.checked_at, /^2001/);
  });
});
