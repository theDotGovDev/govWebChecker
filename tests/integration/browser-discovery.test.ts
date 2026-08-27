import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { findBrowser, requireBrowser } from '../../src/quality/browser.js';

/**
 * Finding the browser the deep check drives.
 *
 * This exists because of a defect that every other test passed. `puppeteer-core`
 * ships no browser and refuses to launch without an explicit `executablePath`;
 * production supplied one only from `CHROME_PATH`, and the workflow never set it.
 * The integration tests passed because each set the variable itself before
 * running — so the tests proved the code worked in an environment the workflow
 * did not create, and the first real run would have failed on every target.
 *
 * The rule this encodes: production resolves the browser, and the tests use the
 * same resolution. A test that arranges its own environment is testing itself.
 */
describe('the browser is found the same way in tests and in production', () => {
  test('a browser is found here, without the caller arranging it', () => {
    const found = findBrowser();
    assert.ok(found, 'no browser found on a machine that has one');
  });

  test('the environment variable wins when it is set', () => {
    const before = process.env['CHROME_PATH'];
    try {
      process.env['CHROME_PATH'] = '/somewhere/chosen/explicitly';
      assert.equal(findBrowser(), '/somewhere/chosen/explicitly',
        'an explicit choice must not be second-guessed');
    } finally {
      if (before === undefined) delete process.env['CHROME_PATH'];
      else process.env['CHROME_PATH'] = before;
    }
  });

  test('what it finds actually launches', async () => {
    const puppeteer = (await import('puppeteer-core')).default;
    const browser = await puppeteer.launch({
      executablePath: requireBrowser(),
      args: ['--no-sandbox', '--headless=new'],
    });
    try {
      const page = await browser.newPage();
      assert.equal(await page.evaluate(() => 1 + 1), 2);
    } finally {
      await browser.close();
    }
  });

  test('finding nothing is an error that says what was looked for', () => {
    const before = { chrome: process.env['CHROME_PATH'], pw: process.env['PLAYWRIGHT_BROWSERS_PATH'] };
    try {
      delete process.env['CHROME_PATH'];
      process.env['PLAYWRIGHT_BROWSERS_PATH'] = '/nowhere-at-all';
      // A cryptic launch failure deep inside a library is how an hour gets spent
      // on a missing package.
      assert.throws(() => requireBrowser({ candidates: [] }), (e: Error) => {
        assert.match(e.message, /no browser/i);
        assert.match(e.message, /CHROME_PATH/, 'it must name the way to fix it');
        return true;
      });
    } finally {
      if (before.chrome === undefined) delete process.env['CHROME_PATH'];
      else process.env['CHROME_PATH'] = before.chrome;
      if (before.pw === undefined) delete process.env['PLAYWRIGHT_BROWSERS_PATH'];
      else process.env['PLAYWRIGHT_BROWSERS_PATH'] = before.pw;
    }
  });
});
