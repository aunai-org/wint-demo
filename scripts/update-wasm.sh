#!/usr/bin/env bash
# Rebuilds the engine from a wint checkout and vendors it into ./vendor.
# Usage: scripts/update-wasm.sh [path-to-wint]   (default: ../wint)
set -euo pipefail
cd "$(dirname "$0")/.."
WINT="${1:-../wint}"

"$WINT/scripts/build-wasm.sh" "$WINT/pkg" >/dev/null
cp "$WINT/pkg/wint.js" "$WINT/pkg/wint_bg.wasm" "$WINT/pkg/wint.d.ts" vendor/
{
  echo "wint commit: $(git -C "$WINT" rev-parse HEAD)"
  echo "wint version: $(sed -n 's/^version = "\(.*\)"/\1/p' "$WINT/Cargo.toml" | head -1)"
  echo "built: $(date -u +%Y-%m-%dT%H:%MZ)"
} > vendor/VERSION
cat vendor/VERSION
