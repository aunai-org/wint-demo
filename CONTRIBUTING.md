# Contributing

Bug reports, ideas and fixes are welcome. For problems with the engine itself (a wrong window, a crash), open the issue in [wint](https://github.com/aunai-org/wint) instead; this repository is only the browser demo.

## Working on the demo

```sh
npm install
npx playwright install chromium
npm run serve                  # http://localhost:8765, in one terminal
npm test                       # two browser test suites, in another
npm run test:single            # builds the single-file page and tests it with no network
```

Run all three before opening a pull request. The tests use the bundled sample data and mocked network responses, so they need no internet.

A few notes:

- **The page only displays.** Every word, rounding and color on screen is decided in `app.js`; the engine returns data. Keep it that way.
- **The display rules are written down** in the README ("How to read the display"). If you change a color rule, change `colorOf()`, the on-screen key, the README table and the tests together.
- **The engine in `vendor/` is built from wint.** Update it with `scripts/update-wasm.sh ../wint` rather than editing it. The example data in `examples/` is copied from wint with `scripts/sync-examples.sh`.

By contributing you agree your work is released under the [MIT licence](LICENSE). Please follow the [code of conduct](CODE_OF_CONDUCT.md).
