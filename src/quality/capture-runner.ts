import type { CaptureProfile } from './capture.js';
import { CHANGE_RULE } from './capture.js';

/**
 * Taking a view, and reducing it to something the record can keep.
 *
 * Split from `capture.ts` so the rules stay a pure function testable without a
 * browser, exactly as the reading logic is split from the runner.
 */

/** The minimum of a browser page this module needs. Keeps the seam testable. */
export interface CapturePage {
  setViewport(v: { width: number; height: number; deviceScaleFactor: number; isMobile?: boolean }): Promise<void>;
  screenshot(opts: {
    type: 'webp';
    quality: number;
    clip: { x: number; y: number; width: number; height: number };
    captureBeyondViewport: false;
  }): Promise<Uint8Array>;
}

/** A page that can be asked to wait until it has settled. */
export interface SettleablePage {
  evaluate<T>(fn: () => Promise<T> | T): Promise<T>;
}

/** A page used only to reduce an image. Never navigated to a target. */
export interface HashPage {
  evaluate<T>(fn: (uri: string) => Promise<T> | T, uri: string): Promise<T>;
}

export interface View {
  image: Uint8Array;
  hash: string;
  bytes: number;
}

/**
 * Above the fold, at 1×, as WebP.
 *
 * Each of those is a storage decision measured rather than assumed. On a local
 * fixture: 14.7 KB above the fold at 1×, 31.8 KB at 2×, and a full-page capture
 * of a smaller page ran to 83 KB. The view is evidence of what a visitor meets
 * when the page opens, which is what "above the fold" means, and evidence of
 * layout rather than of typography, which is what 1× is enough for.
 *
 * `captureBeyondViewport: false` is what actually holds the fold bound: it clips
 * to the viewport regardless of the rectangle asked for, so a taller clip cannot
 * quietly turn this into a full-page capture.
 */
export async function capture(page: CapturePage, profile: CaptureProfile): Promise<Uint8Array> {
  await page.setViewport({
    width: profile.width,
    height: profile.height,
    deviceScaleFactor: profile.scale,
    isMobile: profile.formFactor === 'phone',
  });
  await settle(page as unknown as SettleablePage);
  return page.screenshot({
    type: 'webp',
    quality: 75,
    clip: { x: 0, y: 0, width: profile.width, height: profile.height },
    captureBeyondViewport: false,
  });
}

/**
 * The difference hash, computed in the browser we already have.
 *
 * Decoding WebP in Node would mean an image library; the browser decodes it
 * already. This runs on a blank page with a `data:` URI, so it makes no network
 * request of any kind — nothing here can reach a target.
 */
export async function hashView(scratch: HashPage, image: Uint8Array): Promise<string> {
  const uri = `data:image/webp;base64,${Buffer.from(image).toString('base64')}`;
  const bits = await scratch.evaluate(async (dataUri: string) => {
    const blob = await (await fetch(dataUri)).blob();
    const bitmap = await createImageBitmap(blob);
    const W = 17;
    const H = 17;
    const canvas = new OffscreenCanvas(W, H);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0, W, H);
    const { data } = ctx.getImageData(0, 0, W, H);
    const grey: number[] = [];
    for (let i = 0; i < data.length; i += 4) {
      grey.push(0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!);
    }
    let out = '';
    // Left-to-right: vertical edges — columns, sidebars, cards.
    for (let y = 0; y < H - 1; y++) {
      for (let x = 0; x < W - 1; x++) out += grey[y * W + x]! > grey[y * W + x + 1]! ? '1' : '0';
    }
    // Top-to-bottom: horizontal edges — banners, navigation bars, hero strips.
    // Without this pass a full-width band has no edge to find, and a desktop
    // government page is mostly full-width bands: one hashed to all zeroes.
    for (let y = 0; y < H - 1; y++) {
      for (let x = 0; x < W - 1; x++) out += grey[y * W + x]! > grey[(y + 1) * W + x]! ? '1' : '0';
    }
    return out;
  }, uri);

  // A hash of the wrong length would be compared against stored ones and yield a
  // distance that means nothing — loudly enough to be believed.
  if (bits.length !== CHANGE_RULE.bits) {
    throw new Error(`hash is ${bits.length} bits, expected ${CHANGE_RULE.bits}`);
  }
  return bits;
}

export async function captureAndHash(
  page: CapturePage,
  scratch: HashPage,
  profile: CaptureProfile,
): Promise<View> {
  const image = await capture(page, profile);
  return { image, hash: await hashView(scratch, image), bytes: image.length };
}

/**
 * Waits for the page to stop moving before it is photographed.
 *
 * A capture that races the render is worse than no capture. Change detection
 * compares this run's view with the last; an unstable view reports a change
 * every run, rewrites every image, and spends the whole saving the check exists
 * to buy. Observed exactly that way: three captures of one unchanged page came
 * to 4,480 then 24,918 then 4,258 bytes, and the first was a blank screen.
 *
 * What actually fixed that was navigating on `networkidle2` rather than `load`,
 * and the stability test is a test of that. This is a second, cheaper guard for
 * what navigation cannot cover: setting the viewport re-lays-out the page, so a
 * frame has to be painted at the new size, and fonts and images can still be
 * settling when it is. Its necessity is *not* demonstrated by the fixtures here
 * — said plainly rather than dressed up, because an untested guard described as
 * load-bearing is how a stated constraint drifts.
 *
 * None of this generates a request: it waits on work the page has already
 * started, and every wait is bounded so one slow site cannot stall a run.
 */
export async function settle(page: SettleablePage): Promise<void> {
  await page.evaluate(async () => {
    const timeout = <T>(p: Promise<T>, ms: number): Promise<T | undefined> =>
      Promise.race([p, new Promise<undefined>((r) => setTimeout(() => r(undefined), ms))]);

    // A page whose fonts or images never arrive still gets photographed — it is
    // what a visitor would see, and waiting forever would turn one slow site
    // into a stalled run.
    await timeout(document.fonts.ready, 3000);
    await timeout(
      Promise.all(
        [...document.images]
          .filter((img) => !img.complete)
          .map((img) => new Promise<void>((r) => {
            img.addEventListener('load', () => r(), { once: true });
            img.addEventListener('error', () => r(), { once: true });
          })),
      ),
      3000,
    );
    // Two frames: one to lay out at the new viewport, one to paint it. Raced
    // with a timeout because a headless page that is compositing nothing may
    // never fire an animation frame at all, and a settle step that can hang is a
    // run that can hang.
    await timeout(
      new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))),
      500,
    );
    // A beat for the paint the frames above scheduled.
    await new Promise<void>((r) => setTimeout(r, 120));
  });
}
