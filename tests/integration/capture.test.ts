import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, readdirSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { CAPTURE_PROFILES, CHANGE_RULE, distance, hasMeaningfullyChanged } from '../../src/quality/capture.js';
import { captureAndHash } from '../../src/quality/capture-runner.js';

function findBrowser(): string | undefined {
  if (process.env['CHROME_PATH']) return process.env['CHROME_PATH'];
  const candidates = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  const pw = process.env['PLAYWRIGHT_BROWSERS_PATH'] ?? '/opt/pw-browsers';
  if (existsSync(pw)) {
    for (const dir of readdirSync(pw)) {
      if (dir.startsWith('chromium')) candidates.push(`${pw}/${dir}/chrome-linux/chrome`);
    }
  }
  return candidates.find((c) => existsSync(c));
}

const CSS =
  'body{margin:0;font-family:system-ui;color:#16191c}' +
  'header{background:#1a4480;color:#fff;padding:1.5rem 1rem}' +
  'nav{background:#eef1f4;padding:.6rem 1rem;display:flex;gap:1rem;font-size:.9rem}' +
  'main{padding:1rem;display:grid;gap:.8rem}' +
  '.card{border:1px solid #d6dbdf;border-radius:8px;padding:.8rem}' +
  '.hero{background:#c9d4e2;height:120px;border-radius:8px}' +
  '.alert{background:#fff3cd;border-left:4px solid #a8500a;padding:.7rem 1rem}';

interface PageOpts { alert?: boolean; year?: number; heading?: string; hero?: string; plain?: boolean }

/**
 * The fixture that broke the first hash tried here: a coloured banner over
 * repeated paragraphs and nothing else. Reduced to an 8×8 average hash, a
 * complete redesign of this page — different banner colour, a quarter of the
 * content — scored a distance of zero.
 */
function bannerPage(background: string, paragraphs: number): string {
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Fixture Agency</title><style>body{margin:0;font-family:system-ui}' +
    `header{background:${background};color:#fff;padding:2rem}p{padding:0 1rem}` +
    '</style></head><body><header><h1>Fixture Agency</h1></header>' +
    '<p>Paragraph of local fixture text.</p>'.repeat(paragraphs) +
    '</body></html>'
  );
}

/**
 * A page with almost no dark area — the shape most government pages actually
 * have, and the one that broke the first hash tried here.
 */
function plainPage(o: PageOpts = {}): string {
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Fixture Agency</title><style>body{margin:0;font-family:system-ui;color:#222;' +
    'background:#fff}h1{font-size:1.3rem;padding:1rem;margin:0}p{padding:0 1rem;margin:.4rem 0}' +
    `</style></head><body><h1>${o.heading ?? 'Fixture Agency'}</h1>` +
    (o.alert ? '<p style="border-left:3px solid #a8500a;padding-left:1rem">Notice.</p>' : '') +
    '<p>Short line of text.</p>'.repeat(o.plain === false ? 2 : 14) +
    '</body></html>'
  );
}

function fixturePage(o: PageOpts = {}): string {
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<title>Fixture Agency</title><style>${CSS}</style></head><body>` +
    (o.alert ? '<div class="alert">Office closed Monday for a public holiday.</div>' : '') +
    `<header><h1>${o.heading ?? 'Fixture Agency'}</h1>` +
    `<p>Serving the public since ${o.year ?? 1953}</p></header>` +
    '<nav><span>Services</span><span>About</span><span>Contact</span><span>News</span></nav>' +
    `<main><div class="hero" style="${o.hero ?? ''}"></div>` +
    // Several viewports tall on purpose: the size bound below is meaningless on
    // a page that fits above the fold, since a full-page capture of one would be
    // no larger than the fold itself.
    ['Permits', 'Records', 'Payments', 'Appeals', 'Licences', 'Inspections', 'Tax', 'Voting',
     'Transit', 'Parks', 'Libraries', 'Schools', 'Health', 'Housing', 'Waste', 'Water']
      .map((c) => `<div class="card"><h2>${c}</h2><p>Text describing a service offered here.</p></div>`)
      .join('') +
    '</main></body></html>'
  );
}

/**
 * Change detection, exercised against real rendered pixels.
 *
 * The unit tests fix the rule's arithmetic. They cannot show whether the rule
 * separates the changes a reader cares about from the ones they do not, and that
 * is the only question worth asking of it — an average hash passed every unit
 * test and returned "unchanged" for a complete redesign, because government
 * pages are mostly white and nearly every cell sat above the mean.
 *
 * Against a local server on 127.0.0.1 — never a government site.
 */
describe('a view changes when a reader would say it changed (D6, FR-344)', () => {
  let server: http.Server;
  let url: string;
  let current = fixturePage();
  let browser: { close(): Promise<void>; newPage(): Promise<unknown> };
  let scratch: import('../../src/quality/capture-runner.js').HashPage;

  const phone = CAPTURE_PROFILES.find((p) => p.formFactor === 'phone')!;
  const hashes = new Map<string, string>();
  let bytes = 0;

  async function viewOf(label: string, page: PageOpts, kind: 'rich' | 'plain' | 'banner' = 'rich'): Promise<string> {
    current =
      kind === 'plain' ? plainPage(page)
      : kind === 'banner' ? bannerPage(page.hero ?? '#1a4480', page.year ?? 12)
      : fixturePage(page);
    const p = (await browser.newPage()) as import('../../src/quality/capture-runner.js').CapturePage & {
      goto(u: string, o: unknown): Promise<unknown>;
      close(): Promise<void>;
    };
    await p.goto(url, { waitUntil: 'load' });
    const view = await captureAndHash(p, scratch, phone);
    await p.close();
    hashes.set(label, view.hash);
    if (label === 'base') bytes = view.bytes;
    return view.hash;
  }

  before(async () => {
    const path = findBrowser();
    assert.ok(path, 'no browser found — set CHROME_PATH so this guarantee can be checked');
    server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(current);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;

    const puppeteer = (await import('puppeteer-core')).default;
    browser = (await puppeteer.launch({
      executablePath: path,
      args: ['--no-sandbox', '--headless=new'],
    })) as unknown as typeof browser;
    scratch = (await browser.newPage()) as import('../../src/quality/capture-runner.js').HashPage;

    await viewOf('base', {});
    await viewOf('rerender', {});
    await viewOf('text', { year: 1954, heading: 'Fixture Agency ' });
    await viewOf('image', { hero: 'background:#8b1a1a' });
    await viewOf('alert', { alert: true });
    // The case the first hash tried here failed on. An average hash calls two
    // mostly-white pages identical because nearly every cell sits above the
    // mean, and it returned "unchanged" for a complete redesign — a method that
    // reports having checked and has not.
    await viewOf('plain', {}, 'plain');
    await viewOf('plain-redesigned', { heading: 'County of Example', alert: true, plain: false }, 'plain');
    await viewOf('banner', { hero: '#1a4480', year: 12 }, 'banner');
    await viewOf('banner-redesigned', { hero: '#8b1a1a', year: 3 }, 'banner');
  });

  after(async () => {
    await browser?.close();
    server?.close();
  });

  test('the hash is the width the rule says it is', () => {
    assert.equal(hashes.get('base')!.length, CHANGE_RULE.bits);
  });

  test('rendering the same page twice is not a change', () => {
    assert.equal(distance(hashes.get('base')!, hashes.get('rerender')!), 0);
    assert.equal(hasMeaningfullyChanged(hashes.get('base'), hashes.get('rerender')!), false);
  });

  test('a date and a heading changing is not a change worth re-storing', () => {
    const d = distance(hashes.get('base')!, hashes.get('text')!);
    assert.ok(d <= CHANGE_RULE.threshold,
      `edited text moved the hash by ${d}, above the threshold of ${CHANGE_RULE.threshold}`);
    assert.equal(hasMeaningfullyChanged(hashes.get('base'), hashes.get('text')!), false);
  });

  test('an image swapped IS a change', () => {
    const d = distance(hashes.get('base')!, hashes.get('image')!);
    assert.ok(d > CHANGE_RULE.threshold,
      `the smallest visible change measured moved the hash by only ${d}`);
    assert.equal(hasMeaningfullyChanged(hashes.get('base'), hashes.get('image')!), true);
  });

  test('an emergency banner appearing IS a change', () => {
    // The case that matters most: a notice a resident needs to see, on a page
    // that would otherwise look settled.
    assert.equal(hasMeaningfullyChanged(hashes.get('base'), hashes.get('alert')!), true);
  });

  test('a banner-over-text page is not immune either — the case that chose this hash', () => {
    // Reduced to an 8×8 average hash this exact pair scored zero: the page is
    // mostly white, so nearly every cell sits above the mean and the two
    // collapse onto the same value. A method that returns "unchanged" for a
    // redesign is worse than no method, because it reports having checked.
    const d = distance(hashes.get('banner')!, hashes.get('banner-redesigned')!);
    assert.ok(d > CHANGE_RULE.threshold,
      `a redesigned banner page moved the hash by only ${d}`);
    assert.equal(hasMeaningfullyChanged(hashes.get('banner'), hashes.get('banner-redesigned')!), true);
  });

  test('a mostly-white page is not immune to change detection', () => {
    const d = distance(hashes.get('plain')!, hashes.get('plain-redesigned')!);
    assert.ok(d > CHANGE_RULE.threshold,
      `a redesign of a page with almost no dark area moved the hash by only ${d} — ` +
        'this is the shape most government pages have, and the shape a brightness-based hash cannot see');
    assert.equal(hasMeaningfullyChanged(hashes.get('plain'), hashes.get('plain-redesigned')!), true);
  });

  test('a stored view stays small enough for the whole frame', () => {
    // The storage argument is the reason captures are permitted at all
    // (constitution 2.1.0), so it is checked rather than assumed. Measured on
    // this fixture: 14.7 KB above the fold at 1x, 31.8 KB at 2x, and a
    // Lighthouse full-page capture of a smaller page ran to 83 KB. The bound is
    // loose because real pages are richer than a fixture; the 1x decision itself
    // is pinned in the unit test, where the profile data lives.
    assert.ok(bytes > 0, 'a view must actually have been captured');
    assert.ok(bytes < 60_000,
      `a phone view came to ${(bytes / 1024).toFixed(1)} KB — at 16,535 sites that is the storage argument lost`);
  });

  test('the threshold sits in the gap, not on the edge of it', () => {
    const noise = Math.max(
      distance(hashes.get('base')!, hashes.get('rerender')!),
      distance(hashes.get('base')!, hashes.get('text')!),
    );
    const signal = Math.min(
      distance(hashes.get('base')!, hashes.get('image')!),
      distance(hashes.get('base')!, hashes.get('alert')!),
    );
    assert.ok(noise < CHANGE_RULE.threshold && CHANGE_RULE.threshold < signal,
      `noise reached ${noise}, signal starts at ${signal}, threshold is ${CHANGE_RULE.threshold}`);
  });
});
