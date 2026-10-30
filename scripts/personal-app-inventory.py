#!/usr/bin/env python3
"""Verify a code-only app and write a relative-path inventory. Never reads the user profile."""
import argparse, hashlib, json, os, plistlib, stat, subprocess
from pathlib import Path
p = argparse.ArgumentParser()
p.add_argument('--app', required=True)
p.add_argument('--lock', default=str(Path(__file__).resolve().parents[1] / 'personal-release.json'))
p.add_argument('--output')
p.add_argument('--frozen-only', action='store_true')
a = p.parse_args()
app = Path(a.app).resolve(strict=True)
lock = json.loads(Path(a.lock).read_text())
def sha(file):
    h = hashlib.sha256()
    with file.open('rb') as f:
        for b in iter(lambda: f.read(1024 * 1024), b''): h.update(b)
    return h.hexdigest()
def tree(directory):
    h = hashlib.sha256()
    for f in sorted(directory.rglob('*')):
        if f.is_symlink(): raise ValueError('Unexpected link in frozen renderer')
        if f.is_file():
            h.update(str(f.relative_to(directory)).encode()); h.update(b'\0'); h.update(bytes.fromhex(sha(f)))
    return h.hexdigest()
info = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
assert info['CFBundleIdentifier'] == lock['applicationId'], 'Application identity changed'
assert sha(app / 'Contents/Info.plist') == lock['frozen']['infoPlistSha256'], 'Info.plist changed'
base = app / 'Contents/Resources/app'
assert json.loads((base / 'package.json').read_text())['main'] == 'dist/main.cjs', 'Unexpected bootstrap'
assert not (app / 'Contents/Resources/app-update.yml').exists(), 'Official automatic updates enabled'
assert not (base / 'preview-bootstrap.cjs').exists(), 'Preview bootstrap present'
assert not (base / 'native-validation-bootstrap.cjs').exists(), 'Validation bootstrap present'
if 'retainedPiSha256' in lock['frozen']:
    assert sha(base / 'resources/pi-agent-server/index.js') == lock['frozen']['retainedPiSha256'], 'Original Pi changed'
assert tree(base / 'dist/renderer') == lock['frozen']['rendererTreeSha256'], 'Frozen renderer changed'
for rel, value in lock['frozen']['files'].items(): assert sha(app / rel) == value, 'Frozen resource changed: ' + rel
components = {'mainSha256': sha(base / 'dist/main.cjs'), 'managedPiSha256': sha(base / 'resources/antigravity-pi-agent-server/index.js')}
if 'standardPiSha256' in lock['expectedBuild']:
    assert 'retainedPiSha256' not in lock['frozen'], 'Pi cannot be both frozen and rebuilt'
    components['standardPiSha256'] = sha(base / 'resources/pi-agent-server/index.js')
if not a.frozen_only: assert components == lock['expectedBuild'], 'Compiled code does not match source release lock'
subprocess.run(['/usr/bin/codesign', '--verify', '--deep', '--strict', str(app)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
entries = []
for f in sorted(app.rglob('*')):
    rel = str(f.relative_to(app))
    if f.name in {'.env', 'credentials.enc'} or f.name.endswith('.jsonl'):
        raise ValueError('Unexpected private data file in app: ' + rel)
    if f.is_symlink():
        resolved = f.resolve(strict=True)
        assert resolved == app or app in resolved.parents, 'Link escapes application: ' + rel
        entries.append({'path': rel, 'type': 'symlink', 'target': os.readlink(f)})
    elif f.is_file():
        entries.append({'path': rel, 'type': 'file', 'bytes': f.stat().st_size, 'mode': oct(stat.S_IMODE(f.stat().st_mode)), 'sha256': sha(f)})
result = {'schemaVersion': 1, 'version': lock['version'], 'applicationId': info['CFBundleIdentifier'], 'platform': lock['platform'], 'signatureVerified': True, 'frozenResourcesVerified': True, 'components': components, 'entries': entries}
if a.output:
    out = Path(a.output); out.parent.mkdir(parents=True, exist_ok=True); out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'version': lock['version'], 'files': sum(e['type'] == 'file' for e in entries), 'links': sum(e['type'] == 'symlink' for e in entries), 'signatureVerified': True, 'frozenResourcesVerified': True, **components}))
