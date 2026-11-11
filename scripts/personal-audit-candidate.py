#!/usr/bin/env python3
"""Code-only candidate audit. Does not read profiles or print candidate secret values."""
import argparse, hashlib, json, re, struct
from pathlib import Path
p = argparse.ArgumentParser()
p.add_argument('--base-app', required=True)
p.add_argument('--app', required=True)
p.add_argument('--baseline-inventory', required=True)
p.add_argument('--inventory', required=True)
p.add_argument('--out', required=True)
p.add_argument('--scope', choices=['diagram', 'pi-sdk', 'finder-links', 'visual-review'], default='diagram')
a = p.parse_args()
base, app, out = Path(a.base_app), Path(a.app), Path(a.out)
old = {e['path']: e for e in json.loads(Path(a.baseline_inventory).read_text())['entries']}
new = {e['path']: e for e in json.loads(Path(a.inventory).read_text())['entries']}

def unsigned_macho(file):
    data = file.read_bytes()
    assert struct.unpack_from('<I', data)[0] == 0xfeedfacf, 'Expected arm64 Mach-O'
    ncmds = struct.unpack_from('<I', data, 16)[0]
    offset, signature = 32, None
    for _ in range(ncmds):
        command, size = struct.unpack_from('<II', data, offset)
        if command == 0x1d:
            signature = struct.unpack_from('<II', data, offset + 8)
        offset += size
    assert signature is not None, 'Missing embedded signature'
    start, size = signature
    assert start + size == len(data), 'Unexpected trailing data after signature'
    return data[:start]

executable = 'Contents/MacOS/Craft Agents'
base_code = unsigned_macho(base / executable)
candidate_code = unsigned_macho(app / executable)
assert base_code == candidate_code, 'Executable code changed beyond the embedded signature'

def allowed(rel):
    common = (rel == 'Contents/Resources/app/dist/main.cjs' or
              '_CodeSignature/' in rel or rel == executable)
    if a.scope == 'visual-review':
        return common or rel.startswith('Contents/Resources/app/dist/resources/visual-review/') or rel == 'Contents/Resources/app/dist/resources/docs/visual-review.md'
    if a.scope == 'pi-sdk':
        return common or rel in {
            'Contents/Resources/app/resources/pi-agent-server/index.js',
            'Contents/Resources/app/resources/antigravity-pi-agent-server/index.js',
        }
    return common or rel.startswith('Contents/Resources/app/dist/renderer/')

changed = sorted(k for k in old.keys() & new.keys() if old[k] != new[k])
added, removed = sorted(new.keys() - old.keys()), sorted(old.keys() - new.keys())
unexpected = [k for k in changed + added + removed if not allowed(k)]
diff = {'scope': a.scope, 'changedCommonFiles': len(changed), 'newFiles': len(added), 'removedFiles': len(removed),
        'changedPaths': changed, 'addedPaths': added, 'removedPaths': removed, 'unexpectedChanges': unexpected, 'executableCodeBeforeSignatureIdentical': True,
        'executableUnsignedSha256': hashlib.sha256(base_code).hexdigest()}
(out / 'baseline-diff.json').write_text(json.dumps(diff, ensure_ascii=False, indent=2) + '\n')

patterns = {
    'private-key': rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',
    'github-token': rb'(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{60,})',
    'google-api-key': rb'AIza[0-9A-Za-z_-]{35}',
    'provider-key': rb'sk-(?:ant-|proj-)?[A-Za-z0-9_-]{32,}',
}
# Individually reviewed, exact file+value digest. This is a documentation URL
# slug inside markdown-it-task-lists, not a provider credential. No bundle/test
# directory is exempted; changing this source map invalidates the review.
review = {
    ('Contents/Resources/app/dist/renderer/assets/index-DYOH3DVB.js.map',
     'ad5c99f913209bc8d25d41b0559dbfa108120f0669f2970abd8c4dc7365c6716',
     'provider-key',
     '943b839ecafef60eae285966eb79ba49213426741320e3866181a28b2c7b394d'):
    'markdown-it-task-lists documentation URL slug; reviewed source map sourcesContent, not a credential',
    ('Contents/Resources/app/dist/renderer/assets/index-36OwcIRx.js.map',
     '2731514f044dabae24c8415cc01fd55264040d542152885e9ea250c1356155c8',
     'provider-key',
     '943b839ecafef60eae285966eb79ba49213426741320e3866181a28b2c7b394d'):
    'Same previously reviewed markdown-it-task-lists documentation URL slug in the Finder candidate source map',
}
findings, count = [], 0
for file in app.rglob('*'):
    if not file.is_file() or file.is_symlink() or file.suffix not in {'.js', '.cjs', '.mjs', '.map', '.json', '.md', '.ts', '.tsx', '.html', '.css', '.txt'}:
        continue
    count += 1
    data = file.read_bytes()
    digest, rel = hashlib.sha256(data).hexdigest(), str(file.relative_to(app))
    for kind, pattern in patterns.items():
        for match in re.finditer(pattern, data):
            matched_digest = hashlib.sha256(match.group()).hexdigest()
            reason = review.get((rel, digest, kind, matched_digest))
            findings.append({'file': rel, 'kind': kind, 'line': data[:match.start()].count(b'\n') + 1,
                             'fileSha256': digest, 'matchSha256': matched_digest,
                             'reviewedFalsePositive': reason})
scan = {'scope': 'application text/code resources only; no user profile', 'filesScanned': count,
        'findings': findings, 'unreviewedFindings': sum(not f['reviewedFalsePositive'] for f in findings),
        'secretValuesPrinted': False}
(out / 'privacy-scan.json').write_text(json.dumps(scan, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'baselineDiff': diff, 'privacy': scan}, ensure_ascii=False, indent=2))
assert not unexpected, 'Unexpected candidate component drift'
assert scan['unreviewedFindings'] == 0, 'Review high-confidence matches locally; values are not printed'
