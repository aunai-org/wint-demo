// Ensemble / multi-model behaviour in headless Chromium: node tests/ensemble.mjs [baseUrl] [screenshotDir]
// Uses the recorded real multi-model forecast (sample-multi-model.json) and a trimmed real ensemble
// response, with the forecast services mocked, so it needs no network.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? 'playwright');

const base = process.argv[2] ?? 'http://localhost:8765/';
const shots = process.argv[3];
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const MULTI = read('../sample-multi-model.json');
const ENSEMBLE = read('./fixtures/open_meteo_ensemble.json');

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1000, height: 900 }, reducedMotion: 'reduce' });
const problems = [];
page.on('console', (m) => m.type() === 'error' && !/^Failed to load resource/.test(m.text()) && problems.push(`console: ${m.text()}`));
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

const text = (sel) => page.textContent(sel);
const summaryMatches = (re) => page.waitForFunction((s) => new RegExp(s).test(document.getElementById('summary').textContent), re.source);
const statusIs = (re) => page.waitForFunction((s) => new RegExp(s).test(document.getElementById('status').textContent), re.source);
const kinds = () => page.$$eval('#strip .cell', (c) => Object.fromEntries(['ok', 'mix', 'bad'].map((k) => [k, c.filter((x) => x.classList.contains(k)).length])));
const startHours = (kind) => page.$$eval(`#strip .cell.${kind}`, (c) => [...new Set(c.map((x) => Number(x.getAttribute('aria-label').slice(0, 2))))].sort((a, b) => a - b));

await page.goto(base);
await page.waitForFunction(() => document.getElementById('status').textContent === 'Ready.');
assert.equal(await page.isVisible('#agree'), false, 'agreement control only appears for several forecast versions');

// ---- The recorded real forecast: 4 models, drone preset, 2 h operation ----
await page.click('#run-recorded');
await page.waitForSelector('#results:not([hidden])');
assert.match(await text('#summary'), /^43 of 47 possible start times meet your requirement: fits in every forecast version that can answer/);
assert.match(await text('#summary'), /not a probability/);
assert.deepEqual(await kinds(), { ok: 43, mix: 4, bad: 0 }); // same numbers as the CLI on this data
assert.equal(await page.isVisible('#agree'), true);
assert.equal(await page.isVisible('[data-mode="ensemble"]:not([hidden])'), true);
assert.equal(await page.$$eval('[data-mode="single"]', (n) => n.every((x) => x.hidden)), true);
assert.match(await text('#strip-hint'), /amber = it fits in some forecast versions but not enough/);
assert.equal(await page.isVisible('#ens-note'), false, 'two of four models do provide visibility');

// The chart shows the spread between versions and each version's own line (4 is few enough to tell apart).
assert.equal((await page.$$('#chart polygon.spread')).length >= 5, true);
assert.equal((await page.$$('#chart path.mline')).length, 5 * 4);
assert.equal((await page.$$('#chart circle.mk')).length, 5 * 48);

// Display-only marker colors agree with what the engine decided: a window has full agreement exactly when
// no hour in it has a split ("tight") or all-outside ("bad") marker.
const mismatches = await page.evaluate(() => {
  const flagged = [...document.querySelectorAll('#chart circle.mk[data-status="tight"], #chart circle.mk[data-status="bad"]')].map((m) => Number(m.dataset.t));
  const out = [];
  for (const c of document.querySelectorAll('#strip .cell')) {
    const [s, e] = [Number(c.dataset.start), Number(c.dataset.end)];
    const split = flagged.some((t) => t >= s && t < e);
    const full = Number(c.dataset.agreement) === 1;
    if (full === split) out.push(`${c.getAttribute('aria-label')} agreement=${c.dataset.agreement} split=${split}`);
  }
  return out;
});
assert.deepEqual(mismatches, [], 'chart markers disagree with the engine');

// The best window is selected: it names who could not answer, and shows each version's verdict.
assert.match(await text('#readout'), /Fits in 2 of 2 forecast versions that can answer: meets your requirement/);
assert.match(await text('#readout'), /Cannot say: 2 \(visibility for 2\)/);
assert.equal((await page.$$('#detail table.ev tr')).length, 1 + 4);
assert.equal(await page.$$eval('#detail tr.v-unknown', (r) => r.length), 2);
assert.match(await text('#detail'), /ecmwf_ifs025[\s\S]*cannot say[\s\S]*no visibility reading/);
if (shots) await page.screenshot({ path: `${shots}/ensemble.png`, fullPage: true });

// An amber window: the models split, and the blocker is named with a count.
await page.click('#strip .cell.mix');
assert.equal(await page.getAttribute('#rail', 'data-kind'), 'mix');
assert.match(await text('#readout'), /Fits in 1 of 2 forecast versions that can answer: does not meet your requirement/);
assert.match(await text('#readout'), /Blocked by [a-z ()0-9]+ in 1\./);
assert.equal(await page.$$eval('#detail tr.v-infeasible', (r) => r.length), 1);
assert.match(await text('#detail'), /does not fit[\s\S]*needed/);

// Rail and buttons work on agreement windows too: "next fit" skips amber cells.
await page.click('#strip .cell.mix');
const mixIdx = Number(await page.inputValue('#rail'));
await page.click('#next-fit');
assert.equal(await page.getAttribute('#rail', 'data-kind'), 'ok');
assert.ok(Number(await page.inputValue('#rail')) > mixIdx);

// ---- The agreement requirement ----
await page.selectOption('#agree', '0.5');
await summaryMatches(/^47 of 47 possible start times meet your requirement: fits in at least half/);
assert.deepEqual(await kinds(), { ok: 47, mix: 0, bad: 0 });
await page.selectOption('#agree', '1');
await summaryMatches(/^43 of 47/);

// ---- A rule on a metric nobody provides is called out by name ----
await page.click('#plan-panel > summary');
const plan = JSON.parse(await page.inputValue('#plan'));
plan.stages[0].constraints.push({ type: 'hard', name: 'radiation', metric: 'solar_radiation', comparison: '<', threshold: 800 });
await page.fill('#plan', JSON.stringify(plan));
await page.dispatchEvent('#plan', 'change');
await summaryMatches(/^0 of 47 possible start times meet/);
await page.waitForSelector('#ens-note:not([hidden])');
assert.match(await text('#ens-note'), /No forecast version provides solar_radiation, so rules on it cannot be judged/);
assert.equal((await kinds()).bad, 47);
// Windows where one model definitely breaks a limit still say so ('fits in 0 of 1'); where none does, nobody can answer.
const labels = await page.$$eval('#strip .cell', (c) => c.map((x) => x.getAttribute('aria-label')));
assert.ok(labels.some((l) => /no version could answer/.test(l)), 'some windows cannot be judged by anyone');
assert.ok(labels.every((l) => /no version could answer|fits in 0 of \d/.test(l)), 'none can fit while an unprovided rule applies');
await page.selectOption('#preset', 'field-work'); // switching preset regenerates the plan and re-runs
await page.selectOption('#preset', 'drone'); // ...and back: the extra rule is gone
await summaryMatches(/^43 of 47/);
await page.waitForSelector('#ens-note', { state: 'hidden' });

// ---- Time of day applies to every version: 09:00 to 12:00 on the place's clock ----
await page.selectOption('#tod', 'custom');
await page.fill('#tod-from', '09:00');
await page.fill('#tod-to', '12:00');
await page.dispatchEvent('#tod-to', 'change');
await page.waitForFunction(() => /"to": "12:00"/.test(document.getElementById('plan').value));
assert.deepEqual(await startHours('ok'), [9, 10]);
await page.$eval('#strip .cell[aria-label^="03:00"]', (c) => c.click());
assert.match(await text('#readout'), /Blocked by time of day in 4/);
await page.selectOption('#tod', 'any');
await summaryMatches(/^43 of 47/);

// ---- Live fetching of several versions (services mocked with real responses) ----
const requested = [];
const answer = (body) => (route) => { requested.push(route.request().url()); route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body }); };
await page.route('https://api.open-meteo.com/**', answer(MULTI));
await page.route('https://ensemble-api.open-meteo.com/**', answer(ENSEMBLE));
await page.selectOption('#source', 'models');
await page.click('#run-live');
await summaryMatches(/Data: live weather-model comparison for/);
assert.match(requested.at(-1), /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?.*&models=ecmwf_ifs025,gfs_seamless,icon_seamless,meteofrance_seamless&/);
assert.match(await text('#summary'), /^43 of 47/);
await page.selectOption('#source', 'ensemble');
await page.click('#run-live');
await summaryMatches(/Data: live ensemble for/);
assert.match(requested.at(-1), /^https:\/\/ensemble-api\.open-meteo\.com\/v1\/ensemble\?.*&models=icon_seamless&/);
assert.match(await text('#summary'), /at least half of all 6 versions able to answer/);
// The ensemble service has no visibility, and the drone preset has a visibility rule.
await page.waitForSelector('#ens-note:not([hidden])');
assert.match(await text('#ens-note'), /No forecast version provides visibility/);
assert.equal((await page.$$('#chart path.mline')).length, 4 * 6, '6 versions are still few enough to draw individually');
// A preset whose rules the ensemble can judge works fully.
await page.selectOption('#preset', 'field-work');
await page.waitForFunction(() => /field-work/.test(document.getElementById('plan').value));
await page.click('#run-live');
await summaryMatches(/of 23 possible start times meet/); // 24 hours, 2 h operation
assert.equal(await page.isVisible('#ens-note'), false);
// A service error is reported with its reason.
await page.unroute('https://ensemble-api.open-meteo.com/**');
await page.route('https://ensemble-api.open-meteo.com/**', (r) => r.fulfill({ status: 400, contentType: 'application/json', body: '{"error":true,"reason":"Cannot initialize model"}' }));
await page.click('#run-live');
await statusIs(/returned 400: Cannot initialize model/);

// ---- Going back to a single forecast restores the single-forecast view ----
await page.click('#run-sample');
await summaryMatches(/of 71 possible start times fit all your limits/);
assert.equal(await page.isVisible('#agree'), false);
assert.equal(await page.$$eval('[data-mode="ensemble"]', (n) => n.every((x) => x.hidden)), true);
assert.equal((await page.$$('#chart polygon.spread')).length, 0);
assert.deepEqual(Object.keys(await kinds()).length, 3);
assert.equal((await kinds()).mix, 0);

// ---- Mobile: no horizontal overflow, and the chart fits ----
await page.selectOption('#preset', 'drone');
await page.click('#run-recorded');
await summaryMatches(/^43 of 47/);
await page.setViewportSize({ width: 375, height: 800 });
await page.waitForTimeout(300);
assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'horizontal overflow on mobile');
assert.ok(await page.$eval('#chart svg', (s) => s.getBoundingClientRect().width <= 375));
if (shots) await page.screenshot({ path: `${shots}/ensemble-mobile.png`, fullPage: true });

await browser.close();
assert.deepEqual(problems, [], problems.join('\n'));
console.log('ensemble: ok');
