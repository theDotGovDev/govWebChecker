import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildSite } from '../../src/cli/build-site.js';

const OBSERVATION = {
  schema: '1', run_id: 'r', target_id: 'fixture-local', host: '127.0.0.1',
  url: 'http://127.0.0.1/', dimension: 'availability', checked_at: '2026-08-25T10:00:00Z',
  outcome: 'success', status_code: 200, redirect_chain: [],
  latency: { samples: 1, median_ms: 120, min_ms: 120, max_ms: 120 }, tier: 'hot',
  method: { vantage: 'github-actions/test', timeout_ms: 15000, sample_count: 1, tool_version: '0', source: 'self_run' },
};

const TARGETS = {
  targets: [{
    id: 'fixture-local', host: '127.0.0.1', url: 'http://127.0.0.1/', agency: 'Fixture Agency',
    jurisdiction: 'federal', inclusion_reason: 'local fixture only', active: true,
    traffic_evidence: { source: 'fixture', measure: 'none', visits: 1 },
  }],
};

function view(profile: string, width: number, height: number) {
  return {
    profile, width, height, scale: 1, engine: 'blink',
    captured_at: '2026-08-25T10:00:00Z', hash: '1'.repeat(512),
    rule: 'capture-change/1', bytes: 1234, changed: true,
  };
}

async function scaffold(present: string[]) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'build-views-'));
  await fs.mkdir(path.join(dir, 'data', 'availability'), { recursive: true });
  await fs.mkdir(path.join(dir, 'data', 'quality'), { recursive: true });
  await fs.writeFile(path.join(dir, 'data', 'availability', '2026-08.jsonl'),
    JSON.stringify(OBSERVATION) + '\n');
  await fs.writeFile(path.join(dir, 'data', 'quality', '2026-08.jsonl'),
    JSON.stringify({
      schema: 'govwebchecker/quality/1', run_id: 'q', target_id: 'fixture-local', host: '127.0.0.1',
      url: 'http://127.0.0.1/', dimension: 'quality', checked_at: '2026-08-25T10:00:00Z',
      outcome: 'measured', metrics: {},
      views: [view('phone-blink', 412, 823), view('desktop-blink', 1920, 1080)],
      method: {
        tool: 'lighthouse', tool_version: '13.4.1', preset: 'lighthouse:default/mobile',
        device: { form_factor: 'mobile', width: 412, height: 823, scale: 1, mobile: true },
        network: { rtt_ms: 150, throughput_kbps: 1638.4, cpu_slowdown: 4, method: 'simulate' },
        vantage: 'github-actions/test', source: 'self_run',
      },
    }) + '\n' +
    // A host with views but no availability reading, so it gets no page. Its
    // images must not be copied: a file nothing links to accumulates silently.
    JSON.stringify({
      schema: 'govwebchecker/quality/1', run_id: 'q', target_id: 'orphan', host: 'orphan.gov',
      url: 'http://orphan.gov/', dimension: 'quality', checked_at: '2026-08-25T10:00:00Z',
      outcome: 'measured', metrics: {}, views: [view('phone-blink', 412, 823)],
      method: {
        tool: 'lighthouse', tool_version: '13.4.1', preset: 'lighthouse:default/mobile',
        device: { form_factor: 'mobile', width: 412, height: 823, scale: 1, mobile: true },
        network: { rtt_ms: 150, throughput_kbps: 1638.4, cpu_slowdown: 4, method: 'simulate' },
        vantage: 'github-actions/test', source: 'self_run',
      },
    }) + '\n');
  await fs.writeFile(path.join(dir, 'targets.json'), JSON.stringify(TARGETS));
  {
    const file = path.join(dir, 'views', 'orphan.gov', 'phone-blink.webp');
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, Buffer.from([9]));
  }
  for (const profile of present) {
    const file = path.join(dir, 'views', '127.0.0.1', `${profile}.webp`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, Buffer.from([1, 2, 3]));
  }
  await buildSite({
    data: path.join(dir, 'data'),
    out: path.join(dir, 'site'),
    views: path.join(dir, 'views'),
    targets: path.join(dir, 'targets.json'),
    now: new Date('2026-08-25T12:00:00Z'),
  });
  return dir;
}

/**
 * FR-346: a finding whose image is missing renders as absence, never as a broken
 * picture. The record is append-only and permanent; the images are build
 * artifacts that live in a cache and can be evicted, so the two WILL disagree.
 * A published `<img>` pointing at nothing is a claim about a government site
 * that renders as a broken icon.
 */
describe('a view is published only when its image is actually there (FR-346)', () => {
  test('a finding with no image on disk is not published as a picture', async () => {
    const dir = await scaffold(['phone-blink']);
    try {
      const html = await fs.readFile(path.join(dir, 'site', 'sites', '127.0.0.1.html'), 'utf8');
      const images = html.match(/<img[^>]+src="([^"]+)"/g) ?? [];
      assert.equal(images.length, 1, `expected only the view that exists: ${images.join(', ')}`);
      assert.match(images[0]!, /phone-blink/);
      assert.doesNotMatch(html, /desktop-blink\.webp/,
        'the desktop finding has no image, so it must not be rendered as one');

      // And every image the page does reference must resolve.
      for (const tag of images) {
        const src = tag.match(/src="([^"]+)"/)![1]!;
        const file = path.join(dir, 'site', 'sites', src);
        assert.ok(await fs.stat(file).catch(() => null), `${src} is referenced but was not written`);
      }
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });

  test('with no images at all the page says so rather than showing gaps', async () => {
    const dir = await scaffold([]);
    try {
      const html = await fs.readFile(path.join(dir, 'site', 'sites', '127.0.0.1.html'), 'utf8');
      assert.doesNotMatch(html, /<img[^>]+views\//);
      assert.match(html, /not been photographed/i);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });

  test('both images present means both are published and both resolve', async () => {
    const dir = await scaffold(['phone-blink', 'desktop-blink']);
    try {
      const html = await fs.readFile(path.join(dir, 'site', 'sites', '127.0.0.1.html'), 'utf8');
      const images = html.match(/<img[^>]+src="([^"]+)"/g) ?? [];
      assert.equal(images.length, 2);
      for (const tag of images) {
        const src = tag.match(/src="([^"]+)"/)![1]!;
        assert.ok(await fs.stat(path.join(dir, 'site', 'sites', src)).catch(() => null), src);
      }
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });

  test('a view for a host with no page is not copied into the site', async () => {
    const dir = await scaffold(['phone-blink', 'desktop-blink']);
    try {
      assert.equal(
        await fs.stat(path.join(dir, 'site', 'views', 'orphan.gov')).catch(() => null),
        null,
        'a view copied for a host with no listing is a file nothing links to',
      );
      assert.ok(await fs.stat(path.join(dir, 'site', 'views', '127.0.0.1')).catch(() => null));
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
});