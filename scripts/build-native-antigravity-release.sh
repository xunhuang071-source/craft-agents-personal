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
# Input and output use different immutable locks during a component upgrade.
BASE_LOCK="${CRAFT_BASELINE_LOCK:-$(ROOT="$ROOT" python3 - <<'PY'
import json, os
from pathlib import Path
root=Path(os.environ['ROOT'])
lock=json.loads((root/'personal-release.json').read_text())
print(root/lock.get('piSdkUpgrade', {}).get('baselineLock', 'personal-release.json'))
PY
)}"
python3 "$ROOT/scripts/personal-app-inventory.py" --app "$BASELINE" --lock "$BASE_LOCK" --output "$OUT/baseline-files.json"
node "$ROOT/scripts/personal-build.mjs" --engine-root "$ENGINE" --bun "$BUN" --verify-current
mkdir -p "$OUT"
/usr/bin/ditto "$BASELINE" "$APP"
cp "$ROOT/.personal-build/main.cjs" "$APP/Contents/Resources/app/dist/main.cjs"
if ROOT="$ROOT" python3 - <<'PY'
import json, os, sys
from pathlib import Path
lock=json.loads((Path(os.environ['ROOT'])/'personal-release.json').read_text())
sys.exit(0 if 'standardPiSha256' in lock['expectedBuild'] else 1)
PY
then
  cp "$ROOT/.personal-build/standard-pi.js" "$APP/Contents/Resources/app/resources/pi-agent-server/index.js"
fi
mkdir -p "$APP/Contents/Resources/app/resources/antigravity-pi-agent-server"
cp "$ROOT/.personal-build/managed-pi.js" "$APP/Contents/Resources/app/resources/antigravity-pi-agent-server/index.js"
cp "$BASELINE/Contents/Resources/app/resources/pi-agent-server/photon_rs_bg.wasm" "$APP/Contents/Resources/app/resources/antigravity-pi-agent-server/photon_rs_bg.wasm"
/usr/bin/codesign --force --deep --sign - --preserve-metadata=entitlements,requirements,flags,runtime "$APP"
python3 "$ROOT/scripts/personal-app-inventory.py" --app "$APP" --output "$OUT/application-files.json"
python3 "$ROOT/scripts/personal-audit-candidate.py" --scope pi-sdk --base-app "$BASELINE" --app "$APP" \
  --baseline-inventory "$OUT/baseline-files.json" --inventory "$OUT/application-files.json" --out "$OUT"
echo 'Candidate signed and verified. Not installed or launched; existing user data untouched.'
