#!/usr/bin/env bash
# Assembles the static site (what a browser needs, nothing else) into ./_site for GitHub Pages.
# Every URL in the app is relative, so it works under a sub-path such as /wint-demo/.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${1:-_site}"
rm -rf "$OUT"
mkdir -p "$OUT/vendor"
cp index.html app.js style.css sample-forecast.json sample-multi-model.json LICENSE "$OUT/"
cp vendor/wint.js vendor/wint_bg.wasm "$OUT/vendor/"
touch "$OUT/.nojekyll"
echo "built $OUT:" && find "$OUT" -type f | sort
