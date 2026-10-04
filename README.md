# wint-demo

A browser demo for [wint](https://github.com/aunai-org/wint), the deterministic environmental operability engine. Pick a place and an activity; it finds the time windows that stay inside your limits and shows the evidence for each decision.

There is no backend and no build step. The engine runs in your browser as WebAssembly, and forecasts come straight from [Open-Meteo](https://open-meteo.com/).

## Run it

```sh
npm run serve        # then open http://localhost:8765
```

(Any static file server works; the page must be served over http, not opened as a file, so the browser can load the `.wasm`.)

Try **Use synthetic sample data** first: it needs no network. **Find windows (live forecast)** calls Open-Meteo from your browser; **Upload CSV** takes your own hourly data (see the [CSV format](https://github.com/aunai-org/wint/blob/main/src/adapters/csv.rs)).

## What the demo does

- **Forecast source.** One forecast, a comparison of 4 weather models, or an ensemble of about 40 members. There is also a **recorded real forecast** (4 models, Berlin, 1 Oct 2026) that works offline, a synthetic sample, and CSV upload.
- **Start-time strip and rail.** Every possible start time is a cell, colored green, amber, red or grey by the rules below. The rail repeats the colors as a mini-strip; drag its marker, use the arrow keys, or use Previous fit, Next fit, Jump to best and Play.
- **Chart.** One panel per limited metric, hour by hour against its limit, with the selected operation shaded and day and night banded. For a plan with a wait between stages, each stage is shaded and a dashed outline joins them; only the stages count as "in the operation". With several forecast versions each panel draws the spread between the lowest and highest version, a median line, and a faint line per version when there are 8 or fewer. Each hour has a marker (rules below).
- **Readout.** For the selected start time: "fits in k of n forecast versions that can answer", what blocked the others, which versions could not say and why, and a per-version verdict table. The wording never shows a percentage chance.
- **Agreement needed.** With several versions, choose how much agreement a window needs: every version that can answer, at least 80%, or at least half.
- **Missing-metric banner.** If a rule needs a metric that no version provides (the ensemble service has no visibility, for example), the demo names it and says no window can meet the requirement while that rule applies.
- **Time of day.** Any time, daylight only, night only, or custom hours (including overnight such as 20:00 to 06:00), on the place's own clock. Times are shown in the place's local time by default, or your time zone, or UTC.
- **Days.** Every day, weekdays (Mon-Fri) or weekend (Sat-Sun). The weekday is the local day the window starts on, so an overnight window belongs to the evening it begins. A rejected start explains itself with the weekday and the allowed days.
- **A plan with a wait.** The activity list ends with a demo-only "paint a fence (with a wait)": paint, a 4 to 12 hour cure that is not checked, then a clear coat. It shows how the engine places the second stage in the best allowed slot; each best window lists the wait it chose.
- **Recorded forecast, as a check.** On the recorded Berlin forecast with the drone preset, 43 of 47 windows meet the default requirement. The command-line tool gives the same count on the same data.

## How to read the display (the rules)

These rules are the contract between the engine's results and what you see. They are implemented in one function, `colorOf()` in `app.js`, shown on screen as the key under the start-time strip, and checked against every cell by the tests (`tests/e2e.mjs` for one forecast, `tests/ensemble.mjs` for several versions). If you change one, change all three. The engine's own definitions (verdicts, agreement, coverage) are in the [wint specification](https://github.com/aunai-org/wint/blob/mile4/SPEC.md#uncertainty-ensembles-and-agreement).

### Start-time strip, rail and rail marker: one forecast

| Color | Rule | Cell label |
|---|---|---|
| green | Fits every hard limit, and the preference score **as displayed** (two decimals) is 0.80 or more | `fits, score 0.93` |
| amber | Fits every hard limit, but the displayed score is below 0.80 | `fits, score 0.62` |
| red | Rejected: a hard limit, or the time-of-day window, is broken | `rejected` |
| grey | Rejected because a reading the rules need is missing. The engine never passes a window on missing data, so it cannot be approved | `missing reading, so it cannot be approved` |

The color is judged on the score you can read, so a window labelled 0.80 is never colored "under 0.8". Grey is decided at the first failing hour: a window with a missing reading that would also break a limit later still shows grey.

### Start-time strip, rail and rail marker: several forecast versions

The color says **how much the versions that can answer agree**. It does not depend on the "Agreement needed" setting.

| Color | Rule | Cell label |
|---|---|---|
| green | Every version that can answer says it fits, and enough versions could answer (at least half of all) | `fits in 2 of 2` |
| amber | It fits in some versions only, or in all that answered but too few could answer | `fits in 1 of 2` |
| amber **with a dot** | An amber window that still meets the "Agreement needed" setting you chose | `fits in 3 of 4, meets your requirement` |
| red | It fits in none of the versions that can answer | `fits in 0 of 2` |
| grey | No version could answer | `no version could answer` |

So relaxing the requirement from "every version" to "at least half" adds dots and changes the count in the summary, but never recolors a split window to look unanimous.

### Hour markers on the chart

| Marker | One forecast | Several versions |
|---|---|---|
| green | Comfortably inside the limit | Every version with a reading is inside the limit |
| amber | Inside, but within about 15% of the limit's size (with a small floor for limits near zero) | The versions split: some inside, some past |
| red | Past a limit | No version is inside |
| hollow | No reading | No version has a reading |

### Wording

- Always **counts of forecast versions**: "fits in 3 of 4 versions that can answer". Never a percentage chance, because versions are not independent and ensemble members are not calibrated.
- A version that lacks a reading a rule needs **cannot say**. It is listed separately ("Cannot say: 2 (visibility for 2)") and is not counted as disagreeing. Every missing metric is named, not only the first.
- What blocked a window is named with a count ("Blocked by gust limit in 1").
- The summary states the requirement in force ("fits in every forecast version that can answer, with at least half of all 4 versions able to answer") and that this is not a probability.
- A metric that no version provides is named in a banner above the strip.
- **The engine returns data; this page owns every word.** A limit arrives as an operator and a threshold (`{"type": "comparison", "comparison": "<=", "threshold": 10}`), a time-of-day check as minutes and a UTC offset, a verdict as a tag. The wording ("needed <= 10", "09:00 to 11:00 local (UTC+02:00)"), the rounding, the units and every color are chosen here, in `app.js` (`describeExpectation`, `describeClock`, `fmtValue`, `colorOf`), and not by the engine. The engine's optional Rust `present` module is not used by this page. That is the point of the split: another page could word and color the same results differently without touching the engine.
- The decisions come from the engine (which windows fit, agreement, coverage, whether a window meets the requirement). The colors and hour markers are display-only, and a test checks that they agree with those decisions.

## How it fits together

| File | Role |
|---|---|
| `vendor/` | The engine, built from wint (`wint.js`, `wint_bg.wasm`, `wint.d.ts`). `vendor/VERSION` records the exact wint commit. |
| `app.js` | UI logic. Calls the engine's JSON-in/JSON-out functions; no weather logic lives here. |
| `sample-forecast.json` | Synthetic hourly data in Open-Meteo's response shape, for offline use. Not a real forecast. |
| `sample-multi-model.json` | A real 4-model Open-Meteo response for Berlin (trimmed to 48 h), recorded 1 Oct 2026, so agreement can be shown offline. |

Update the vendored engine from a local wint checkout (needs the Rust toolchain, `wasm32-unknown-unknown` and `wasm-bindgen-cli`, see wint's README):

```sh
scripts/update-wasm.sh ../wint
```

## Single-file build

`scripts/build-single.mjs` bundles the page into one self-contained HTML file (engine inlined as base64 WASM, sample data inlined, live-forecast controls hidden). It is meant for hosts that only allow a single page and block network access, such as a sandboxed artifact viewer:

```sh
node scripts/build-single.mjs dist/wint-demo.html            # full document
node scripts/build-single.mjs dist/wint-demo.html --fragment  # content only, for hosts that add their own <html>/<head>
```

## Tests

```sh
npm install && npx playwright install chromium
npm run serve &      # in another terminal, or in the background
npm test             # drives the page in headless Chromium using the synthetic sample
```

`npm test` (two suites) covers loading, results, the rail and chart (including a check that the chart's red markers agree with the engine's rejections), time-of-day modes, weekdays, the plan with a wait, the place clock, plan editing, CSV upload, graceful network failures and the mobile layout, using the synthetic sample and mocked API errors. The second suite covers several forecast versions: agreement colors, the per-version verdicts, the requirement control, the missing-metric banner, time of day across versions and live fetching with mocked responses. `npm run test:single` builds the single-file page and checks it under a strict no-network CSP (with WASM allowed), including the light/dark theme switch.

## Caveats

- **Not safety guidance.** Presets are illustrative starting points; scores are preferences, not probabilities; forecasts are uncertain.
- Open-Meteo's free API is for non-commercial use and requires attribution (CC BY 4.0). Review their terms before deploying this anywhere commercial.
- The live path was checked with real Open-Meteo responses replayed into the browser (place search, forecast URL, parsing, results), and both APIs return `access-control-allow-origin: *`. It has not been run in a browser talking to the API directly, because the development sandbox intercepts TLS.
- The single-file build cannot fetch forecasts when hosted in a sandbox that blocks network access; it works on sample data or your CSV.

## Licence

Dual-licensed `Apache-2.0 OR MIT`, matching wint. (Licence texts to be added before public release.)
