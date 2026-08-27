import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { renderListing, type Listing } from '../../src/site/listing.js';
import type { CaptureFinding } from '../../src/quality/capture.js';
import type { Observation } from '../../src/record/types.js';

const observation = {
  schema: '1', run_id: 'r', target_id: 't', host: 'example.gov', url: 'https://example.gov/',
  dimension: 'availability', checked_at: '2026-08-25T10:00:00Z', outcome: 'success',
  status_code: 200, redirect_chain: [], latency: { samples: 1, median_ms: 120, min_ms: 120, max_ms: 120 },
  tier: 'hot', method: { vantage: 'github-actions/test', timeout_ms: 15000, sample_count: 1, tool_version: '0', source: 'self_run' },
} as unknown as Observation;

function listing(views?: CaptureFinding[]): Listing {
  return {
    host: 'example.gov', domain: 'example.gov', targetIds: ['t'], tier: 'hot', readings: 4,
    latest: observation, state: 'website', cadence: 'hourly',
    firstChecked: '2026-08-20T10:00:00Z', lastChecked: '2026-08-25T10:00:00Z',
    ...(views ? { views } : {}),
  };
}

const view: CaptureFinding = {
  profile: 'phone-blink', width: 412, height: 823, scale: 1, engine: 'blink',
  captured_at: '2026-08-25T10:00:00Z', hash: '1'.repeat(512), rule: 'capture-change/1',
  bytes: 15_356, changed: true,
};

/**
 * Constitution 2.1.0: a view is evidence, and evidence is only worth publishing
 * with what it is evidence *of*. "Stated, not implied" — the device, the
 * viewport and the moment travel with the picture, and it is presented as one
 * moment rather than as the site's settled condition.
 */
describe('a published view says what it is a view of (constitution 2.1.0, FR-340)', () => {
  test('the device, the viewport and the capture time are all shown', () => {
    const html = renderListing(listing([view]));
    assert.match(html, /Phone/i, 'the device the page was rendered as');
    assert.match(html, /412/, 'the width it was rendered at');
    assert.match(html, /823/, 'and the height');
    assert.match(html, /2026-08-25/, 'when the picture was taken');
  });

  test('the picture is presented as one moment, not as how the site is', () => {
    const html = renderListing(listing([view]));
    assert.match(html, /as it looked|at that moment|on the day|when we looked/i,
      'a caption must date the picture rather than let it stand for the site');
    assert.doesNotMatch(html, /this is how .{0,20}looks\b/i);
  });

  test('the image is referenced, never inlined', () => {
    const html = renderListing(listing([view]));
    assert.match(html, /<img[^>]+src="[^"]*phone-blink\.webp"/);
    assert.doesNotMatch(html, /data:image/,
      'inlining would put the page inside the page that describes it');
  });

  test('the image carries its own dimensions, so the page does not jump', () => {
    const html = renderListing(listing([view]));
    const img = html.match(/<img[^>]*>/)![0];
    assert.match(img, /width="412"/);
    assert.match(img, /height="823"/);
    assert.match(img, /loading="lazy"/, 'a listing should not fetch pictures nobody scrolled to');
    assert.match(img, /alt="[^"]{10,}"/, 'a screenshot needs a description for anyone not seeing it');
  });

  test('a site with no view says so, rather than showing a gap', () => {
    const html = renderListing(listing());
    assert.doesNotMatch(html, /<img/);
    assert.match(html, /not been photographed|no view|not yet/i,
      'absence of a picture is absence, and should read as such');
  });

  test('two devices are shown as two views, each labelled', () => {
    const html = renderListing(listing([
      view,
      { ...view, profile: 'desktop-blink', width: 1920, height: 1080, bytes: 24_918 },
    ]));
    assert.match(html, /Phone/i);
    assert.match(html, /Desktop/i);
    assert.equal((html.match(/<img/g) ?? []).length, 2);
  });
});

describe('a view that could not be taken says so (Principle IV)', () => {
  test('a device that failed is named, with the reason, beside the ones that worked', () => {
    const html = renderListing({
      ...listing([view]),
      view_failures: [{ profile: 'phone-webkit', reason: 'TypeError: Load failed' }],
    });
    assert.match(html, /Phone \(Safari\)/, 'the device must be named in the reader\'s terms');
    assert.match(html, /could not be|failed/i, 'and said not to have been taken');
    assert.match(html, /Load failed/, 'with what stopped it, so nobody has to guess');
    assert.match(html, /<img/, 'while the views that did work are still shown');
  });

  test('a failure is not dressed as a finding about the site', () => {
    const html = renderListing({
      ...listing(),
      view_failures: [{ profile: 'phone-webkit', reason: 'TypeError: Load failed' }],
    });
    assert.doesNotMatch(html, /\b(broken|down|unusable|failing site)\b/i,
      'our camera failing is not a finding about their website');
  });
});
