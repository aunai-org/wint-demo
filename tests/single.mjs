// Checks the single-file build under a strict CSP with no network access:
//   node scripts/build-single.mjs out.html && node tests/single.mjs out.html [screenshotDir]
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright');

const [file, shots] = process.argv.slice(2);
const html = readFileSync(file, 'utf8');
const csp = process.env.CSP ??
  "default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; connect-src 'none'; img-src data:";

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
const problems = [], requests = [];
page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('request', (r) => requests.push(r.url()));
await page.route('http://single.test/', (r) => r.fulfill({ status: 200, contentType: 'text/html', headers: { 'content-security-policy': csp }, body: html }));

await page.goto('http://single.test/');
await page.waitForFunction(() => /^(Ready\.|Could not start)/.test(document.getElementById('status').textContent));
assert.equal(await page.textContent('#status'), 'Ready.', 'engine failed to start under the CSP');

// Live-only controls are hidden and the sandbox note is shown.
for (const sel of ['#run-live', '#place', '#lat', '#lon', '#days']) assert.equal(await page.isVisible(sel), false, sel);
assert.equal(await page.isVisible('#embed-note'), true);

await page.click('#run-sample');
await page.waitForSelector('#results:not([hidden])');
assert.match(await page.textContent('#summary'), /of 71 possible start times fit all your limits\. Data: synthetic sample/);
await page.click('#strip .cell.ok');
assert.match(await page.textContent('#detail'), /fits your limits/);

// Explicit theme override wins over the system preference, in both directions.
const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
await page.emulateMedia({ colorScheme: 'light' });
await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
const dark = await bg();
await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
const light = await bg();
assert.notEqual(dark, light);
await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
await page.emulateMedia({ colorScheme: 'dark' });
assert.equal(await bg(), dark, 'system dark preference should match the explicit dark theme');
if (shots) await page.screenshot({ path: `${shots}/single-dark.png`, fullPage: true });

// Nothing was requested beyond the page itself.
assert.deepEqual(requests.filter((u) => !u.startsWith('http://single.test/') && !u.startsWith('data:') && !u.startsWith('blob:')), []);
await browser.close();
assert.deepEqual(problems, [], problems.join('\n'));
console.log('single: ok');
