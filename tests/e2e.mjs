// End-to-end check in headless Chromium: node tests/e2e.mjs [baseUrl] [screenshotDir]
// Uses the bundled synthetic sample so it needs no network. Requires Playwright.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright');

const base = process.argv[2] ?? 'http://localhost:8765/';
const shots = process.argv[3];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
const problems = [];
// Browsers log failed requests; the test simulates two on purpose, so only those are ignored.
page.on('console', (m) => m.type() === 'error' && !/^Failed to load resource/.test(m.text()) && problems.push(`console: ${m.text()}`));
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

await page.goto(base);
await page.waitForFunction(() => document.getElementById('status').textContent === 'Ready.');
assert.match(await page.textContent('#ver'), /^v\d+\.\d+\.\d+/);
assert.deepEqual(await page.$$eval('#preset option', (o) => o.map((x) => x.value)), ['drone', 'outdoor-event', 'field-work']);
assert.match(await page.inputValue('#plan'), /"wind_speed"/);

// Sample data + drone preset.
await page.selectOption('#tz', 'utc');
await page.click('#run-sample');
await page.waitForSelector('#results:not([hidden])');
const summary = await page.textContent('#summary');
assert.match(summary, /\d+ of 71 possible start times fit all your limits\. Data: synthetic sample/);
const cells = await page.$$('#strip .cell');
assert.equal(cells.length, 71); // 72 hourly samples, 2 h operation
const feasible = await page.$$eval('#strip .cell.ok', (c) => c.length);
assert.ok(feasible > 0 && feasible < 71, `feasible=${feasible}`);

// Clicking a rejected cell explains the failure; a feasible one shows evidence.
await page.click('#strip .cell:not(.ok)');
assert.match(await page.textContent('#detail'), /rejected[\s\S]*First failure/);
await page.click('#strip .cell.ok');
assert.match(await page.textContent('#detail'), /fits your limits[\s\S]*wind limit/);
assert.ok((await page.$$('#best li')).length >= 1);
if (shots) await page.screenshot({ path: `${shots}/desktop.png`, fullPage: true });

// The plan editor is collapsed by default; open it like a user would.
assert.equal(await page.isVisible('#plan'), false);
await page.click('#plan-panel > summary');

// Editing the plan re-runs on the loaded data: an impossible wind limit rejects everything.
const plan = JSON.parse(await page.inputValue('#plan'));
plan.stages[0].constraints.find((c) => c.name === 'wind limit').threshold = 0.1;
await page.fill('#plan', JSON.stringify(plan));
await page.dispatchEvent('#plan', 'change');
await page.waitForFunction(() => /^0 of 71/.test(document.getElementById('summary').textContent));
assert.match(await page.textContent('#best'), /No window fits/);

// A bad plan surfaces a readable error instead of failing silently.
await page.fill('#plan', '{"nope":1}');
await page.dispatchEvent('#plan', 'change');
await page.waitForFunction(() => document.getElementById('status').className === 'error');
assert.match(await page.textContent('#status'), /invalid plan/);

// Preset switch rewrites the plan; CSV upload works.
await page.selectOption('#preset', 'outdoor-event');
assert.match(await page.inputValue('#plan'), /outdoor-event/);
await page.setInputFiles('#csv', { name: 'mine.csv', mimeType: 'text/csv', buffer: Buffer.from(
  'timestamp,wind_speed (km/h),precipitation_probability,temperature\n2026-09-21T08:00Z,10,5,20\n2026-09-21T09:00Z,12,5,21\n2026-09-21T10:00Z,9,5,22\n') });
await page.waitForFunction(() => /your CSV \(mine\.csv\)/.test(document.getElementById('summary').textContent));

// Live fetch fails gracefully when the network is unavailable (as in the sandbox).
await page.route('https://api.open-meteo.com/**', (r) => r.abort());
await page.click('#run-live');
await page.waitForFunction(() => document.getElementById('status').className === 'error');
assert.match(await page.textContent('#status'), /Could not reach the forecast service/);

// A mocked API error body is reported with its reason.
await page.unroute('https://api.open-meteo.com/**');
await page.route('https://api.open-meteo.com/**', (r) => r.fulfill({ status: 400, contentType: 'application/json', body: '{"error":true,"reason":"Latitude must be in range of -90 to 90"}' }));
await page.click('#run-live');
await page.waitForFunction(() => /returned 400: Latitude must be in range/.test(document.getElementById('status').textContent));

// Mobile layout: no horizontal overflow.
await page.setViewportSize({ width: 375, height: 800 });
await page.selectOption('#preset', 'drone');
await page.click('#run-sample');
await page.waitForFunction(() => /synthetic sample/.test(document.getElementById('summary').textContent));
assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'horizontal overflow on mobile');
if (shots) await page.screenshot({ path: `${shots}/mobile.png`, fullPage: true });

await browser.close();
assert.deepEqual(problems, [], problems.join('\n'));
console.log('e2e: ok');
