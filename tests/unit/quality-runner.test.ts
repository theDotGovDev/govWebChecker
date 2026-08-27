import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { lighthouseFlags, PRESETS, chromeFlags, type Preset } from '../../src/quality/runner.js';
import { USER_AGENT } from '../../src/politeness/user-agent.js';

describe('the tool is run at a standard preset (FR-320)', () => {
  test('the presets are the tool\'s own, named so a reader can reproduce them', () => {
    assert.deepEqual(Object.keys(PRESETS).sort(), ['desktop', 'mobile']);
    for (const [name, preset] of Object.entries(PRESETS) as [string, Preset][]) {
      assert.match(preset.id, /^lighthouse:default\//, `${name} must name the tool and its default config`);
      assert.equal(preset.formFactor, name);
    }
  });

  test('nothing tunes the throttling or the screen away from the preset', () => {
    const flags = lighthouseFlags(PRESETS['mobile']!, {});
    for (const tuned of ['throttling', 'throttlingMethod', 'screenEmulation', 'onlyCategories', 'maxWaitForLoad']) {
      assert.ok(!(tuned in flags),
        `${tuned} would make this reading incomparable to the same tool run anywhere else`);
    }
    assert.equal(flags.formFactor, 'mobile');
  });
});

/**
 * Principle III: every request identifies itself. Lighthouse drives a real
 * browser, so the identification has to reach Chrome's emulated User-Agent or the
 * traffic arrives anonymous — the one thing an operator has no way to interpret.
 *
 * But the device UA cannot simply be replaced: sites serve different pages to
 * mobile and desktop agents, and a reading taken under a UA nobody else uses is
 * no longer comparable to the same preset run elsewhere (FR-320). So it is
 * appended, not substituted.
 */
describe('a deep check identifies itself without breaking the emulation', () => {
  test('the emulated user agent keeps the device and adds the project', () => {
    for (const preset of Object.values(PRESETS)) {
      const ua = lighthouseFlags(preset, {}).emulatedUserAgent as string;
      assert.ok(ua.includes(preset.deviceUserAgent),
        'replacing the device UA would change which page the site serves');
      assert.ok(ua.includes(USER_AGENT),
        'an operator seeing this traffic must be able to find out what it is');
      assert.match(ua, /github\.com\/theDotGovDev\/govWebChecker/,
        'and must be able to follow a URL to ask us to stop');
    }
  });
});

/**
 * The LHR carries a full-page screenshot as a data URI by default. That is the
 * page itself, not a measurement of it, and it is not what the record stores —
 * rendered views are handled separately and never committed (constitution 2.1.0).
 */
describe('the tool is told not to hand back the page (Principle IV)', () => {
  test('the full-page screenshot audit is disabled', () => {
    assert.equal(lighthouseFlags(PRESETS['mobile']!, {}).disableFullPageScreenshot, true);
  });
});

/**
 * The availability check pins each request to the backend the limiter accounted
 * for, or the record would assert a guarantee about a machine we never contacted.
 * A browser resolves names itself, so the pin has to be pushed down into Chrome.
 */
describe('the browser is pinned to the backend the limiter accounted for (FR-140)', () => {
  test('a known address becomes a resolver rule', () => {
    const flags = chromeFlags({ host: 'example.gov', address: '203.0.113.7' });
    assert.ok(flags.some((f) => /--host-resolver-rules=.*MAP example\.gov 203\.0\.113\.7/.test(f)),
      'without this, Chrome may reach a different machine than the one we spaced our requests for');
  });

  test('an unknown address adds no rule rather than a wrong one', () => {
    const flags = chromeFlags({ host: 'example.gov' });
    assert.ok(!flags.some((f) => f.startsWith('--host-resolver-rules')));
  });

  test('the browser itself identifies the requests the page emulation does not cover', () => {
    // An earlier version of this test asserted --user-agent must be ABSENT, on
    // the reasoning that it would defeat the emulated device string. That was
    // wrong in a way only real traffic showed: the emulation covers the page,
    // the browser-level agent covers everything else, and without it the tool's
    // own /llms.txt and /robots.txt fetches went out anonymous.
    const flags = chromeFlags({ host: 'example.gov' });
    const ua = flags.find((f) => f.startsWith('--user-agent='));
    assert.ok(ua, 'requests the page emulation does not cover would arrive anonymous');
    assert.ok(ua.includes(USER_AGENT));
  });

  test('nothing in the browser flags weakens what we send or accept', () => {
    const flags = chromeFlags({ host: 'example.gov' }).join(' ');
    for (const forbidden of ['--disable-web-security', '--ignore-certificate-errors',
                             '--allow-running-insecure-content', '--disable-features=IsolateOrigins']) {
      assert.ok(!flags.includes(forbidden), `${forbidden} would misrepresent the traffic or the result`);
    }
  });
});
