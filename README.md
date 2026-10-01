# wint-demo

A browser demo for [wint](https://github.com/aunai-org/wint), the deterministic environmental operability engine. Pick a place and an activity; it finds the time windows that stay inside your limits and shows the evidence for each decision.

There is no backend and no build step. The engine runs in your browser as WebAssembly, and forecasts come straight from [Open-Meteo](https://open-meteo.com/).

## Run it

```sh
npm run serve        # then open http://localhost:8765
```

(Any static file server works; the page must be served over http, not opened as a file, so the browser can load the `.wasm`.)

What you can do with it:

- **Scrub through time.** A rail under the start-time strip lets you drag (or use the arrow keys, Previous/Next fit, Jump to best, Play) through every possible start time. Charts below show each limited reading hour by hour against its limit, with the selected operation shaded and day/night banded.
- **Headroom colors.** Each hourly marker is green (comfortably inside the limit), amber (within about 15% of the limit) or red (past it). This is headroom against the limits, *not* a confidence score: wint treats the forecast as exact, and forecast uncertainty is on the roadmap.
- **Time of day.** Any time, daylight only, night only, or custom hours (including overnight such as 20:00 to 06:00), on the place's own clock. Times are shown in the place's local time by default, or your time zone, or UTC.

- **Compare forecasts.** Choose "Compare 4 weather models" or "Ensemble (about 40 members)" as the forecast source, or load the **recorded real forecast** (4 models, Berlin, 1 Oct 2026; works offline). Each start time then shows "fits in k of n forecast versions", the strip and rail shade by how many agree (green: meets your requirement, amber: fits in some but not enough, grey: fits in none), and the chart draws the spread between versions. Pick how much agreement you need. A version that lacks a reading a rule needs (a model with no visibility) *cannot say* and is not counted as disagreeing; a banner names any metric that no version provides. This counts forecast versions; it is **not** a probability.

Try **Use synthetic sample data** first: it needs no network. **Find windows (live forecast)** calls Open-Meteo from your browser; **Upload CSV** takes your own hourly data (see the [CSV format](https://github.com/aunai-org/wint/blob/main/src/adapters/csv.rs)).

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

`npm test` (two suites) covers loading, results, the rail and chart (including a check that the chart's red markers agree with the engine's rejections), time-of-day modes, the place clock, plan editing, CSV upload, graceful network failures and the mobile layout, using the synthetic sample and mocked API errors. The second suite covers several forecast versions: agreement colors, the per-version verdicts, the requirement control, the missing-metric banner, time of day across versions and live fetching with mocked responses. `npm run test:single` builds the single-file page and checks it under a strict no-network CSP (with WASM allowed), including the light/dark theme switch.

## Caveats

- **Not safety guidance.** Presets are illustrative starting points; scores are preferences, not probabilities; forecasts are uncertain.
- Open-Meteo's free API is for non-commercial use and requires attribution (CC BY 4.0). Review their terms before deploying this anywhere commercial.
- The live path was checked with real Open-Meteo responses replayed into the browser (place search, forecast URL, parsing, results), and both APIs return `access-control-allow-origin: *`. It has not been run in a browser talking to the API directly, because the development sandbox intercepts TLS.
- The single-file build cannot fetch forecasts when hosted in a sandbox that blocks network access; it works on sample data or your CSV.

## Licence

Dual-licensed `Apache-2.0 OR MIT`, matching wint. (Licence texts to be added before public release.)
