import { USER_AGENT } from '../politeness/user-agent.js';
import type { ToolResult, ToolRun } from './deep-check.js';

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
 * There is nothing here that weakens what we send or what we accept: no UA
 * override (that would defeat the identification above), no disabled web
 * security, no ignored certificate errors — a TLS failure is a measurement, not
 * an obstacle.
 */
export function chromeFlags(target: ChromeTarget): string[] {
  return [
    '--headless=new',
    // Required in the container CI runs in; it does not change what is requested.
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
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
export function lighthouseRunner(preset: Preset, resolveAddress?: (host: string) => Promise<string | undefined>): ToolRun {
  return async (url: string): Promise<ToolResult> => {
    const [{ default: lighthouse }, chromeLauncher] = await Promise.all([
      import('lighthouse'),
      import('chrome-launcher'),
    ]);

    const host = new URL(url).hostname;
    const address = resolveAddress ? await resolveAddress(host) : undefined;

    const chrome = await chromeLauncher.launch({
      chromeFlags: chromeFlags({ host, ...(address ? { address } : {}) }),
      ...(process.env['CHROME_PATH'] ? { chromePath: process.env['CHROME_PATH'] } : {}),
    });
    try {
      const result = await lighthouse(url, lighthouseFlags(preset, { port: chrome.port }));
      if (!result) throw new Error('the tool returned no result');
      const lhr = result.lhr as unknown as ToolResult & { runtimeError?: { code: string; message: string } };
      // A runtime error means the tool could not measure the page. Recording the
      // numbers it produced anyway would publish a reading of a load that did not
      // happen.
      if (lhr.runtimeError) throw new Error(`${lhr.runtimeError.code}: ${lhr.runtimeError.message}`);
      return lhr;
    } finally {
      await chrome.kill();
    }
  };
}
