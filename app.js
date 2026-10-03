import init, * as wint from './vendor/wint.js';

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

const state = { mode: 'single', all: [], result: null, seriesObj: null, members: [], selected: 0, panelDefs: [], panels: [], geom: null, timer: null };
const MODELS = 'ecmwf_ifs025,gfs_seamless,icon_seamless,meteofrance_seamless'; // multi-model comparison
const ENSEMBLE_MODEL = 'icon_seamless'; // ensemble (about 40 members)
const AGREE_TEXT = { 1: 'every forecast version that can answer', 0.8: 'at least 80% of the versions that can answer', 0.5: 'at least half of the versions that can answer' };
let units = {};        // metric name -> canonical unit symbol
let series = null;     // single-forecast series JSON (string) currently loaded
let ensembleJson = null; // ensemble JSON (string) when several forecast versions are loaded
let dataKind = 'single'; // which of the two is current
const hasData = () => (dataKind === 'ensemble' ? !!ensembleJson : !!series);
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
  const source = $('source').value;
  const where = `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
  status('Fetching forecast…');
  if (source === 'single') {
    const body = await fetchText(wint.openMeteoUrl(lat, lon, days), 'the forecast service');
    series = wint.parseOpenMeteo(body);
    ensembleJson = null;
    dataKind = 'single';
    seriesLabel = `live forecast for ${where}`;
  } else {
    const url = source === 'models' ? wint.multiModelUrl(lat, lon, days, MODELS) : wint.ensembleUrl(lat, lon, days, ENSEMBLE_MODEL);
    ensembleJson = wint.parseOpenMeteoEnsemble(await fetchText(url, 'the forecast service'));
    series = null;
    dataKind = 'ensemble';
    seriesLabel = `live ${source === 'models' ? 'weather-model comparison' : 'ensemble'} for ${where}`;
  }
}
async function loadSample() {
  // The single-file build inlines the sample; the standalone site fetches it.
  const body = window.WINT_SAMPLE ?? await fetchText('sample-forecast.json', 'the sample file');
  series = wint.parseOpenMeteo(body);
  ensembleJson = null;
  dataKind = 'single';
  seriesLabel = 'synthetic sample data (not a real forecast)';
}
async function loadRecorded() {
  // A real multi-model forecast for Berlin, recorded on 1 Oct 2026, so agreement can be seen offline.
  const body = window.WINT_SAMPLE_MULTI ?? await fetchText('sample-multi-model.json', 'the recorded forecast');
  ensembleJson = wint.parseOpenMeteoEnsemble(body);
  series = null;
  dataKind = 'ensemble';
  seriesLabel = 'a recorded real forecast for Berlin from 4 weather models (1 Oct 2026)';
}
async function loadCsv(file) {
  series = wint.parseCsv(await file.text());
  ensembleJson = null;
  dataKind = 'single';
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
/** Shows the controls and wording that belong to the loaded kind of data. */
function setModeUi() {
  const ens = state.mode === 'ensemble';
  $('agree-l').hidden = !ens;
  document.querySelectorAll('[data-mode]').forEach((node) => (node.hidden = node.dataset.mode !== state.mode));
  $('strip-hint').textContent = ens
    ? 'Each cell is a start time; the color says how much the forecast versions agree (see the key). Click a cell for each version\'s verdict.'
    : 'Each cell is a start time; the color shows how it fares (see the key). Click a cell for the evidence.';
  $('scrub-hint').textContent = ens
    ? 'Drag the marker along the rail, or click the chart. Each panel shows the spread between forecast versions hour by hour against the limit. A marker is green when every version is inside the limit, amber when they split, red when none is. Counts of versions, not probabilities.'
    : 'Drag the marker along the rail, or click the chart. The charts show each limited reading hour by hour against its limit. Marker color shows headroom: green is comfortably inside the limit, amber is close to it (within about 15% of the limit), red is past it.';
}
function checkDaylight(members) {
  const mode = $('tod').value;
  if ((mode === 'day' || mode === 'night') && !members.some((m) => m.obs.some((o) => 'is_day' in o.values))) {
    throw new Error('This data has no daylight (is_day) values, so day or night cannot be told apart. Use "Custom hours" instead.');
  }
}
function run() {
  if (!hasData()) throw new Error('Load some data first.');
  if (dataKind === 'ensemble') return runEnsemble();
  state.mode = 'single';
  state.seriesObj = JSON.parse(series);
  state.members = [{ name: 'forecast', obs: state.seriesObj.observations }];
  checkDaylight(state.members);
  setModeUi();
  const result = JSON.parse(wint.search(series, $('plan').value));
  render(result);
}
function runEnsemble() {
  const ensemble = JSON.parse(ensembleJson);
  state.mode = 'ensemble';
  state.seriesObj = ensemble.members[0].series;
  state.members = ensemble.members.map((m) => ({ name: m.name, obs: m.series.observations }));
  checkDaylight(state.members);
  setModeUi();
  const result = JSON.parse(wint.searchEnsemble(ensembleJson, $('plan').value, Number($('agree').value), 0.5));
  renderEnsemble(result);
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
  if (state.mode === 'ensemble') return showEnsembleDetail(box, w);
  if (kind === 'ok') {
    box.append(el('strong', { textContent: `${fmtTime(w.start_ms)} → ${fmtTime(w.end_ms)}: fits your limits (score ${w.suitability.toFixed(2)})` }),
      el('p', { className: 'hint', textContent: 'For each rule, the reading closest to its limit (the tightest margin) or the worst-scoring reading:' }),
      evidenceTable(w.evidence));
  } else {
    box.append(el('strong', { textContent: `${fmtTime(w.start_ms)} → ${fmtTime(w.end_ms)}: rejected` }),
      el('p', { textContent: `First failure: ${w.failure.stage} / ${w.failure.constraint}, at ${fmtTime(w.failure.timestamp_ms)}: reading ${fmtReading(w.failure)}, needed ${w.failure.expected}.` }));
  }
}

/** Each forecast version's verdict on the window, and why. */
function showEnsembleDetail(box, w) {
  const table = el('table', { className: 'ev' });
  table.append(el('tr', {}, el('th', { textContent: 'Forecast version' }), el('th', { textContent: 'Verdict' }), el('th', { textContent: 'Why' })));
  const words = { feasible: 'fits', infeasible: 'does not fit', unknown: 'cannot say' };
  for (const o of w.outcomes) {
    const why = o.verdict === 'feasible' ? `preference score ${o.suitability.toFixed(2)}`
      : o.verdict === 'infeasible' ? `${o.failure.stage} / ${o.failure.constraint}: ${fmtReading(o.failure)}, needed ${o.failure.expected}`
      : `no ${o.failure.metric} reading`;
    table.append(el('tr', { className: `v-${o.verdict}` }, el('td', { textContent: o.member }), el('td', { textContent: words[o.verdict] }), el('td', { textContent: why })));
  }
  const details = el('details', {}, el('summary', { textContent: `Per-version verdicts (${w.outcomes.length})` }), el('div', { className: 'scroll' }, table));
  details.open = w.outcomes.length <= 8;
  box.append(el('strong', { textContent: `${fmtTime(w.start_ms)} → ${fmtTime(w.end_ms)}: what each forecast version says` }), details);
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
function buildPanels(plan, members) {
  const has = (metric) => members.some((m) => m.obs.some((o) => metric in o.values));
  const panels = [];
  for (const stage of plan.stages) {
    for (const c of stage.constraints) {
      if (c.type !== 'hard' || !(c.comparison in OPS) || !has(c.metric)) continue;
      let panel = panels.find((p) => p.metric === c.metric);
      if (!panel) { panel = { metric: c.metric, limits: [] }; panels.push(panel); }
      panel.limits.push({ op: c.comparison, threshold: c.threshold, name: c.name });
    }
  }
  return panels.slice(0, 5).map((p) => {
    const values = members.flatMap((m) => m.obs.map((o) => o.values[p.metric])).filter((v) => v !== undefined);
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

/** How the forecast versions stand at hour `i`: readings, how many are inside every limit, and the spread. */
function hourAgreement(panel, i) {
  const readings = state.members.map((m) => m.obs[i].values[panel.metric]).filter((v) => v !== undefined).sort((a, b) => a - b);
  const inside = readings.filter((v) => panel.limits.every((l) => OPS[l.op](v, l.threshold))).length;
  const n = readings.length;
  const status = n === 0 ? 'missing' : inside === n ? 'ok' : inside === 0 ? 'bad' : 'tight';
  const median = n === 0 ? undefined : n % 2 ? readings[(n - 1) / 2] : (readings[n / 2 - 1] + readings[n / 2]) / 2;
  return { status, inside, n, min: readings[0], max: readings[n - 1], median };
}

// ---------- rail + chart ----------
const ML = 50, MR = 12, PH = 86, GAP = 12, AXIS = 24;

/** Draws one chart panel per definition in `defs` and keeps the drawn panels in state.panels. */
function drawChart(defs) {
  const host = $('chart');
  host.replaceChildren();
  const { members } = state;
  const panels = defs;
  state.panels = [];
  if (!members.length || !panels.length) { state.geom = null; return; }
  const multi = members.length > 1;
  const obs = members[0].obs, n = obs.length, cadence = state.seriesObj.cadence_ms;
  const t0 = obs[0].timestamp_ms, span = n * cadence;
  const width = Math.max(host.clientWidth || 640, 320), plotW = width - ML - MR;
  const height = panels.length * (PH + GAP) + AXIS;
  const x = (t) => ML + ((t - t0) / span) * plotW;
  state.geom = { t0, span, cadence, plotW, x };
  const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': multi ? 'Hourly spread between forecast versions against their limits' : 'Hourly readings against their limits' });
  // consecutive night hours become one band (no seams between hours); is_day comes from the first version that has it
  const nightRuns = [];
  const daySource = members.find((m) => m.obs.some((o) => 'is_day' in o.values))?.obs ?? [];
  for (const o of daySource) {
    if (o.values.is_day !== 0) continue;
    const last = nightRuns[nightRuns.length - 1];
    if (last && last[1] === o.timestamp_ms) last[1] += cadence; else nightRuns.push([o.timestamp_ms, o.timestamp_ms + cadence]);
  }
  const cx = (i) => x(obs[i].timestamp_ms + cadence / 2);

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
    const stats = obs.map((_, i) => hourAgreement(panel, i));
    if (multi) {
      // spread between the lowest and highest version, in runs where at least one version has a reading
      let run = [];
      const flush = () => {
        if (run.length) {
          const up = run.map((i) => `${cx(i).toFixed(1)},${y(stats[i].max).toFixed(1)}`);
          const down = [...run].reverse().map((i) => `${cx(i).toFixed(1)},${y(stats[i].min).toFixed(1)}`);
          g.append(svgEl('polygon', { class: 'spread', points: [...up, ...down].join(' ') }));
        }
        run = [];
      };
      stats.forEach((s, i) => (s.n ? run.push(i) : flush()));
      flush();
      // each version as a faint line, when there are few enough to tell apart
      if (members.length <= 8) {
        for (const m of members) {
          let d = '', pen = false;
          m.obs.forEach((o, i) => {
            const v = o.values[panel.metric];
            if (v === undefined) { pen = false; return; }
            d += `${pen ? 'L' : 'M'}${cx(i).toFixed(1)},${y(v).toFixed(1)}`;
            pen = true;
          });
          g.append(svgEl('path', { class: 'mline', d }, svgEl('title', {}, m.name)));
        }
      }
    }
    for (const l of panel.limits) g.append(svgEl('line', { class: 'limit', x1: ML, x2: ML + plotW, y1: y(l.threshold), y2: y(l.threshold) }));
    // the line is the reading (single forecast) or the median across versions, broken where nothing has a reading
    let d = '', pen = false;
    stats.forEach((s, i) => {
      const v = multi ? s.median : obs[i].values[panel.metric];
      if (v === undefined) { pen = false; return; }
      d += `${pen ? 'L' : 'M'}${cx(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    g.append(svgEl('path', { class: 'line', d }));
    const markers = obs.map((o, i) => {
      const s = stats[i];
      let status, label, cyv;
      if (multi) {
        status = s.status;
        cyv = s.median;
        label = s.n === 0 ? `${fmtTime(o.timestamp_ms)}: no version has a reading`
          : `${fmtTime(o.timestamp_ms)}: ${s.inside} of ${s.n} versions inside the limit (range ${fmtValue(panel.metric, s.min)} to ${fmtValue(panel.metric, s.max)})`;
      } else {
        const v = o.values[panel.metric];
        const h = hourStatus(panel, v);
        status = h.status;
        cyv = v;
        label = `${fmtTime(o.timestamp_ms)}: ${fmtValue(panel.metric, v)} (${headroomText(panel, h)})`;
      }
      const cyp = cyv === undefined ? top + PH - 8 : y(cyv);
      const m = svgEl('circle', { class: `mk m-${status}`, cx: cx(i).toFixed(1), cy: cyp.toFixed(1), r: 3.6, 'data-status': status, 'data-metric': panel.metric, 'data-t': o.timestamp_ms, 'data-inside': s.inside ?? '', 'data-n': s.n ?? '' },
        svgEl('title', {}, label));
      g.append(m);
      return { m, t: o.timestamp_ms, status };
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

/** The rail's mini-strip: one segment per start time, colored like the strip. */
function drawRail() {
  const cells = $('rail-cells');
  cells.replaceChildren();
  for (const item of state.all) cells.append(el('span', { className: cellClass(item) }));
  const rail = $('rail');
  rail.max = String(Math.max(state.all.length - 1, 0));
  rail.disabled = state.all.length === 0;
}

function renderReadout(item) {
  const box = $('readout');
  box.replaceChildren();
  const w = item.w;
  if (state.mode === 'ensemble') return renderEnsembleReadout(box, item);
  const verdict = item.kind === 'ok'
    ? `Fits your limits, score ${w.suitability.toFixed(2)}`
    : `Rejected: ${w.failure.constraint} (${fmtReading(w.failure)}, needed ${w.failure.expected})`;
  box.append(el('div', { className: `verdict c-${item.color}`, textContent: `${fmtTime(w.start_ms)} → ${fmtTime(w.end_ms)}. ${verdict}` }));
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

/** "Fits in 3 of 4 that can answer", with the reasons: what blocked it and what could not be judged. */
function agreementLines(w) {
  const answering = w.feasible + w.infeasible;
  const lines = [];
  if (w.unknown) lines.push(`Cannot say: ${w.unknown} (${w.missing.map((m) => `${m.metric} for ${m.members}`).join(', ')}).`);
  if (w.blockers.length) lines.push(`Blocked by ${w.blockers.map((b) => `${b.constraint} in ${b.members}`).join(', ')}.`);
  if (w.suitability !== null && w.suitability !== undefined) lines.push(`Preference score ${w.suitability.toFixed(2)}, averaged over the versions where it fits.`);
  return { headline: w.agreement === null ? 'No forecast version could answer' : `Fits in ${w.feasible} of ${answering} forecast versions that can answer`, lines };
}

function renderEnsembleReadout(box, item) {
  const w = item.w;
  const { headline, lines } = agreementLines(w);
  box.append(el('div', { className: `verdict c-${item.color}`, textContent: `${fmtTime(w.start_ms)} → ${fmtTime(w.end_ms)}. ${headline}${w.meets_requirement ? ': meets your requirement' : ': does not meet your requirement'}` }));
  for (const line of lines) box.append(el('div', { className: 'hint', textContent: line }));
  const i = state.members[0].obs.findIndex((o) => o.timestamp_ms === w.start_ms);
  const list = el('ul');
  for (const { panel } of state.panels) {
    const s = hourAgreement(panel, i);
    list.append(el('li', {},
      el('i', { className: `dot m-${s.status}` }),
      el('span', { textContent: s.n ? `${panel.metric}: ${s.inside} of ${s.n} inside the limit` : `${panel.metric}: no reading` }),
      el('span', { className: 'hr', textContent: s.n ? `range ${fmtValue(panel.metric, s.min)} to ${fmtValue(panel.metric, s.max)}` : '' })));
  }
  if (state.panels.length) box.append(el('div', { className: 'hint', textContent: `At the ${fmtHour(w.start_ms)} hour:` }), list);
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
  rail.dataset.color = item.color; // the thumb takes the cell's color
  rail.setAttribute('aria-valuetext', `${fmtTime(w.start_ms)}, ${state.mode === 'ensemble' ? agreementLines(w).headline.toLowerCase() : item.kind === 'ok' ? `fits, score ${w.suitability.toFixed(2)}` : 'rejected'}`);
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
  const best = state.mode === 'ensemble' ? state.result?.windows[0] : state.result?.feasible[0];
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

const GOOD_SCORE = 0.8;
const isMissingReading = (w) => w.failure.actual == null && !w.failure.note;

/**
 * THE color rules for the start-time strip, the rail and its thumb. Keep this function, the README
 * section "How to read the display" and the tests (tests/colors in e2e.mjs and ensemble.mjs) in step.
 *
 * One forecast:
 *   green = fits, displayed preference score at least GOOD_SCORE   amber = fits, displayed score below it
 *   red   = rejected, a limit is broken                     grey  = rejected, a reading is missing
 * Several forecast versions: the color says how much the versions that can answer agree.
 *   green = all of them say it fits (and enough versions could answer)
 *   amber = it fits in some of them, or in all but too few could answer
 *   red   = it fits in none        grey = no version could answer
 *   Separately, `meets` marks an amber window that meets the "agreement needed" requirement, so a
 *   relaxed requirement never makes a split window look unanimous.
 */
function colorOf(item) {
  const w = item.w;
  if (state.mode === 'ensemble') {
    if (w.agreement === null) return 'grey';
    if (w.agreement === 0) return 'red';
    return w.agreement === 1 && w.meets_requirement ? 'green' : 'amber';
  }
  // Judged on the score as displayed (two decimals), so a window labelled 0.80 is never colored "under 0.8".
  if (item.kind === 'ok') return Number(w.suitability.toFixed(2)) >= GOOD_SCORE ? 'green' : 'amber';
  return isMissingReading(w) ? 'grey' : 'red';
}
/** Adds the color (and the "meets requirement" mark) to freshly built items. */
function colored(items) {
  return items.map((item) => {
    const color = colorOf(item);
    return { ...item, color, meets: state.mode === 'ensemble' && item.kind === 'ok' && color === 'amber' };
  });
}
const cellClass = (item) => `${item.kind} c-${item.color}${item.meets ? ' meets' : ''}`;

/** Builds the start-time strip: one button per candidate, grouped by day. */
function buildStrip(labelOf, extra) {
  const strip = $('strip');
  strip.replaceChildren();
  let lastDay = '';
  state.all.forEach((item, i) => {
    const day = fmtTime(item.w.start_ms, { hour: undefined, minute: undefined });
    if (day !== lastDay) { strip.append(el('div', { className: 'day', textContent: day })); lastDay = day; }
    const label = `${fmtHour(item.w.start_ms)} start: ${labelOf(item)}`;
    const cell = el('button', { type: 'button', className: `cell ${cellClass(item)}`, title: label, ariaPressed: 'false' });
    cell.setAttribute('aria-label', label);
    cell.dataset.start = String(item.w.start_ms);
    cell.dataset.end = String(item.w.end_ms);
    Object.entries(extra?.(item) ?? {}).forEach(([k, v]) => { cell.dataset[k] = String(v); });
    cell.addEventListener('click', () => select(i));
    strip.append(cell);
  });
}

/** Common ending of both render paths: rail, chart, first selection. */
function finishRender() {
  drawRail();
  state.panelDefs = buildPanels(JSON.parse($('plan').value), state.members);
  drawChart(state.panelDefs);
  if (state.all.length) select(bestIndex());
  status('');
  // Smooth scrolling only for people who have not asked for reduced motion.
  const calm = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  $('results').scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'nearest' });
}

function startRender(result, all) {
  stopPlay();
  state.all = all;
  state.result = result;
  state.panels = [];
  state.geom = null;
  $('results').hidden = false;
  $('detail').replaceChildren();
  $('readout').replaceChildren();
}

function render(result) {
  startRender(result, colored([
    ...result.feasible.map((w) => ({ kind: 'ok', w })),
    ...result.rejected.map((w) => ({ kind: 'bad', w })),
  ]).sort((a, b) => a.w.start_ms - b.w.start_ms));
  const total = state.all.length;
  $('ens-note').hidden = true;
  $('summary').textContent = total === 0
    ? `Your data (${seriesLabel}) is shorter than the operation, so there is nothing to search.`
    : `${result.feasible.length} of ${total} possible start times fit all your limits. Data: ${seriesLabel}.`;

  buildStrip((item) => (item.kind === 'ok' ? `fits, score ${item.w.suitability.toFixed(2)}` : item.color === 'grey' ? 'missing reading, so it cannot be approved' : 'rejected'));

  const best = $('best');
  best.replaceChildren();
  if (!result.feasible.length) {
    best.append(el('li', { textContent: 'No window fits. Click a red cell above to see which rule failed, or relax a limit in the plan.' }));
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
  finishRender();
}

/** Results for several forecast versions: agreement per window instead of a plain fit / no fit. */
function renderEnsemble(result) {
  const all = colored(result.windows
    .map((w) => ({ kind: w.meets_requirement ? 'ok' : (w.agreement ?? 0) > 0 ? 'mix' : 'bad', w })))
    .sort((a, b) => a.w.start_ms - b.w.start_ms);
  startRender(result, all);
  const total = all.length;
  const meeting = all.filter((it) => it.kind === 'ok').length;
  const requirement = AGREE_TEXT[Number($('agree').value)] ?? '';
  $('summary').textContent = total === 0
    ? `Your data (${seriesLabel}) is shorter than the operation, so there is nothing to search.`
    : `${meeting} of ${total} possible start times meet your requirement: fits in ${requirement}, with at least half of all ${result.members.length} versions able to answer. Data: ${seriesLabel}. This counts forecast versions; it is not a probability.`;

  // Rules on a metric that no forecast version provides cannot be judged by anyone: say so, by name
  // (the engine reports these as `unprovided`).
  const absent = result.unprovided;
  const note = $('ens-note');
  note.hidden = absent.length === 0;
  note.textContent = absent.length ? `No forecast version provides ${absent.join(', ')}, so rules on ${absent.length === 1 ? 'it' : 'them'} cannot be judged and no window can meet the requirement while they apply. Relax those rules in the plan, or use another source.` : '';

  buildStrip((item) => {
    const w = item.w;
    return w.agreement === null ? 'no version could answer' : `fits in ${w.feasible} of ${w.feasible + w.infeasible}${item.kind === 'ok' ? ', meets your requirement' : ''}`;
  }, (item) => ({ agreement: item.w.agreement ?? '', meets: item.kind === 'ok' }));

  const best = $('best');
  best.replaceChildren();
  if (!meeting) {
    best.append(el('li', { textContent: 'No window meets your requirement. The closest are listed first; click a cell above to see what each forecast version says, or lower the agreement needed.' }));
  }
  for (const w of result.windows.slice(0, 5)) {
    const { headline, lines } = agreementLines(w);
    const li = el('li', {},
      el('div', { className: 'when', textContent: `${fmtTime(w.start_ms)} → ${fmtTime(w.end_ms)}` }),
      el('div', { className: 'score', textContent: `${headline}${w.meets_requirement ? '' : ' (does not meet your requirement)'}` }));
    if (w.agreement !== null) {
      const bar = el('div', { className: 'bar' }, el('i'));
      bar.firstChild.style.width = `${Math.round(w.agreement * 100)}%`;
      li.append(bar);
    }
    for (const line of lines) li.append(el('div', { className: 'hint', textContent: line }));
    best.append(li);
  }
  finishRender();
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
  // Changing the activity or the length updates the plan and, when data is loaded, the answer.
  for (const id of ['preset', 'hours']) {
    $(id).addEventListener('change', () => guarded(null, async () => { refreshPlan(); if (hasData()) run(); }));
  }
  $('tz').addEventListener('change', () => { if (!$('results').hidden) guarded(null, run); });
  for (const id of ['tod', 'tod-from', 'tod-to']) {
    $(id).addEventListener('change', () => guarded(null, async () => { retune(); if (hasData()) run(); }));
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
  $('run-recorded').addEventListener('click', () => guarded(null, async () => { await loadRecorded(); run(); }));
  $('csv').addEventListener('change', (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (file) guarded(null, async () => { await loadCsv(file); run(); });
  });
  // Re-running after editing the plan reuses the loaded data.
  $('plan').addEventListener('change', () => { if (hasData()) guarded(null, async () => run()); });
  $('agree').addEventListener('change', () => { if (hasData()) guarded(null, async () => run()); });
  status('Ready.');
}

main().catch((error) => {
  status(`Could not start: ${messageOf(error)}`, true);
});
