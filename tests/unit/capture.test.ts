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

  test('every profile captures at 1x, because the doubling is the storage argument', () => {
    // Measured on a local fixture, above the fold, WebP quality 75: 14.7 KB at
    // 1x against 31.8 KB at 2x. Across the frame that difference is the whole
    // reason captures are affordable. A view is evidence of layout, not of
    // typography, and 1x is enough for layout.
    for (const p of CAPTURE_PROFILES) {
      assert.equal(p.scale, 1, `${p.id} captures at ${p.scale}x`);
    }
  });

  test('a phone and a desktop are both covered, since half of traffic is each', () => {
    assert.ok(CAPTURE_PROFILES.some((p: CaptureProfile) => p.formFactor === 'phone'));
    assert.ok(CAPTURE_PROFILES.some((p: CaptureProfile) => p.formFactor === 'desktop'));
  });

  test('both engines are covered, because one cannot speak for the other', () => {
    // Safari is 16.47% of browsers and renders on a different engine. A Blink
    // capture labelled as Safari would be a claim about what a visitor sees that
    // is simply untrue.
    const engines = new Set(CAPTURE_PROFILES.map((p: CaptureProfile) => p.engine));
    assert.ok(engines.has('blink'), 'Chrome, Edge, Samsung and Opera are about 77.5% of browsers');
    assert.ok(engines.has('webkit'), 'Safari is 16.47%, and no Blink profile covers it');
  });

  test('every profile id says which engine took the view', () => {
    // The id becomes the image filename and the caption's key. A view whose
    // engine is not in its name invites a Blink picture being read as Safari.
    for (const p of CAPTURE_PROFILES) {
      assert.ok(p.id.endsWith(`-${p.engine}`), `${p.id} does not name its engine`);
    }
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
  const A = ('1'.repeat(16) + '0'.repeat(16)).repeat(CHANGE_RULE.bits / 32); // as wide as the real thing

  test('an identical view is not a change', () => {
    assert.equal(hasMeaningfullyChanged(hash(A), hash(A)), false);
  });

  test('a first view is always a change — there is nothing to compare to', () => {
    assert.equal(hasMeaningfullyChanged(undefined, hash(A)), true);
    assert.equal(hasMeaningfullyChanged('', hash(A)), true);
  });

  test('a handful of differing bits is noise, not a redesign', () => {
    // Below the threshold but not zero: the wobble a re-render produces.
    const nudged = A.split('');
    for (let i = 0; i < CHANGE_RULE.threshold; i++) nudged[i * 7] = nudged[i * 7] === '1' ? '0' : '1';
    const near = nudged.join('');
    assert.ok(distance(A, near) > 0, 'the fixture must actually differ');
    assert.ok(distance(A, near) <= CHANGE_RULE.threshold);
    assert.equal(hasMeaningfullyChanged(A, near), false);
  });

  test('a wholly different page is a change', () => {
    const other = A.split('').map((b) => (b === '1' ? '0' : '1')).join('');
    assert.equal(distance(A, other), CHANGE_RULE.bits);
    assert.equal(hasMeaningfullyChanged(A, other), true);
  });

  test('the threshold is stated and versioned, so a change to it is visible', () => {
    assert.match(CHANGE_RULE.version, /\/\d+$/, 'versioned like presence/1');
    assert.ok(CHANGE_RULE.threshold > 0 && CHANGE_RULE.threshold < CHANGE_RULE.bits / 2,
      'a threshold at or above half the bits would call two unrelated pages the same');
    assert.ok(CHANGE_RULE.what.length > 20, 'it must say in words what it compares');
    // We drew this line rather than citing one, so it has to show its working.
    assert.match(CHANGE_RULE.basis, /\d/, 'a threshold we chose must state what it was chosen from');
    assert.ok(CHANGE_RULE.basis.includes('measured'), 'and that it was measured rather than assumed');
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
    hash: '1'.repeat(256),
    rule: CHANGE_RULE.version,
    bytes: 31_402,
    changed: true,
  };

  test('a finding carries no image data of any kind', () => {
    const json = JSON.stringify(finding);
    assert.doesNotMatch(json, /data:image|base64|iVBOR|UklGR/,
      'a rendered frame is the page, not a measurement of it');
    assert.ok(json.length < 700, `a finding must stay small: ${json.length} bytes`);
  });

  test('a finding states the device profile, the viewport and when it was taken', () => {
    for (const field of ['profile', 'width', 'height', 'engine', 'captured_at'] as const) {
      assert.ok(finding[field] !== undefined, `${field} is required — a view is one moment, stated`);
    }
    assert.match(finding.captured_at, /Z$/);
  });
});
