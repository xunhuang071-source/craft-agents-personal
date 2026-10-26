#!/bin/bash
# Assemble and sign a candidate only. Never installs, launches, backs up or migrates user data.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASELINE="${CRAFT_BASELINE_APP:-/Applications/Craft Agents.app}"
ENGINE="${CRAFT_PERSONAL_ENGINE:-$ROOT/../craft-antigravity-native-engine}"
OUT="${CRAFT_RELEASE_OUT:-$ROOT/native-artifacts/release}"
APP="$OUT/Craft Agents.app"
BUN="${CRAFT_BUN:-$BASELINE/Contents/Resources/app/vendor/bun/bun}"
export ROOT BASELINE OUT APP
python3 - <<'PY'
from pathlib import Path
import os
out=Path(os.environ['OUT']).resolve(); app=out/'Craft Agents.app'; base=Path(os.environ['BASELINE']).resolve()
assert not app.exists(), 'Existing candidate retained; choose a new output directory'
assert not str(out).startswith('/Applications'), 'Cannot stage into Applications'
assert app != base and app not in base.parents and base not in app.parents, 'Base/candidate paths overlap'
PY
python3 "$ROOT/scripts/personal-app-inventory.py" --app "$BASELINE" --frozen-only
node "$ROOT/scripts/personal-build.mjs" --engine-root "$ENGINE" --bun "$BUN" --verify-current
mkdir -p "$OUT"
/usr/bin/ditto "$BASELINE" "$APP"
cp "$ROOT/.personal-build/main.cjs" "$APP/Contents/Resources/app/dist/main.cjs"
mkdir -p "$APP/Contents/Resources/app/resources/antigravity-pi-agent-server"
cp "$ROOT/.personal-build/managed-pi.js" "$APP/Contents/Resources/app/resources/antigravity-pi-agent-server/index.js"
cp "$BASELINE/Contents/Resources/app/resources/pi-agent-server/photon_rs_bg.wasm" "$APP/Contents/Resources/app/resources/antigravity-pi-agent-server/photon_rs_bg.wasm"
/usr/bin/codesign --force --deep --sign - --preserve-metadata=entitlements,requirements,flags,runtime "$APP"
python3 "$ROOT/scripts/personal-app-inventory.py" --app "$APP" --output "$OUT/application-files.json"
echo 'Candidate signed and verified. Not installed or launched; existing user data untouched.'
