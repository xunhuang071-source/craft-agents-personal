#!/bin/bash
# Code-only ZIP. Preserve executable bits/symlinks, not Finder/resource-fork metadata.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${1:?Usage: personal-package.sh verified-app output.zip}"
ZIP="${2:?Usage: personal-package.sh verified-app output.zip [component-lock.json]}"
LOCK="${3:-$ROOT/personal-release.json}"
case "$ZIP" in *.zip) ;; *) echo 'Output must be a .zip file'; exit 1 ;; esac
[ ! -e "$ZIP" ] || { echo 'Existing archive retained; choose a new path'; exit 1; }
python3 "$ROOT/scripts/personal-app-inventory.py" --app "$APP" --lock "$LOCK"
mkdir -p "$(dirname "$ZIP")"
/usr/bin/ditto --norsrc --noextattr --noacl -c -k --keepParent "$APP" "$ZIP"
/usr/bin/unzip -tqq "$ZIP"
echo 'ZIP integrity passed. Before publication, extract on local APFS and recheck inventory/signature.'
