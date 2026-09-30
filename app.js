import init, * as wint from './vendor/wint.js';

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

const state = { all: [], result: null, seriesObj: null, selected: 0, panelDefs: [], panels: [], geom: null, timer: null };
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
// "place" shows the forecast location's clock (the series' UTC offset), "utc" shows UTC,
// "local" uses the browser's zone. Offsets are a single fixed value per forecast.
function zoned(ms) {
  const mode = $('tz').value;
  if (mode === 'local') return { ms, timeZone: undefined };
  const offsetMin = mode === 'place' ? (state.seriesObj?.utc_offset_minutes ?? 0) : 0;
  return { ms: ms + offsetMin * 60000, timeZone: 'UTC' };
}
function fmtTime(ms, opts = {}) {
  const z = zoned(ms);
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    hour12: false, timeZone: z.timeZone, ...opts,
  }).format(new Date(z.ms));
}
const fmtHour = (ms) => fmtTime(ms, { weekday: undefined, day: undefined, month: undefined });
function clockHour(ms) {
  const z = zoned(ms);
  return Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone: z.timeZone }).format(new Date(z.ms))) % 24;
}
function fmtReading(e) {
  return e.note ?? fmtValue(e.metric, e.actual);
}
function fmtValue(metric, value) {
  if (value === null || value === undefined) return 'missing';
  if (metric === 'is_day') return value === 1 ? 'day' : 'night';
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
const toClock = (value) => (value === '00:00' ? '24:00' : value); // "until midnight" is 24:00

/** Applies the time-of-day control to a plan object (daylight/night via is_day, or a clock window). */
function applyTimeOfDay(plan) {
  const mode = $('tod').value;
  for (const stage of plan.stages) {
    delete stage.schedule;
    stage.constraints = stage.constraints.filter((c) => !(c.type === 'hard' && c.metric === 'is_day'));
    if (mode === 'day' || mode === 'night') {
      stage.constraints.unshift({ type: 'hard', name: mode === 'day' ? 'daylight only' : 'night only', metric: 'is_day', comparison: '==', threshold: mode === 'day' ? 1 : 0 });
    }
    if (mode === 'custom') stage.schedule = { from: $('tod-from').value || '00:00', to: toClock($('tod-to').value || '24:00') };
  }
  return plan;
}
function refreshPlan() {
  const hours = parseFloat($('hours').value);
  const plan = applyTimeOfDay(JSON.parse(wint.presetPlan($('preset').value, hours)));
  $('plan').value = JSON.stringify(plan, null, 2);
  $('preset-desc').textContent = presets.find((p) => p.name === $('preset').value)?.description ?? '';
}
/** Re-applies the time-of-day control to the plan as currently edited, keeping manual edits. */
function retune() {
  const custom = $('tod').value === 'custom';
  $('tod-from-l').hidden = !custom;
  $('tod-to-l').hidden = !custom;
  let plan;
  try { plan = JSON.parse($('plan').value); } catch { return refreshPlan(); }
  if (!Array.isArray(plan.stages)) return refreshPlan();
  $('plan').value = JSON.stringify(applyTimeOfDay(plan), null, 2);
}

// ---------- run + render ----------
function run() {
  if (!series) throw new Error('Load some data first.');
  state.seriesObj = JSON.parse(series);
  const mode = $('tod').value;
  if ((mode === 'day' || mode === 'night') && !state.seriesObj.observations.some((o) => 'is_day' in o.values)) {
    throw new Error('This data has no daylight (is_day) values, so day or night cannot be told apart. Use "Custom hours" instead.');
  }
  const result = JSON.parse(wint.search(series, $('plan').value));
  render(result);
}

function evidenceTable(items) {
  const table = el('table', { className: 'ev' });
  table.append(el('tr', {}, el('th', { textContent: 'Rule' }), el('th', { textContent: 'Reading' }), el('th', { textContent: 'Limit' }), el('th', { textContent: 'At' })));
  for (const e of items) {
    table.append(el('tr', {},
      el('td', { textContent: `${e.stage} / ${e.constraint}` }),
      el('td', { textContent: fmtReading(e) }),
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
      el('p', { textContent: `First failure: ${w.failure.stage} / ${w.failure.constraint}, at ${fmtTime(w.failure.timestamp_ms)}: reading ${fmtReading(w.failure)}, needed ${w.failure.expected}.` }));
  }
}

// ---------- per-hour view of the limits (display only; the engine decides feasibility) ----------
const SVG = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}, ...children) => {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  node.append(...children);
  return node;
};
const OPS = { '<': (a, t) => a < t, '<=': (a, t) => a <= t, '>': (a, t) => a > t, '>=': (a, t) => a >= t };
const fmtNum = (n) => String(Number(n.toFixed(2)));
/** Short axis label so large values (visibility in metres) fit the left margin. */
const fmtAxis = (n) => (Math.abs(n) >= 1000 ? `${Number((n / 1000).toFixed(1))}k` : String(Number(n.toFixed(Math.abs(n) >= 100 ? 0 : 1))));

/** Distance a reading sits inside a limit (negative = past it). */
function marginOf(op, actual, threshold) {
  return op === '<' || op === '<=' ? threshold - actual : actual - threshold;
}

/** One panel per metric that has a range limit (not an on/off flag like is_day), in plan order. */
function buildPanels(plan, seriesObj) {
  const panels = [];
  for (const stage of plan.stages) {
    for (const c of stage.constraints) {
      if (c.type !== 'hard' || !(c.comparison in OPS)) continue;
      if (!seriesObj.observations.some((o) => c.metric in o.values)) continue;
      let panel = panels.find((p) => p.metric === c.metric);
      if (!panel) { panel = { metric: c.metric, limits: [] }; panels.push(panel); }
      panel.limits.push({ op: c.comparison, threshold: c.threshold, name: c.name });
    }
  }
  return panels.slice(0, 5).map((p) => {
    const values = seriesObj.observations.map((o) => o.values[p.metric]).filter((v) => v !== undefined);
    const all = [...values, ...p.limits.map((l) => l.threshold)];
    let lo = Math.min(...all), hi = Math.max(...all);
    if (hi === lo) { lo -= 1; hi += 1; }
    const pad = (hi - lo) * 0.08;
    const floorAtZero = lo >= 0; // do not pad a non-negative metric below zero
    return { ...p, range: Math.max(Math.max(...values) - Math.min(...values), 1e-9), lo: floorAtZero ? Math.max(lo - pad, 0) : lo - pad, hi: hi + pad };
  });
}

/**
 * Headroom class for one reading: ok, tight, bad, or missing. "Tight" means within about 15% of the
 * limit's own size (with a small floor, 3% of the metric's range, for limits at or near zero).
 */
function hourStatus(panel, value) {
  if (value === undefined) return { status: 'missing' };
  let worst = null;
  for (const l of panel.limits) {
    const margin = marginOf(l.op, value, l.threshold);
    const pass = OPS[l.op](value, l.threshold);
    if (!pass) return { status: 'bad', margin, limit: l };
    const tolerance = Math.max(0.15 * Math.abs(l.threshold), 0.03 * panel.range);
    if (!worst || margin - tolerance < worst.margin - worst.tolerance) worst = { margin, limit: l, tolerance };
  }
  return { status: worst.margin <= worst.tolerance ? 'tight' : 'ok', margin: worst.margin, limit: worst.limit };
}
const headroomText = (panel, s) => s.margin === undefined ? 'no reading'
  : `${fmtNum(Math.abs(s.margin))} ${units[panel.metric] ?? ''} ${s.status === 'bad' ? 'past' : 'inside'} the limit`.replace('  ', ' ');

// ---------- rail + chart ----------
const ML = 50, MR = 12, PH = 86, GAP = 12, AXIS = 24;

/** Draws one chart panel per definition in `defs` and keeps the drawn panels in state.panels. */
function drawChart(defs) {
  const host = $('chart');
  host.replaceChildren();
  const { seriesObj } = state;
  const panels = defs;
  state.panels = [];
  if (!seriesObj || !panels.length) { state.geom = null; return; }
  const obs = seriesObj.observations, n = obs.length, cadence = seriesObj.cadence_ms;
  const t0 = obs[0].timestamp_ms, span = n * cadence;
  const width = Math.max(host.clientWidth || 640, 320), plotW = width - ML - MR;
  const height = panels.length * (PH + GAP) + AXIS;
  const x = (t) => ML + ((t - t0) / span) * plotW;
  state.geom = { t0, span, cadence, plotW, x };
  const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': 'Hourly readings against their limits' });
  // consecutive night hours become one band (no seams between hours)
  const nightRuns = [];
  for (const o of obs) {
    if (o.values.is_day !== 0) continue;
    const last = nightRuns[nightRuns.length - 1];
    if (last && last[1] === o.timestamp_ms) last[1] += cadence; else nightRuns.push([o.timestamp_ms, o.timestamp_ms + cadence]);
  }

  state.panels = panels.map((panel, pi) => {
    const top = pi * (PH + GAP);
    const y = (v) => top + 18 + (1 - (v - panel.lo) / (panel.hi - panel.lo)) * (PH - 22);
    const g = svgEl('g');
    for (const [from, to] of nightRuns) g.append(svgEl('rect', { class: 'night', x: x(from).toFixed(1), y: top + 14, width: (x(to) - x(from)).toFixed(1), height: PH - 14 }));
    g.append(svgEl('line', { class: 'frame', x1: ML, x2: ML + plotW, y1: top + PH, y2: top + PH }));
    const unit = units[panel.metric] ? ` (${units[panel.metric]})` : '';
    g.append(svgEl('text', { class: 'title', x: ML, y: top + 11 }, `${panel.metric}${unit}`));
    const limitText = panel.limits.map((l) => `${l.op === '<' || l.op === '<=' ? '≤' : '≥'} ${fmtNum(l.threshold)}`).join(' · ');
    g.append(svgEl('text', { class: 'ax', x: ML + plotW, y: top + 11, 'text-anchor': 'end' }, `limit ${limitText}`));
    g.append(svgEl('text', { class: 'ax', x: ML - 6, y: y(panel.hi) + 4, 'text-anchor': 'end' }, fmtAxis(panel.hi)));
    g.append(svgEl('text', { class: 'ax', x: ML - 6, y: y(panel.lo) + 4, 'text-anchor': 'end' }, fmtAxis(panel.lo)));
    const band = svgEl('rect', { class: 'band', y: top + 14, height: PH - 14, x: 0, width: 0 });
    g.append(band);
    for (const l of panel.limits) g.append(svgEl('line', { class: 'limit', x1: ML, x2: ML + plotW, y1: y(l.threshold), y2: y(l.threshold) }));
    // reading line, broken where a reading is missing
    let d = '', pen = false;
    obs.forEach((o) => {
      const v = o.values[panel.metric];
      if (v === undefined) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${x(o.timestamp_ms + cadence / 2).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    g.append(svgEl('path', { class: 'line', d }));
    const markers = obs.map((o) => {
      const v = o.values[panel.metric];
      const s = hourStatus(panel, v);
      const cx = x(o.timestamp_ms + cadence / 2), cy = v === undefined ? top + PH - 8 : y(v);
      const m = svgEl('circle', { class: `mk m-${s.status}`, cx: cx.toFixed(1), cy: cy.toFixed(1), r: 3.6, 'data-status': s.status, 'data-metric': panel.metric, 'data-t': o.timestamp_ms },
        svgEl('title', {}, `${fmtTime(o.timestamp_ms)}: ${fmtValue(panel.metric, v)} (${headroomText(panel, s)})`));
      g.append(m);
      return { m, t: o.timestamp_ms, status: s.status };
    });
    const cursor = svgEl('line', { class: 'cursor', y1: top + 14, y2: top + PH, x1: 0, x2: 0 });
    g.append(cursor);
    svg.append(g);
    return { panel, band, cursor, markers };
  });

  // time axis under the last panel: a tick every 1-24 h, whichever keeps labels apart
  const axisY = panels.length * (PH + GAP) - GAP + 16;
  const stepH = [1, 2, 3, 6, 12, 24].find((h) => (plotW / n) * h >= 54) ?? 24;
  obs.forEach((o) => {
    const hour = clockHour(o.timestamp_ms);
    if (hour % stepH !== 0) return;
    const label = hour === 0 ? fmtTime(o.timestamp_ms, { hour: undefined, minute: undefined }) : `${String(hour).padStart(2, '0')}:00`;
    svg.append(svgEl('text', { class: 'ax', x: x(o.timestamp_ms), y: axisY, 'text-anchor': 'middle' }, label));
  });

  // click or drag anywhere on the chart to move the marker
  let dragging = false;
  const seek = (ev) => {
    const box = svg.getBoundingClientRect();
    const px = ((ev.clientX - box.left) / box.width) * width;
    const t = t0 + ((px - ML) / plotW) * span;
    select(Math.max(0, Math.min(state.all.length - 1, Math.floor((t - t0) / cadence))));
  };
  svg.addEventListener('pointerdown', (ev) => { dragging = true; svg.setPointerCapture?.(ev.pointerId); seek(ev); });
  svg.addEventListener('pointermove', (ev) => { if (dragging) seek(ev); });
  svg.addEventListener('pointerup', () => { dragging = false; });
  svg.addEventListener('pointercancel', () => { dragging = false; });
  host.append(svg);
}

function drawRail(result) {
  const cells = $('rail-cells');
  cells.replaceChildren();
  const minScore = Math.min(...result.feasible.map((w) => w.suitability), 1);
  for (const item of state.all) {
    const span = el('span', { className: item.kind });
    if (item.kind === 'ok') span.style.setProperty('--a', (0.45 + 0.55 * (item.w.suitability - minScore) / Math.max(1 - minScore, 0.001)).toFixed(2));
    cells.append(span);
  }
  const rail = $('rail');
  rail.max = String(Math.max(state.all.length - 1, 0));
  rail.disabled = state.all.length === 0;
}

function renderReadout(item) {
  const box = $('readout');
  box.replaceChildren();
  const w = item.w;
  const verdict = item.kind === 'ok'
    ? `Fits your limits, score ${w.suitability.toFixed(2)}`
    : `Rejected: ${w.failure.constraint} (${fmtReading(w.failure)}, needed ${w.failure.expected})`;
  box.append(el('div', { className: `verdict ${item.kind}`, textContent: `${fmtTime(w.start_ms)} → ${fmtTime(w.end_ms)}. ${verdict}` }));
  const obs = state.seriesObj.observations.find((o) => o.timestamp_ms === w.start_ms);
  const list = el('ul');
  for (const { panel } of state.panels) {
    const v = obs?.values[panel.metric];
    const s = hourStatus(panel, v);
    list.append(el('li', {},
      el('i', { className: `dot m-${s.status}` }),
      el('span', { textContent: `${panel.metric}: ${fmtValue(panel.metric, v)}` }),
      el('span', { className: 'hr', textContent: headroomText(panel, s) })));
  }
  if (state.panels.length) box.append(el('div', { className: 'hint', textContent: `Readings at the ${fmtHour(w.start_ms)} hour:` }), list);
}

/** Moves the selection: strip, rail, chart marker and the readout/evidence panels all follow. */
function select(i) {
  if (!state.all.length) return;
  state.selected = i;
  const item = state.all[i];
  const w = item.w;
  $('strip').querySelectorAll('.cell').forEach((c, ci) => c.setAttribute('aria-pressed', String(ci === i)));
  const rail = $('rail');
  rail.value = String(i);
  rail.dataset.kind = item.kind;
  rail.setAttribute('aria-valuetext', `${fmtTime(w.start_ms)}, ${item.kind === 'ok' ? `fits, score ${w.suitability.toFixed(2)}` : 'rejected'}`);
  const g = state.geom;
  for (const p of state.panels) {
    if (g) {
      const x0 = g.x(w.start_ms), x1 = g.x(w.end_ms);
      p.band.setAttribute('x', x0.toFixed(1));
      p.band.setAttribute('width', Math.max(x1 - x0, 1).toFixed(1));
      p.cursor.setAttribute('x1', x0.toFixed(1));
      p.cursor.setAttribute('x2', x0.toFixed(1));
    }
    p.markers.forEach((m) => m.m.classList.toggle('inwin', m.t >= w.start_ms && m.t < w.end_ms));
  }
  renderReadout(item);
  showDetail(item.kind, w);
}

function stepFit(direction) {
  for (let i = state.selected + direction; i >= 0 && i < state.all.length; i += direction) {
    if (state.all[i].kind === 'ok') return select(i);
  }
}
function bestIndex() {
  const best = state.result?.feasible[0];
  return best ? state.all.findIndex((it) => it.w.start_ms === best.start_ms) : 0;
}
function stopPlay() {
  clearInterval(state.timer);
  state.timer = null;
  $('play').textContent = '▶ Play';
  $('play').setAttribute('aria-pressed', 'false');
}
function togglePlay() {
  if (state.timer) return stopPlay();
  if (state.selected >= state.all.length - 1) select(0);
  $('play').textContent = '⏸ Pause';
  $('play').setAttribute('aria-pressed', 'true');
  state.timer = setInterval(() => {
    if (state.selected >= state.all.length - 1) return stopPlay();
    select(state.selected + 1);
  }, 450);
}

function render(result) {
  stopPlay();
  const all = [
    ...result.feasible.map((w) => ({ kind: 'ok', w })),
    ...result.rejected.map((w) => ({ kind: 'bad', w })),
  ].sort((a, b) => a.w.start_ms - b.w.start_ms);
  state.all = all;
  state.result = result;
  state.panels = [];
  state.geom = null;

  $('results').hidden = false;
  $('detail').replaceChildren();
  $('readout').replaceChildren();
  const total = all.length;
  $('summary').textContent = total === 0
    ? `Your data (${seriesLabel}) is shorter than the operation, so there is nothing to search.`
    : `${result.feasible.length} of ${total} possible start times fit all your limits. Data: ${seriesLabel}.`;

  const strip = $('strip');
  strip.replaceChildren();
  let lastDay = '';
  const minScore = Math.min(...result.feasible.map((w) => w.suitability), 1);
  all.forEach((item, i) => {
    const day = fmtTime(item.w.start_ms, { hour: undefined, minute: undefined });
    if (day !== lastDay) { strip.append(el('div', { className: 'day', textContent: day })); lastDay = day; }
    const label = `${fmtHour(item.w.start_ms)} start: ${item.kind === 'ok' ? `fits, score ${item.w.suitability.toFixed(2)}` : 'rejected'}`;
    const cell = el('button', { type: 'button', className: `cell ${item.kind}`, title: label, ariaPressed: 'false' });
    cell.setAttribute('aria-label', label);
    cell.dataset.start = String(item.w.start_ms);
    cell.dataset.end = String(item.w.end_ms);
    if (item.kind === 'ok') {
      cell.style.setProperty('--a', (0.45 + 0.55 * (item.w.suitability - minScore) / Math.max(1 - minScore, 0.001)).toFixed(2));
    }
    cell.addEventListener('click', () => select(i));
    strip.append(cell);
  });

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

  drawRail(result);
  state.panelDefs = buildPanels(JSON.parse($('plan').value), state.seriesObj);
  drawChart(state.panelDefs);
  if (total) select(bestIndex());
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
  for (const id of ['tod', 'tod-from', 'tod-to']) {
    $(id).addEventListener('change', () => guarded(null, async () => { retune(); if (series) run(); }));
  }
  $('rail').addEventListener('input', (e) => select(Number(e.target.value)));
  $('prev-fit').addEventListener('click', () => stepFit(-1));
  $('next-fit').addEventListener('click', () => stepFit(1));
  $('best-btn').addEventListener('click', () => select(bestIndex()));
  $('play').addEventListener('click', togglePlay);
  let resizeTimer;
  new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (state.result && state.panelDefs) { const keep = state.selected; drawChart(state.panelDefs); select(keep); }
    }, 120);
  }).observe($('chart'));
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
