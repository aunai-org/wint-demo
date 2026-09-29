# wint-demo

A browser demo for [wint](https://github.com/aunai-org/wint), the deterministic environmental operability engine. Pick a place and an activity; it finds the time windows that stay inside your limits and shows the evidence for each decision.

There is no backend and no build step. The engine runs in your browser as WebAssembly, and forecasts come straight from [Open-Meteo](https://open-meteo.com/).

## Run it

```sh
npm run serve        # then open http://localhost:8765
```

(Any static file server works; the page must be served over http, not opened as a file, so the browser can load the `.wasm`.)

Try **Use synthetic sample data** first: it needs no network. **Find windows (live forecast)** calls Open-Meteo from your browser; **Upload CSV** takes your own hourly data (see the [CSV format](https://github.com/aunai-org/wint/blob/main/src/adapters/csv.rs)).

## How it fits together

| File | Role |
|---|---|
| `vendor/` | The engine, built from wint (`wint.js`, `wint_bg.wasm`, `wint.d.ts`). `vendor/VERSION` records the exact wint commit. |
| `app.js` | UI logic. Calls the engine's JSON-in/JSON-out functions; no weather logic lives here. |
| `sample-forecast.json` | Synthetic hourly data in Open-Meteo's response shape, for offline use. Not a real forecast. |

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

`npm test` covers loading, results, the evidence panels, plan editing, CSV upload, graceful network failures and the mobile layout, using the synthetic sample and mocked API errors. `npm run test:single` builds the single-file page and checks it under a strict no-network CSP (with WASM allowed), including the light/dark theme switch.

## Caveats

- **Not safety guidance.** Presets are illustrative starting points; scores are preferences, not probabilities; forecasts are uncertain.
- Open-Meteo's free API is for non-commercial use and requires attribution (CC BY 4.0). Review their terms before deploying this anywhere commercial.
- The live path was checked with real Open-Meteo responses replayed into the browser (place search, forecast URL, parsing, results), and both APIs return `access-control-allow-origin: *`. It has not been run in a browser talking to the API directly, because the development sandbox intercepts TLS.
- The single-file build cannot fetch forecasts when hosted in a sandbox that blocks network access; it works on sample data or your CSV.

## Licence

Dual-licensed `Apache-2.0 OR MIT`, matching wint. (Licence texts to be added before public release.)
