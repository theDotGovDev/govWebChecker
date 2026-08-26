import { USER_AGENT } from '../politeness/user-agent.js';
import type { CaptureProfile } from './capture.js';
import type { TakenView } from './run.js';
import type { OnPage, ToolResult, ToolRun } from './deep-check.js';

/**
 * Driving the real tool.
 *
 * Kept apart from `deep-check.ts` so the reading logic stays a pure function over
 * a result, testable without a browser. Everything here is about *how* the tool
 * is invoked, and every choice below is a constraint rather than a tuning knob.
 */

export interface Preset {
  /** Named in every reading so a person can run the same thing and compare. */
  id: string;
  formFactor: 'mobile' | 'desktop';
  /** The device UA the tool's own preset uses. */
  deviceUserAgent: string;
}

/**
 * The tool's own presets, not ours.
 *
 * The whole reason for using an industry-standard tool is that a number here
 * means the same thing as a number someone else measured. Custom settings would
 * buy nothing and cost exactly that (FR-320), so these carry a form factor and
 * nothing else — the throttling and screen come from the tool's defaults.
 *
 * The user-agent strings are the tool's own defaults, restated here because they
 * have to be *appended to* rather than replaced. The tool rewrites the Chrome
 * version token in them at run time, so the version below is a placeholder rather
 * than a claim. An integration test compares these against the tool's exported
 * constants, because a device string that silently drifted out of date would
 * change which page a site serves us and nothing would say so.
 */
export const PRESETS: Record<'mobile' | 'desktop', Preset> = {
  mobile: {
    id: 'lighthouse:default/mobile',
    formFactor: 'mobile',
    deviceUserAgent:
      'Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Mobile Safari/537.36',
  },
  desktop: {
    id: 'lighthouse:default/desktop',
    formFactor: 'desktop',
    deviceUserAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  },
};

export interface RunnerOptions {
  /** The backend the limiter accounted for, when it is known. */
  address?: string;
  port?: number;
}

/**
 * Settings passed to the tool.
 *
 * Deliberately short. Anything that changed the throttling, the screen, or which
 * categories run would make the reading incomparable to the same preset run
 * anywhere else, which is the one thing this tool was chosen for.
 */
export function lighthouseFlags(preset: Preset, options: RunnerOptions): Record<string, unknown> {
  return {
    formFactor: preset.formFactor,
    // Principle III reaches into the browser here. Lighthouse drives real Chrome,
    // so unless the emulated UA carries our identification the traffic arrives
    // anonymous — the one thing an operator cannot interpret. It is appended
    // rather than substituted: sites serve different pages to different agents,
    // and a reading taken under a UA nobody else uses is no longer the standard
    // preset it claims to be.
    emulatedUserAgent: `${preset.deviceUserAgent} ${USER_AGENT}`,
    // Drops the full-page render the result would otherwise carry as a data URI.
    // Two filmstrip audits still hold small frames, which is fine: a check may
    // analyze a page in memory, and they are discarded when it ends. What matters
    // is that no image reaches the record, and that is guaranteed upstream — a
    // reading copies named metrics rather than filtering a result.
    disableFullPageScreenshot: true,
    output: 'json',
    logLevel: 'error',
    ...(options.port !== undefined ? { port: options.port } : {}),
  };
}

export interface ChromeTarget {
  host: string;
  address?: string;
}

/**
 * Browser flags.
 *
 * The resolver rule is the important one. The availability check pins every
 * request to the backend the limiter accounted for, because accounting for one
 * machine while the socket reaches another leaves the record asserting a
 * guarantee about a machine we never contacted (FR-140). A browser does its own
 * DNS, so the pin has to be pushed down into it or the guarantee stops at the
 * edge of this process.
 *
 * The user-agent flag is the other one, and it is here because of what the flags
 * alone could not show. The tool's standard preset fetches more than the page —
 * the agentic-browsing audit asks for `/llms.txt` and `/robots.txt` — and those
 * went out under Chrome's own anonymous user agent, because `emulatedUserAgent`
 * governs the page and not the tool's own fetches. Principle III says *every*
 * request identifies itself, not merely the interesting ones.
 *
 * A browser-level agent sets the default for exactly those uncovered requests;
 * the page's emulation still wins where it applies, so the page is still
 * requested as the device it claims to be. Measured against a local fixture:
 * identification on every request, the device string unchanged on the page, and
 * the tool's own numbers unmoved.
 *
 * There is nothing here that weakens what we send or what we accept: no disabled
 * web security, no ignored certificate errors — a TLS failure is a measurement,
 * not an obstacle.
 */
export function chromeFlags(target: ChromeTarget): string[] {
  return [
    '--headless=new',
    // Required in the container CI runs in; it does not change what is requested.
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    `--user-agent=${USER_AGENT}`,
    ...(target.address ? [`--host-resolver-rules=MAP ${target.host} ${target.address}`] : []),
  ];
}

/**
 * A `ToolRun` backed by real Lighthouse and a real browser.
 *
 * Chrome is launched per target rather than once per pass. Relaunching costs
 * about a second against a check that takes fifteen, and it buys complete
 * isolation between measurements: no memory pressure carried over from a heavy
 * page into the next site's blocking time, which is exactly the kind of
 * cross-contamination that would make one agency's number a function of the one
 * measured before it.
 *
 * The imports are dynamic because the tool is a development dependency. `check`,
 * `census` and `verify` must keep working in an install that has no browser.
 */
export function lighthouseRunner(
  preset: Preset,
  resolveAddress?: (host: string) => Promise<string | undefined>,
): ToolRun {
  return async (url: string, onPage?: OnPage): Promise<ToolResult> => {
    const [{ default: lighthouse }, chromeLauncher] = await Promise.all([
      import('lighthouse'),
      import('chrome-launcher'),
    ]);

    const host = new URL(url).hostname;
    const address = resolveAddress ? await resolveAddress(host) : undefined;

    const { default: puppeteer } = await import('puppeteer-core');
    const browser = await puppeteer.launch({
      args: chromeFlags({ host, ...(address ? { address } : {}) }),
      ...(process.env['CHROME_PATH'] ? { executablePath: process.env['CHROME_PATH'] } : {}),
    });
    try {
      const page = await browser.newPage();
      // The tool drives this page, so a view can be taken from it afterwards
      // without a second navigation — which is the difference between a capture
      // costing nothing and costing someone else's server another page load.
      const result = await lighthouse(url, lighthouseFlags(preset, {}), undefined, page);
      if (!result) throw new Error('the tool returned no result');
      const lhr = result.lhr as unknown as ToolResult & { runtimeError?: { code: string; message: string } };
      // A runtime error means the tool could not measure the page. Recording the
      // numbers it produced anyway would publish a reading of a load that did not
      // happen.
      if (lhr.runtimeError) throw new Error(`${lhr.runtimeError.code}: ${lhr.runtimeError.message}`);
      if (onPage) {
        // A blank page for reducing the image. It never navigates anywhere, so
        // nothing here can reach a target.
        const scratch = await browser.newPage();
        await onPage(page, scratch);
      }
      return lhr;
    } finally {
      await browser.close();
    }
  };
}

/**
 * A view at a profile the deep check cannot speak for.
 *
 * Its own browser, its own navigation, and therefore its own cost — which the
 * caller pays through the limiter before calling this. The flags are the same
 * ones the deep check uses, including the identification and the backend pin, so
 * this traffic is as accountable as any other.
 */
export function standaloneCapturer(
  resolveAddress?: (host: string) => Promise<string | undefined>,
): (url: string, profile: CaptureProfile) => Promise<TakenView> {
  return async (url: string, profile: CaptureProfile): Promise<TakenView> => {
    if (profile.engine === 'webkit') return captureWithWebkit(url, profile);
    const [{ default: puppeteer }, { captureAndHash }] = await Promise.all([
      import('puppeteer-core'),
      import('./capture-runner.js'),
    ]);
    const host = new URL(url).hostname;
    const address = resolveAddress ? await resolveAddress(host) : undefined;
    const browser = await puppeteer.launch({
      args: chromeFlags({ host, ...(address ? { address } : {}) }),
      ...(process.env['CHROME_PATH'] ? { executablePath: process.env['CHROME_PATH'] } : {}),
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({
        width: profile.width,
        height: profile.height,
        deviceScaleFactor: profile.scale,
      });
      // `networkidle2` rather than `load`: the document arriving is not the page
      // being ready, and a view taken at `load` is routinely of a blank screen.
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30_000 });
      const scratch = await browser.newPage();
      return await captureAndHash(page as never, scratch as never, profile);
    } finally {
      await browser.close();
    }
  };
}

/** Takes a view from a page the tool has already loaded. */
export async function captureFromPage(
  profile: CaptureProfile,
  page: unknown,
  scratch: unknown,
): Promise<TakenView> {
  const { captureAndHash } = await import('./capture-runner.js');
  return captureAndHash(page as never, scratch as never, profile);
}

/**
 * A view taken by WebKit, for the profile no Blink browser can speak for.
 *
 * Safari is 16.47% of browsers and renders on its own engine; a Blink capture
 * labelled as Safari would be a claim about what a visitor sees that is simply
 * untrue. So this is a second browser, and it is the reason Playwright is a
 * dependency at all.
 *
 * The device descriptor is Playwright's own, for the same reason the Blink phone
 * uses Lighthouse's preset: a viewport we picked ourselves would make the reading
 * incomparable to what anyone else measures with the same tool. The identification
 * is appended to the descriptor's user agent rather than replacing it, exactly as
 * on the Blink path — sites serve different pages to different agents.
 *
 * **One guarantee is weaker here, and it is stated rather than hidden.** The
 * Blink path pins the connection to the backend the limiter accounted for, via a
 * Chrome resolver rule; WebKit has no equivalent, so this capture resolves the
 * host itself. The limiter still applies its name-keyed limits, and the slot is
 * still acquired against the address we resolved — conservative accounting — but
 * for a host publishing several addresses the socket may reach a different one
 * than the record names (FR-140). One page load per site per cycle.
 */
async function captureWithWebkit(url: string, profile: CaptureProfile): Promise<TakenView> {
  const [{ webkit, devices }, { hashView }] = await Promise.all([
    import('playwright'),
    import('./capture-runner.js'),
  ]);

  const device = devices['iPhone 13']!;
  const browser = await webkit.launch();
  try {
    const context = await browser.newContext({
      ...device,
      // 1x for the same storage reason as every other profile: a view is
      // evidence of layout, not of typography.
      deviceScaleFactor: profile.scale,
      viewport: { width: profile.width, height: profile.height },
      userAgent: `${device.userAgent} ${USER_AGENT}`,
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
    const image = await page.screenshot({
      // WebP, like every other profile: one format on disk, one extension in the
      // markup, and the same size argument that made captures affordable.
      type: 'webp',
      quality: 75,
      clip: { x: 0, y: 0, width: profile.width, height: profile.height },
    });
    // Reduced by the same function the Blink path uses, on this page, so the two
    // engines' hashes are produced identically even though the pixels differ.
    const hash = await hashView(page as never, image);
    return { image, hash, bytes: image.length };
  } finally {
    await browser.close();
  }
}
