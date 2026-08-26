import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { executeDeepRun, type DeepRunConfig } from '../../src/quality/run.js';
import type { ToolResult } from '../../src/quality/deep-check.js';
import { CAPTURE_PROFILES, CHANGE_RULE } from '../../src/quality/capture.js';
import { fastServer, type Fixture } from '../fixtures/servers.js';

function lhr(): ToolResult {
  return {
    lighthouseVersion: '13.4.1',
    configSettings: {
      formFactor: 'mobile',
      screenEmulation: { width: 412, height: 823, deviceScaleFactor: 1, mobile: true },
      throttling: { rttMs: 150, throughputKbps: 1638.4, cpuSlowdownMultiplier: 4 },
      throttlingMethod: 'simulate',
    },
    audits: { 'speed-index': { numericValue: 3300, numericUnit: 'millisecond' } },
  };
}

const CONFIG: DeepRunConfig = {
  timeoutMs: 5_000, maxRedirects: 5,
  hostIntervalMs: 0, domainIntervalMs: 0, addressIntervalMs: 0,
  vantage: 'github-actions/test', preset: 'lighthouse:default/mobile',
};

const PHONE = CAPTURE_PROFILES.find((p) => p.formFactor === 'phone')!;
const DESKTOP = CAPTURE_PROFILES.find((p) => p.formFactor === 'desktop')!;

const bits = (seed: string) => seed.repeat(CHANGE_RULE.bits).slice(0, CHANGE_RULE.bits);
const SAME = bits('01');
const DIFFERENT = bits('1100');

async function tmp() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'deep-views-'));
}

function target(id: string, fixture: Fixture) {
  return { id, host: fixture.host, url: fixture.url };
}

/**
 * A capture is another page load, and Principle I is about exactly that. The
 * phone view rides the deep check's own navigation and costs nothing extra; the
 * desktop view needs its own, and pays for it through the limiter like anything
 * else.
 */
describe('a capture costs what it says it costs (Principle I, FR-322)', () => {
  test('the phone view is taken from the deep check\'s own page, not a second load', async () => {
    const site = await fastServer();
    try {
      let navigations = 0;
      let ridden = false;
      await executeDeepRun({
        targets: [target('ok', site)],
        dataDir: await tmp(),
        config: { ...CONFIG, dryRun: true },
        run: async (_url, onPage) => {
          navigations += 1;
          if (onPage) { ridden = true; await onPage(undefined, undefined); }
          return lhr();
        },
        captureView: async (_p: unknown, _pg: unknown, _s: unknown) => ({ hash: SAME, bytes: 1234, image: new Uint8Array([1]) }),
      });
      assert.equal(navigations, 1, 'the deep check must still navigate exactly once');
      assert.ok(ridden, 'the phone view must ride that navigation rather than paying for its own');
    } finally { await site.close(); }
  });

  test('a view needing its own navigation is spaced from the deep check by the limiter', async () => {
    // Asserted as elapsed time rather than by watching for a call: a hook that
    // observes this code calling its own helper proves nothing about whether the
    // limiter was involved. The gap is what a site actually experiences, and it
    // is what the published record's spacing check reads too.
    const site = await fastServer();
    try {
      const at: Record<string, number> = {};
      await executeDeepRun({
        targets: [target('ok', site)],
        dataDir: await tmp(),
        config: { ...CONFIG, hostIntervalMs: 400, dryRun: true },
        run: async (_u, onPage) => { at['deep'] = Date.now(); if (onPage) await onPage(undefined, undefined); return lhr(); },
        captureView: async (_p: unknown, _pg: unknown, _s: unknown) => ({ hash: SAME, bytes: 10, image: new Uint8Array([1]) }),
        captureStandalone: async () => {
          at['standalone'] = Date.now();
          return { hash: SAME, bytes: 10, image: new Uint8Array([1]) };
        },
      });
      assert.ok(at['standalone'], 'the desktop view must have been taken');
      const gap = at['standalone']! - at['deep']!;
      assert.ok(gap >= 400,
        `the second page load came ${gap}ms after the first, inside the ${400}ms minimum`);
    } finally { await site.close(); }
  });

  test('a reading that never loaded the page captures nothing', async () => {
    const site = await fastServer();
    try {
      let captures = 0;
      const summary = await executeDeepRun({
        targets: [target('ok', site)],
        dataDir: await tmp(),
        config: { ...CONFIG, dryRun: true },
        run: async () => { throw new Error('chrome did not start'); },
        captureView: async (_p: unknown, _pg: unknown, _s: unknown) => { captures += 1; return { hash: SAME, bytes: 10, image: new Uint8Array([1]) }; },
        captureStandalone: async () => { captures += 1; return { hash: SAME, bytes: 10, image: new Uint8Array([1]) }; },
      });
      assert.equal(captures, 0, 'there is nothing to photograph and no reason to ask again');
      assert.equal(summary.readings[0]!.views, undefined);
    } finally { await site.close(); }
  });
});

describe('an unchanged view is not stored again (D6, FR-344)', () => {
  async function runWith(previous: string | undefined, next: string, dir: string) {
    const site = await fastServer();
    try {
      return await executeDeepRun({
        targets: [target('ok', site)],
        dataDir: await tmp(),
        config: CONFIG,
        run: async (_u, onPage) => { if (onPage) await onPage(undefined, undefined); return lhr(); },
        captureView: async (_p: unknown, _pg: unknown, _s: unknown) => ({ hash: next, bytes: 4242, image: new Uint8Array([7, 7, 7]) }),
        viewsDir: dir,
        ...(previous ? { previousHash: () => previous } : {}),
      });
    } finally { await site.close(); }
  }

  test('a first view is written, and recorded as a change', async () => {
    const dir = await tmp();
    const summary = await runWith(undefined, SAME, dir);
    const view = summary.readings[0]!.views!.find((v) => v.profile === PHONE.id)!;
    assert.equal(view.changed, true, 'there was nothing to compare to');
    assert.equal(view.hash, SAME);
    assert.equal(view.rule, CHANGE_RULE.version);
    const written = await fs.readFile(path.join(dir, '127.0.0.1', `${PHONE.id}.webp`));
    assert.deepEqual([...written], [7, 7, 7]);
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('an unchanged view is still recorded, and the stored image left alone', async () => {
    const dir = await tmp();
    const file = path.join(dir, '127.0.0.1', `${PHONE.id}.webp`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, Buffer.from([9, 9, 9]));

    const summary = await runWith(SAME, SAME, dir);
    const view = summary.readings[0]!.views!.find((v) => v.profile === PHONE.id)!;
    assert.equal(view.changed, false);
    // The finding is still recorded: "we looked and it was the same" is a
    // measurement, and its absence would read as never having looked.
    assert.equal(view.hash, SAME);
    assert.deepEqual([...(await fs.readFile(file))], [9, 9, 9],
      'the stored view must be reused untouched — that is the saving the check buys');
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('a changed view replaces the stored one', async () => {
    const dir = await tmp();
    const file = path.join(dir, '127.0.0.1', `${PHONE.id}.webp`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, Buffer.from([9, 9, 9]));

    const summary = await runWith(SAME, DIFFERENT, dir);
    assert.equal(summary.readings[0]!.views!.find((v) => v.profile === PHONE.id)!.changed, true);
    assert.deepEqual([...(await fs.readFile(file))], [7, 7, 7]);
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('the finding never carries the image, whatever happened to it', async () => {
    const dir = await tmp();
    const summary = await runWith(undefined, SAME, dir);
    const json = JSON.stringify(summary.readings[0]!.views);
    assert.doesNotMatch(json, /data:image|base64|"image"/,
      'the record keeps the finding; the image is a build artifact (constitution 2.1.0)');
    await fs.rm(dir, { recursive: true, force: true });
  });

  test('both profiles are attempted, and each is named in the finding', async () => {
    const site = await fastServer();
    const dir = await tmp();
    try {
      const summary = await executeDeepRun({
        targets: [target('ok', site)],
        dataDir: await tmp(),
        config: CONFIG,
        run: async (_u, onPage) => { if (onPage) await onPage(undefined, undefined); return lhr(); },
        captureView: async (_p: unknown, _pg: unknown, _s: unknown) => ({ hash: SAME, bytes: 10, image: new Uint8Array([1]) }),
        captureStandalone: async () => ({ hash: DIFFERENT, bytes: 20, image: new Uint8Array([2]) }),
        viewsDir: dir,
      });
      const ids = summary.readings[0]!.views!.map((v) => v.profile).sort();
      assert.deepEqual(ids, [DESKTOP.id, PHONE.id].sort());
    } finally { await site.close(); await fs.rm(dir, { recursive: true, force: true }); }
  });
});
