import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  CAPTURE_PROFILES, CHANGE_RULE, hasMeaningfullyChanged, distance,
  type CaptureFinding, type CaptureProfile,
} from '../../src/quality/capture.js';

function hash(bits: string): string {
  return bits;
}

/**
 * The profiles are a data decision (D5), taken from published traffic share
 * rather than preference. They are asserted because a profile that drifted would
 * silently change what "what a visitor sees" means.
 */
describe('the device profiles are the ones the traffic data chose (D5)', () => {
  test('each profile states its engine, viewport and why it earns a place', () => {
    assert.ok(CAPTURE_PROFILES.length >= 2);
    for (const p of CAPTURE_PROFILES) {
      assert.match(p.id, /^[a-z0-9-]+$/);
      assert.ok(p.width > 0 && p.height > 0, `${p.id} must state a viewport`);
      assert.ok(['blink', 'webkit'].includes(p.engine), `${p.id}: ${p.engine}`);
      assert.ok(p.share > 0, `${p.id} must record the traffic share that justified it`);
      assert.ok(p.source.includes('StatCounter'), `${p.id} must cite where that share came from`);
    }
  });

  test('a phone and a desktop are both covered, since half of traffic is each', () => {
    assert.ok(CAPTURE_PROFILES.some((p: CaptureProfile) => p.formFactor === 'phone'));
    assert.ok(CAPTURE_PROFILES.some((p: CaptureProfile) => p.formFactor === 'desktop'));
  });

  test('tablet is absent, and that is the data speaking', () => {
    // The type forbids it too, which is the stronger guarantee; this states the
    // decision in the place a reader would look for it.
    const factors = CAPTURE_PROFILES.map((p: CaptureProfile) => String(p.formFactor));
    assert.ok(!factors.includes('tablet'),
      '1.50% of traffic does not justify a third of the capture cost (D5)');
  });
});

/**
 * "Check if the screenshot has meaningfully changed before storing" — the
 * owner's instruction. Meaningfully is the load-bearing word: a page whose only
 * difference is an antialiasing wobble or a rotating banner image has not
 * changed in any sense a reader cares about, and re-storing it would spend the
 * saving the check exists to buy.
 */
describe('a view is re-stored only when it meaningfully changed (D6, FR-344)', () => {
  const A = '1'.repeat(32) + '0'.repeat(32);

  test('an identical view is not a change', () => {
    assert.equal(hasMeaningfullyChanged(hash(A), hash(A)), false);
  });

  test('a first view is always a change — there is nothing to compare to', () => {
    assert.equal(hasMeaningfullyChanged(undefined, hash(A)), true);
    assert.equal(hasMeaningfullyChanged('', hash(A)), true);
  });

  test('a handful of differing bits is noise, not a redesign', () => {
    const nudged = '0' + A.slice(1, 60) + '1010';
    assert.ok(distance(A, nudged) > 0, 'the fixture must actually differ');
    assert.ok(distance(A, nudged) <= CHANGE_RULE.threshold);
    assert.equal(hasMeaningfullyChanged(A, nudged), false);
  });

  test('a wholly different page is a change', () => {
    const other = '0'.repeat(32) + '1'.repeat(32);
    assert.equal(distance(A, other), 64);
    assert.equal(hasMeaningfullyChanged(A, other), true);
  });

  test('the threshold is stated and versioned, so a change to it is visible', () => {
    assert.match(CHANGE_RULE.version, /\/\d+$/, 'versioned like presence/1');
    assert.ok(CHANGE_RULE.threshold > 0 && CHANGE_RULE.threshold < 32,
      'a threshold at or above half the bits would call two unrelated pages the same');
    assert.ok(CHANGE_RULE.what.length > 20, 'it must say in words what it compares');
  });

  test('hashes of different lengths are refused rather than compared', () => {
    // Silently comparing a 64-bit hash to a 32-bit one would return a distance
    // that means nothing, and mean nothing loudly enough to be believed.
    assert.throws(() => distance(A, '1010'), /length/i);
  });
});

/**
 * Constitution 2.1.0: a view never enters the record. The record stores the
 * finding — hash, dimensions, profile, capture time — which is small, permanent,
 * and is what makes "this page changed on the 14th" answerable forever.
 */
describe('the record stores the finding, never the view (constitution 2.1.0)', () => {
  const finding: CaptureFinding = {
    profile: 'phone-blink',
    width: 412,
    height: 823,
    scale: 2,
    engine: 'blink',
    captured_at: '2026-08-26T10:15:00Z',
    hash: '1'.repeat(64),
    rule: CHANGE_RULE.version,
    bytes: 31_402,
    changed: true,
  };

  test('a finding carries no image data of any kind', () => {
    const json = JSON.stringify(finding);
    assert.doesNotMatch(json, /data:image|base64|iVBOR|UklGR/,
      'a rendered frame is the page, not a measurement of it');
    assert.ok(json.length < 400, `a finding must stay small: ${json.length} bytes`);
  });

  test('a finding states the device profile, the viewport and when it was taken', () => {
    for (const field of ['profile', 'width', 'height', 'engine', 'captured_at'] as const) {
      assert.ok(finding[field] !== undefined, `${field} is required — a view is one moment, stated`);
    }
    assert.match(finding.captured_at, /Z$/);
  });
});
