#!/usr/bin/env python3
"""Real Chromium clicks on production Markdown; OS shell is deliberately recorded, not launched."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

out = Path(__file__).resolve().parents[2] / '.personal-build/finder-links'
out.mkdir(parents=True, exist_ok=True)
cases = [
    ('icloud', 'showInFolder', '/Users/test/Mobile Documents/com~apple~CloudDocs/工作/报告 final.pdf'),
    ('html-image', 'showInFolder', '/Users/test/com~apple~CloudDocs/图片.png'),
    ('folder', 'showInFolder', '/Users/test/输出目录/'),
    ('line', 'showInFolder', '/Users/test/com~apple~CloudDocs/源码.md:12:3'),
    ('unknown', 'showInFolder', '/Users/test/成果.custom'),
    ('file-url', 'showInFolder', '/Users/test/报告.pdf'),
    ('website', 'openUrl', 'https://example.com/report.pdf'),
    ('unsafe', 'openUrl', 'javascript:alert(1)'),
]
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.route('**/*', lambda route: route.continue_() if route.request.url.startswith('http://127.0.0.1:5196') else route.abort())
    page.goto('http://127.0.0.1:5196/finder-links.html', wait_until='networkidle')
    for i, (label, action, path) in enumerate(cases):
        link = page.get_by_text(label, exact=True)
        expect(link).to_have_count(1)
        if label in ('unsafe', 'file-url'):
            assert link.get_attribute('href') is None, 'Unsafe/file schemes must stay out of DOM href'
        link.click()
        page.wait_for_function('(count) => window.finderFixture.calls.length === count', arg=i + 1)
        call = page.evaluate('window.finderFixture.calls.at(-1)')
        assert call == {'action': action, 'path': path}, (label, call)
    assert not errors, errors
    page.screenshot(path=str(out / 'click-regressions.png'))
    result = {'passed': len(cases), 'failed': 0, 'browserErrors': errors,
              'boundary': 'Production Markdown and real clicks; shell callback recorded. Real RPC handler covered by isolated Bun tests.',
              'calls': page.evaluate('window.finderFixture.calls')}
    (out / 'click-results.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(result, ensure_ascii=False, indent=2))
    browser.close()
