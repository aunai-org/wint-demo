import init, * as wint from './vendor/wint.js';

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

let units = {};        // metric name -> canonical unit symbol
let series = null;     // series JSON (string) currently loaded
let seriesLabel = '';  // where the data came from, for the summary

// ---------- status / errors ----------
function status(message, isError = false) {
  const s = $('status');
  s.textContent = message;
  s.className = isError ? 'error' : '';
}
function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}
async function guarded(button, work) {
  const buttons = document.querySelectorAll('button');
  buttons.forEach((b) => (b.disabled = true));
  try {
    await work();
  } catch (error) {
    status(messageOf(error), true);
  } finally {
    buttons.forEach((b) => (b.disabled = false));
  }
}

// ---------- time formatting ----------
function fmtTime(ms, opts = {}) {
  const utc = $('tz').value === 'utc';
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    hour12: false, timeZone: utc ? 'UTC' : undefined, ...opts,
  }).format(new Date(ms));
}
const fmtHour = (ms) => fmtTime(ms, { weekday: undefined, day: undefined, month: undefined });
function fmtValue(metric, value) {
  if (value === null || value === undefined) return 'missing';
  const n = Number(value.toFixed(2));
  return units[metric] ? `${n} ${units[metric]}` : String(n);
}

// ---------- data sources ----------
async function fetchText(url, what) {
  let response;
  try {
    response = await fetch(url);
  } catch {
    throw new Error(`Could not reach ${what}. Check your connection, or try the sample data.`);
  }
  if (!response.ok) {
    let reason = '';
    try { reason = (await response.json()).reason ?? ''; } catch { /* not JSON */ }
    throw new Error(`${what} returned ${response.status}${reason ? `: ${reason}` : ''}`);
  }
  return response.text();
}

async function loadLive() {
  const lat = parseFloat($('lat').value), lon = parseFloat($('lon').value), days = parseInt($('days').value, 10);
  if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180)) throw new Error('Latitude must be within ±90 and longitude within ±180.');
  status('Fetching forecast…');
  const body = await fetchText(wint.openMeteoUrl(lat, lon, days), 'the forecast service');
  series = wint.parseOpenMeteo(body);
  seriesLabel = `live forecast for ${lat.toFixed(2)}, ${lon.toFixed(2)}`;
}
async function loadSample() {
  // The single-file build inlines the sample; the standalone site fetches it.
  const body = window.WINT_SAMPLE ?? await fetchText('sample-forecast.json', 'the sample file');
  series = wint.parseOpenMeteo(body);
  seriesLabel = 'synthetic sample data (not a real forecast)';
}
async function loadCsv(file) {
  series = wint.parseCsv(await file.text());
  seriesLabel = `your CSV (${file.name})`;
}

async function searchPlaces() {
  const name = $('place').value.trim();
  if (!name) return;
  status('Searching places…');
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=5&language=en&format=json`;
  const data = JSON.parse(await fetchText(url, 'the place search'));
  const list = $('place-results');
  list.replaceChildren();
  const found = data.results ?? [];
  if (!found.length) { status(`No places found for “${name}”.`, true); list.hidden = true; return; }
  for (const place of found) {
    const label = [place.name, place.admin1, place.country].filter(Boolean).join(', ');
    const button = el('button', { type: 'button', textContent: `${label} (${place.latitude.toFixed(2)}, ${place.longitude.toFixed(2)})` });
    button.addEventListener('click', () => {
      $('lat').value = place.latitude; $('lon').value = place.longitude;
      $('place').value = label; list.hidden = true; status(`Selected ${label}.`);
    });
    list.append(button);
  }
  list.hidden = false;
  status('Pick a place from the list.');
}

// ---------- plan ----------
function refreshPlan() {
  const hours = parseFloat($('hours').value);
  $('plan').value = JSON.stringify(JSON.parse(wint.presetPlan($('preset').value, hours)), null, 2);
  $('preset-desc').textContent = presets.find((p) => p.name === $('preset').value)?.description ?? '';
}

// ---------- run + render ----------
function run() {
  if (!series) throw new Error('Load some data first.');
  const result = JSON.parse(wint.search(series, $('plan').value));
  render(result);
}

function evidenceTable(items) {
  const table = el('table', { className: 'ev' });
  table.append(el('tr', {}, el('th', { textContent: 'Rule' }), el('th', { textContent: 'Reading' }), el('th', { textContent: 'Limit' }), el('th', { textContent: 'At' })));
  for (const e of items) {
    table.append(el('tr', {},
      el('td', { textContent: `${e.stage} / ${e.constraint}` }),
      el('td', { textContent: fmtValue(e.metric, e.actual) }),
      el('td', { textContent: e.expected }),
      el('td', { textContent: fmtTime(e.timestamp_ms) })));
  }
  return table;
}

function showDetail(kind, w) {
  const box = $('detail');
  box.replaceChildren();
  if (kind === 'ok') {
    box.append(el('strong', { textContent: `${fmtTime(w.start_ms)} → ${fmtTime(w.end_ms)}: fits your limits (score ${w.suitability.toFixed(2)})` }),
      el('p', { className: 'hint', textContent: 'For each rule, the reading closest to its limit (the tightest margin) or the worst-scoring reading:' }),
      evidenceTable(w.evidence));
  } else {
    box.append(el('strong', { textContent: `${fmtTime(w.start_ms)} → ${fmtTime(w.end_ms)}: rejected` }),
      el('p', { textContent: `First failure: ${w.failure.stage} / ${w.failure.constraint}, at ${fmtTime(w.failure.timestamp_ms)}: reading ${fmtValue(w.failure.metric, w.failure.actual)}, needed ${w.failure.expected}.` }));
  }
}

function render(result) {
  const all = [
    ...result.feasible.map((w) => ({ kind: 'ok', w })),
    ...result.rejected.map((w) => ({ kind: 'bad', w })),
  ].sort((a, b) => a.w.start_ms - b.w.start_ms);

  $('results').hidden = false;
  $('detail').replaceChildren();
  const total = all.length;
  $('summary').textContent = total === 0
    ? `Your data (${seriesLabel}) is shorter than the operation, so there is nothing to search.`
    : `${result.feasible.length} of ${total} possible start times fit all your limits. Data: ${seriesLabel}.`;

  const strip = $('strip');
  strip.replaceChildren();
  let lastDay = '';
  const minScore = Math.min(...result.feasible.map((w) => w.suitability), 1);
  for (const item of all) {
    const day = fmtTime(item.w.start_ms, { hour: undefined, minute: undefined });
    if (day !== lastDay) { strip.append(el('div', { className: 'day', textContent: day })); lastDay = day; }
    const label = `${fmtHour(item.w.start_ms)} start: ${item.kind === 'ok' ? `fits, score ${item.w.suitability.toFixed(2)}` : 'rejected'}`;
    const cell = el('button', { type: 'button', className: `cell ${item.kind}`, title: label, ariaPressed: 'false' });
    cell.setAttribute('aria-label', label);
    if (item.kind === 'ok') {
      const span = Math.max(1 - minScore, 0.001);
      cell.style.setProperty('--a', (0.45 + 0.55 * (item.w.suitability - minScore) / span).toFixed(2));
    }
    cell.addEventListener('click', () => {
      strip.querySelectorAll('.cell').forEach((c) => c.setAttribute('aria-pressed', 'false'));
      cell.setAttribute('aria-pressed', 'true');
      showDetail(item.kind, item.w);
    });
    strip.append(cell);
  }

  const best = $('best');
  best.replaceChildren();
  if (!result.feasible.length) {
    best.append(el('li', { textContent: 'No window fits. Click a grey cell above to see which rule failed, or relax a limit in the plan.' }));
  }
  for (const w of result.feasible.slice(0, 5)) {
    const li = el('li', {},
      el('div', { className: 'when', textContent: `${fmtTime(w.start_ms)} → ${fmtTime(w.end_ms)}` }),
      el('div', { className: 'score', textContent: `Preference score ${w.suitability.toFixed(2)} (1 = ideal on every soft preference)` }));
    const bar = el('div', { className: 'bar' }, el('i'));
    bar.firstChild.style.width = `${Math.round(w.suitability * 100)}%`;
    li.append(bar);
    if (w.stages.length > 1) {
      li.append(el('div', { className: 'hint', textContent: w.stages.map((s) => `${s.name}: ${fmtHour(s.start_ms)}–${fmtHour(s.end_ms)}, score ${s.suitability.toFixed(2)}`).join(' · ') }));
    }
    li.append(el('details', {}, el('summary', { textContent: 'Evidence' }), evidenceTable(w.evidence)));
    best.append(li);
  }
  status('');
  $('results').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ---------- wiring ----------
let presets = [];
function embeddedWasm() {
  // The single-file build inlines the engine as base64 (see scripts/build-single.mjs).
  const b64 = window.WINT_WASM_B64;
  return b64 ? { module_or_path: Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)) } : undefined;
}
async function main() {
  await init(embeddedWasm());
  if (window.WINT_EMBED) {
    document.querySelectorAll('[data-live]').forEach((node) => (node.hidden = true));
    $('embed-note').hidden = false;
  }
  $('ver').textContent = `v${wint.version()}`;
  presets = JSON.parse(wint.listPresets());
  for (const p of presets) $('preset').append(el('option', { value: p.name, textContent: p.name }));
  for (const m of JSON.parse(wint.listMetrics())) {
    units[m.name] = m.unit;
    $('units').append(el('li', { textContent: `${m.name}: ${m.unit}` }));
  }
  refreshPlan();
  $('preset').addEventListener('change', () => guarded(null, refreshPlan));
  $('hours').addEventListener('change', () => guarded(null, refreshPlan));
  $('tz').addEventListener('change', () => { if (!$('results').hidden) guarded(null, run); });
  $('search-place').addEventListener('click', () => guarded(null, searchPlaces));
  $('place').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); guarded(null, searchPlaces); } });
  $('run-live').addEventListener('click', () => guarded(null, async () => { await loadLive(); run(); }));
  $('run-sample').addEventListener('click', () => guarded(null, async () => { await loadSample(); run(); }));
  $('csv').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) guarded(null, async () => { await loadCsv(file); run(); });
  });
  // Re-running after editing the plan reuses the loaded data.
  $('plan').addEventListener('change', () => { if (series) guarded(null, async () => run()); });
  status('Ready.');
}

main().catch((error) => {
  status(`Could not start: ${messageOf(error)}`, true);
});
