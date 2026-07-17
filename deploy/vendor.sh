#!/usr/bin/env bash
# Refresh the vendored orbital-volume from the sibling checkout (the deploy
# fallback from devlog 20260716 §3: vendor now, publish-to-npm later). Run after
# editing ../orbital-volume, then commit — the deployed site serves vendor/.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/../orbital-volume"

[ -f "$SRC/volume.js" ] || { echo "no sibling orbital-volume checkout at $SRC"; exit 1; }

mkdir -p "$ROOT/vendor/orbital-volume"
rsync -a --delete \
  --include='volume.js' --include='volume_query.js' --include='package.json' \
  --include='README.md' --include='handlers/***' --exclude='*' \
  "$SRC/" "$ROOT/vendor/orbital-volume/"

echo "✓ vendored orbital-volume $(node -p "require('$SRC/package.json').version") → vendor/orbital-volume/"
