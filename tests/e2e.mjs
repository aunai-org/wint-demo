// End-to-end check in headless Chromium: node tests/e2e.mjs [baseUrl] [screenshotDir]
// Uses the bundled synthetic sample (and mocked API responses), so it needs no network.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright');

const base = process.argv[2] ?? 'http://localhost:8765/';
const shots = process.argv[3];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1000, height: 900 }, reducedMotion: 'reduce' });
const problems = [];
// Browsers log failed requests; the test simulates two on purpose, so only those are ignored.
page.on('console', (m) => m.type() === 'error' && !/^Failed to load resource/.test(m.text()) && problems.push(`console: ${m.text()}`));
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

const text = (sel) => page.textContent(sel);
const statusIs = (re) => page.waitForFunction((s) => new RegExp(s).test(document.getElementById('status').textContent), re.source);
const summaryMatches = (re) => page.waitForFunction((s) => new RegExp(s).test(document.getElementById('summary').textContent), re.source);
/** Start hour (in the displayed clock) of every feasible / rejected strip cell. */
const cellHours = (kind) => page.$$eval(`#strip .cell.${kind}`, (cells) => cells.map((c) => Number(c.getAttribute('aria-label').slice(0, 2))));

await page.goto(base);
await page.waitForFunction(() => document.getElementById('status').textContent === 'Ready.');
assert.match(await text('#ver'), /^v\d+\.\d+\.\d+/);
assert.deepEqual(await page.$$eval('#preset option', (o) => o.map((x) => x.value)), ['drone', 'outdoor-event', 'field-work']);
assert.match(await page.inputValue('#plan'), /"wind_speed"/);
assert.equal(await page.inputValue('#tz'), 'place', 'times default to the place\'s clock');
assert.deepEqual(await page.$$eval('#tod option', (o) => o.map((x) => x.value)), ['any', 'day', 'night', 'custom']);

// ---- Sample data + drone preset: strip, rail, chart, readout all appear and agree ----
await page.selectOption('#tz', 'utc');
await page.click('#run-sample');
await page.waitForSelector('#results:not([hidden])');
assert.match(await text('#summary'), /\d+ of 71 possible start times fit all your limits\. Data: synthetic sample/);
assert.equal((await page.$$('#strip .cell')).length, 71); // 72 hourly samples, 2 h operation
assert.equal((await page.$$('#rail-cells span')).length, 71);
const feasible = await page.$$eval('#strip .cell.ok', (c) => c.length);
assert.ok(feasible > 0 && feasible < 71, `feasible=${feasible}`);
// The chart has one panel per limited metric, hourly markers, and a limit line each.
assert.deepEqual(await page.$$eval('#chart .title', (t) => t.map((x) => x.textContent)),
  ['wind_speed (m/s)', 'wind_gust (m/s)', 'precipitation (mm)', 'visibility (m)', 'temperature (°C)']);
assert.equal((await page.$$('#chart circle.mk')).length, 5 * 72);
assert.equal((await page.$$('#chart line.limit')).length, 6); // wind, gust, rain, visibility, temperature min and max
// The best window is selected on load, so the readout is already populated.
assert.match(await text('#readout'), /Fits your limits, score/);
assert.equal(await page.getAttribute('#rail', 'data-kind'), 'ok');
const bestIdx = Number(await page.inputValue('#rail'));
assert.equal(await page.$$eval('#strip .cell', (c) => c.findIndex((x) => x.getAttribute('aria-pressed') === 'true')), bestIdx);
if (shots) await page.screenshot({ path: `${shots}/desktop.png`, fullPage: true });

// Display-only per-hour colors must agree with what the engine decided: a window is feasible
// exactly when none of its hours is past a limit, and every rejected window contains one.
const mismatches = await page.evaluate(() => {
  const bad = [...document.querySelectorAll('#chart circle.mk[data-status="bad"]')].map((m) => Number(m.dataset.t));
  const out = [];
  for (const c of document.querySelectorAll('#strip .cell')) {
    const [s, e] = [Number(c.dataset.start), Number(c.dataset.end)];
    const hasBad = bad.some((t) => t >= s && t < e);
    if (c.classList.contains('ok') === hasBad) out.push(`${c.getAttribute('aria-label')} ok=${c.classList.contains('ok')} hasBad=${hasBad}`);
  }
  return out;
});
assert.deepEqual(mismatches, [], 'chart markers disagree with the engine');

// ---- The rail: keyboard, buttons, chart click, play/pause ----
const selected = () => page.$$eval('#strip .cell', (c) => c.findIndex((x) => x.getAttribute('aria-pressed') === 'true'));
const bandX = () => page.$eval('#chart .band', (b) => Number(b.getAttribute('x')));
await page.focus('#rail');
await page.keyboard.press('Home');
assert.equal(await selected(), 0);
const x0 = await bandX();
await page.keyboard.press('ArrowRight');
assert.equal(await selected(), 1);
assert.ok((await bandX()) > x0, 'band should move right with the rail');
await page.keyboard.press('End');
assert.equal(await selected(), 70);
await page.click('#best-btn');
assert.equal(await selected(), bestIdx);
await page.click('#prev-fit');
assert.ok((await selected()) < bestIdx || bestIdx === 0);
await page.click('#next-fit');
assert.ok((await selected()) >= 0);
// Clicking the chart seeks to that hour: the far right of the plot is the last candidate.
const box = await page.$eval('#chart svg', (s) => { const r = s.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width }; });
await page.mouse.click(box.x + box.w - 14, box.y + 30);
assert.equal(await selected(), 70);
await page.mouse.click(box.x + box.w * 0.5, box.y + 30);
const mid = await selected();
assert.ok(mid > 25 && mid < 45, `mid=${mid}`);
// Play advances, pause stops.
await page.keyboard.press('Home');
await page.focus('#rail');
await page.click('#play');
assert.equal(await page.getAttribute('#play', 'aria-pressed'), 'true');
await page.waitForFunction(() => Number(document.getElementById('rail').value) >= 2, null, { timeout: 5000 });
await page.click('#play');
assert.equal(await page.getAttribute('#play', 'aria-pressed'), 'false');
const paused = await selected();
await page.waitForTimeout(700);
assert.equal(await selected(), paused, 'pause should stop the playhead');

// Clicking a rejected cell explains the failure; a feasible one shows evidence.
await page.click('#strip .cell:not(.ok)');
assert.match(await text('#detail'), /rejected[\s\S]*First failure/);
assert.match(await text('#readout'), /Rejected:/);
assert.equal(await page.getAttribute('#rail', 'data-kind'), 'bad');
await page.click('#strip .cell.ok');
assert.match(await text('#detail'), /fits your limits[\s\S]*wind limit/);

// ---- Time of day ----
// Custom hours 09:00 to 20:00: a 2 h operation must start between 09:00 and 18:00.
await page.selectOption('#tod', 'custom');
await page.waitForSelector('#tod-from', { state: 'visible' });
await summaryMatches(/possible start times/);
assert.match(await page.inputValue('#plan'), /"schedule": \{\s*"from": "09:00",\s*"to": "20:00"/);
let okHours = await cellHours('ok');
assert.ok(okHours.length > 0 && okHours.every((h) => h >= 9 && h <= 18), `ok hours ${[...new Set(okHours)]}`);
// A cell outside the window explains itself in clock terms.
await page.$eval('#strip .cell[aria-label^="03:00"]', (c) => c.click());
assert.match(await text('#detail'), /time of day[\s\S]*03:00 to 04:00 local[\s\S]*within 09:00-20:00 local/);
// Overnight (from later than until) wraps midnight.
await page.fill('#tod-from', '20:00');
await page.fill('#tod-to', '06:00');
await page.dispatchEvent('#tod-to', 'change');
await page.waitForFunction(() => /"from": "20:00"/.test(document.getElementById('plan').value));
okHours = await cellHours('ok');
assert.ok(okHours.length > 0 && okHours.every((h) => h >= 20 || h <= 4), `overnight ok hours ${[...new Set(okHours)]}`);
// Daylight only: the sample's daylight hours are 06:00 to 18:59, so a 2 h operation (two daylight
// samples) can start from 06:00 up to 17:00.
await page.selectOption('#tod', 'day');
await page.waitForFunction(() => /daylight only/.test(document.getElementById('plan').value));
assert.doesNotMatch(await page.inputValue('#plan'), /schedule/);
okHours = await cellHours('ok');
assert.ok(okHours.length > 0 && okHours.every((h) => h >= 6 && h <= 17), `daylight ok hours ${[...new Set(okHours)]}`);
await page.selectOption('#tod', 'night');
await page.waitForFunction(() => /night only/.test(document.getElementById('plan').value));
okHours = await cellHours('ok');
assert.ok(okHours.length > 0 && okHours.every((h) => h >= 19 || h <= 4), `night ok hours ${[...new Set(okHours)]}`);
if (shots) await page.screenshot({ path: `${shots}/night.png`, fullPage: true });
await page.selectOption('#tod', 'any');
await page.waitForFunction(() => !/is_day|schedule/.test(document.getElementById('plan').value));

// ---- Plan editing ----
await page.click('#plan-panel > summary');
const plan = JSON.parse(await page.inputValue('#plan'));
plan.stages[0].constraints.find((c) => c.name === 'wind limit').threshold = 0.1;
await page.fill('#plan', JSON.stringify(plan));
await page.dispatchEvent('#plan', 'change');
await summaryMatches(/^0 of 71/);
assert.match(await text('#best'), /No window fits/);
// With nothing feasible the rail still works and every marker near the wind limit is flagged.
assert.ok((await page.$$eval('#chart circle.mk[data-metric="wind_speed"][data-status="bad"]', (m) => m.length)) > 60);
// A bad plan surfaces a readable error instead of failing silently.
await page.fill('#plan', '{"nope":1}');
await page.dispatchEvent('#plan', 'change');
await statusIs(/invalid plan/);
assert.equal(await page.getAttribute('#status', 'class'), 'error');

// ---- Preset switch, CSV upload, daylight without is_day data ----
await page.selectOption('#preset', 'drone');
await page.selectOption('#preset', 'outdoor-event');
assert.match(await page.inputValue('#plan'), /outdoor-event/);
// Wind 9.2 m/s against the drone limit of 10 is inside the limit but close: amber.
const csv = 'timestamp,wind_speed,temperature\n' + [0, 1, 2, 3].map((h) => `2026-09-21T0${h}:00Z,${h === 2 ? 9.2 : 3},20`).join('\n') + '\n';
await page.selectOption('#preset', 'drone');
await page.setInputFiles('#csv', { name: 'mine.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
await summaryMatches(/your CSV \(mine\.csv\)/);
const statuses = await page.$$eval('#chart circle.mk[data-metric="wind_speed"]', (m) => m.map((x) => x.dataset.status));
assert.deepEqual(statuses, ['ok', 'ok', 'tight', 'ok'], 'headroom colors for 3, 3, 9.2, 3 m/s against a 10 m/s limit');
assert.ok((await page.$$eval('#chart circle.mk', (m) => m.length)) >= 4);
await page.selectOption('#tod', 'day');
await statusIs(/no daylight \(is_day\) values/);
await page.selectOption('#tod', 'any');

// ---- Live fetch: failures are readable; the place's clock is used when the API provides an offset ----
await page.route('https://api.open-meteo.com/**', (r) => r.abort());
await page.click('#run-live');
await statusIs(/Could not reach the forecast service/);
await page.unroute('https://api.open-meteo.com/**');
await page.route('https://api.open-meteo.com/**', (r) => r.fulfill({ status: 400, contentType: 'application/json', body: '{"error":true,"reason":"Latitude must be in range of -90 to 90"}' }));
await page.click('#run-live');
await statusIs(/returned 400: Latitude must be in range/);
await page.unroute('https://api.open-meteo.com/**');
const sample = JSON.parse(readFileSync(new URL('../sample-forecast.json', import.meta.url), 'utf8'));
sample.utc_offset_seconds = 7200; // pretend the place is UTC+02:00
await page.route('https://api.open-meteo.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(sample) }));
await page.selectOption('#tz', 'utc');
await page.click('#run-live');
await summaryMatches(/live forecast for/);
assert.match(await page.getAttribute('#strip .cell', 'aria-label'), /^00:00 start/);
await page.selectOption('#tz', 'place');
await page.waitForFunction(() => /^02:00 start/.test(document.querySelector('#strip .cell').getAttribute('aria-label')));
// A clock window refers to the place's clock: 09:00 to 12:00 local is 07:00 to 10:00 UTC.
await page.selectOption('#tod', 'custom');
await page.fill('#tod-from', '09:00');
await page.fill('#tod-to', '12:00');
await page.dispatchEvent('#tod-to', 'change');
await page.waitForFunction(() => /"to": "12:00"/.test(document.getElementById('plan').value));
assert.deepEqual([...new Set(await cellHours('ok'))].sort((a, b) => a - b), [9, 10]);
await page.selectOption('#tz', 'utc');
await page.waitForFunction(() => document.querySelector('#strip .cell.ok'));
assert.deepEqual([...new Set(await cellHours('ok'))].sort((a, b) => a - b), [7, 8]);
await page.unroute('https://api.open-meteo.com/**');

// ---- Mobile layout: no horizontal overflow; the chart redraws to the narrower width ----
await page.selectOption('#tod', 'any');
await page.setViewportSize({ width: 375, height: 800 });
await page.selectOption('#preset', 'drone');
await page.click('#run-sample');
await summaryMatches(/synthetic sample/);
await page.waitForTimeout(300);
assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'horizontal overflow on mobile');
assert.ok(await page.$eval('#chart svg', (s) => s.getBoundingClientRect().width <= 375));
if (shots) await page.screenshot({ path: `${shots}/mobile.png`, fullPage: true });

await browser.close();
assert.deepEqual(problems, [], problems.join('\n'));
console.log('e2e: ok');
