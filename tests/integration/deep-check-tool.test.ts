import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readingFromRun, type ToolResult } from '../../src/quality/deep-check.js';
import { PRESETS } from '../../src/quality/runner.js';

/**
 * The unit tests build readings from a hand-written result, which proves the code
 * agrees with itself. This one builds a reading from *real* Lighthouse 13.4.1
 * output, captured against a local fixture page (see the fixture's README), which
 * is the only way to find out whether the structural type this project reads the
 * tool through is actually the shape the tool emits.
 */
// Read from the source tree rather than the build output: `tsc` compiles the
// tests but does not copy data files, and a build step that shuffles fixtures
// around is more machinery than one path is worth.
const lhr = JSON.parse(
  readFileSync(resolve(process.cwd(), 'tests/fixtures/lighthouse/local-fixture-page.json'), 'utf8'),
) as ToolResult;

const context = {
  run_id: '2026-08-26T10:00:00Z/quality/fixture01',
  target_id: 'fixture-local',
  host: '127.0.0.1',
  url: 'http://127.0.0.1/',
  vantage: 'github-actions/test',
  preset: 'lighthouse:default/mobile',
};

describe('a reading built from real tool output (FR-320, FR-321)', () => {
  test('every published metric is found in the tool\'s own audits', () => {
    const r = readingFromRun(lhr, context);
    // If the tool renames or drops an audit, this is where it should be noticed —
    // not months later as a column that quietly stopped being published.
    for (const name of [
      'largest_contentful_paint', 'cumulative_layout_shift', 'total_blocking_time',
      'speed_index', 'first_contentful_paint', 'time_to_interactive',
      'server_response_time', 'total_byte_weight',
    ]) {
      assert.ok(name in r.metrics, `${name} is no longer produced by this tool version`);
      assert.equal(typeof r.metrics[name]!.value, 'number');
    }
    assert.equal(r.metrics['cumulative_layout_shift']!.unit, 'unitless');
    assert.equal(r.metrics['total_byte_weight']!.unit, 'byte');
    assert.equal(r.metrics['largest_contentful_paint']!.unit, 'millisecond');
  });

  test('the emulation the tool actually applied is what gets recorded', () => {
    const r = readingFromRun(lhr, context);
    assert.equal(r.method.tool_version, '13.4.1');
    assert.equal(r.method.device.form_factor, 'mobile');
    assert.equal(r.method.device.mobile, true);
    assert.ok(r.method.device.width > 0 && r.method.device.height > 0);
    assert.ok(r.method.network.rtt_ms > 0, 'the default preset throttles; an unthrottled reading is a different measurement');
    assert.ok(r.method.network.throughput_kbps > 0);
    assert.equal(r.method.network.method, 'simulate');
  });

  test('no derived figure from the tool reaches the record (D3)', () => {
    // The fixture keeps the category scores precisely so this can fail if one
    // leaks through. Matching on their *values* would be useless — a local page
    // scores a clean 1 — so the assertion is on shape: no key anywhere in the
    // reading may be a score, a grade, or the tool's own category rollup.
    const categories = (lhr as unknown as { categories: Record<string, { score: number }> }).categories;
    assert.ok(Object.keys(categories).length >= 4,
      'the fixture must still carry the scores it exists to guard against');

    const derived = /^(score|scoreDisplayMode|categories|category|grade|rating|weight)$/i;
    const offending: string[] = [];
    const walk = (node: unknown, path: string) => {
      if (node === null || typeof node !== 'object') return;
      for (const [key, value] of Object.entries(node)) {
        if (derived.test(key)) offending.push(`${path}.${key}`);
        walk(value, `${path}.${key}`);
      }
    };
    walk(readingFromRun(lhr, context), 'reading');
    assert.deepEqual(offending, [],
      'the record is the measured layer; a rollup belongs to analysis, where its rule can be published');
  });

  test('the 150-odd pass/fail audits contribute no numbers', () => {
    const r = readingFromRun(lhr, context);
    const audits = Object.keys((lhr as unknown as { audits: object }).audits);
    assert.ok(audits.length > 100, 'the fixture holds the tool\'s full audit set');
    assert.equal(Object.keys(r.metrics).length, 8,
      'only the published metric list is carried; the record is not whatever the tool happened to emit');
  });
});

/**
 * The one thing a recorded fixture cannot guard, because it is a fact about the
 * installed tool rather than about a past run.
 */
describe('the presets stay the tool\'s own (FR-320)', () => {
  test('the device user agents match what the tool ships', async () => {
    const { userAgents } = (await import('lighthouse/core/config/constants.js')) as unknown as {
      userAgents: { mobile: string; desktop: string };
    };
    // A device string that silently drifted out of date would change which page a
    // site serves us, and every reading after that would be of a different page
    // than it claims to be.
    assert.equal(PRESETS['mobile']!.deviceUserAgent, userAgents.mobile);
    assert.equal(PRESETS['desktop']!.deviceUserAgent, userAgents.desktop);
  });
});
