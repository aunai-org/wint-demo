#!/usr/bin/env bash
# Copies the non-weather example data and plans from a wint checkout into ./examples.
# Titles and descriptions live in examples/index.json (kept here, edited by hand).
# Usage: scripts/sync-examples.sh [path-to-wint]   (default: ../wint)
set -euo pipefail
cd "$(dirname "$0")/.."
WINT="${1:-../wint}"
for dir in "$WINT"/examples/domains/*/; do
  name="$(basename "$dir")"
  mkdir -p "examples/$name"
  cp "$dir/plan.json" "$dir/series.csv" "examples/$name/"
  echo "synced $name"
done
