#!/usr/bin/env python3
"""Local-only real Chromium regression. Start the fixture Vite server first."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

OUT = Path(__file__).resolve().parents[2] / '.personal-build/pele/e2e'
OUT.mkdir(parents=True, exist_ok=True)
results = []

def drag_text(page, locator):
    locator.scroll_into_view_if_needed()
    r = locator.bounding_box()
    assert r and r['width'] > 10
    page.mouse.move(r['x'] + 1, r['y'] + r['height'] / 2)
    page.mouse.down()
    page.mouse.move(r['x'] + r['width'] - 1, r['y'] + r['height'] / 2, steps=18)
    page.mouse.up()
    page.wait_for_timeout(550)
    selected = page.evaluate('Boolean(window.getSelection()?.toString().trim())')
    if not selected:
        page.screenshot(path=str(OUT / 'selection-failure.png'))
        print('EMPTY',r,locator.evaluate('(el)=>({text:el.textContent,select:getComputedStyle(el).userSelect,html:document.elementFromPoint(el.getBoundingClientRect().x+3,el.getBoundingClientRect().y+el.getBoundingClientRect().height/2)?.outerHTML})'),flush=True)
    assert selected, 'Browser must actually select label text'
    island = page.locator('[data-ca-island-visible=true]')
    expect(island).to_have_count(1)
    expect(island).to_be_visible()
    # Visibility alone is insufficient: the menu must be above masks and active dialogs.
    assert island.evaluate('el => {const r=el.getBoundingClientRect(); const top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return !!top&&el.contains(top)}'), 'Menu must be hit-testable'
    return island

def save_note(page, island, note):
    island.get_by_role('button').first.click()
    textarea = page.locator('[data-ca-island-visible=true] textarea:not([aria-hidden=true])')
    expect(textarea).to_be_visible()
    textarea.fill(note)
    page.locator('[data-ca-island-visible=true]').get_by_role('button', name='Save', exact=True).click()
    page.wait_for_timeout(650)
    a = page.evaluate('window.fixture.annotations.at(-1)')
    assert a['target']['source']['messageId'] == 'fixture-message'
    assert any(b.get('text') == note for b in a['body'])
    return a

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    for mode, width, host in [(m, w, h) for m in ['standalone', 'app'] for w in [1000, 1440] for h in ['document', 'turn']]:
        page = browser.new_page(viewport={'width': width, 'height': 1000})
        print('RUN',mode,width,host,flush=True)
        errors = []
        page.context.grant_permissions(['clipboard-read', 'clipboard-write'])
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.route('**/*', lambda route: route.continue_() if route.request.url.startswith('http://127.0.0.1:5196') else route.abort())
        page.goto(f'http://127.0.0.1:5196/?bridge={mode}&host={host}', wait_until='networkidle')
        expect(page.locator('#inline-document svg.pele')).to_have_count(2)
        ids = page.locator('svg [id], svg[id]').evaluate_all('nodes => nodes.map(n=>n.id)')
        assert len(ids) == len(set(ids)), 'SVG IDs must be unique'
        # Inline text selection must not trigger click-to-expand.
        island = drag_text(page, page.locator('#inline-document svg text').filter(has_text='中文开始').first)
        a = save_note(page, island, 'inline note')
        assert a['meta']['mermaid']['labelIndex'] >= 0
        assert page.locator('[data-ca-diagram-viewport]').count() == 0
        expect(page.locator('#inline-document [data-ca-annotation-index]')).to_have_count(1)
        # Full MD -> graph expansion -> real text drag -> comment, no closing required.
        if host == 'turn':
            page.locator('#inline-document button[title="View Fullscreen"]').first.click()
        else:
            page.locator('#open-document').click()
        page.wait_for_timeout(400)
        doc = page.locator('[data-ca-overlay-surface]').last
        doc.locator('[data-ca-block-type=mermaid]').first.locator('button').first.click()
        page.wait_for_timeout(400)
        viewport = page.locator('[data-ca-diagram-viewport]')
        expect(viewport).to_be_visible()
        labels = viewport.locator('svg text').filter(has_text='重复标签')
        island = drag_text(page, labels.nth(1))
        a = save_note(page, island, f'expanded note {width}')
        expect(viewport.locator('[data-ca-annotation-index]')).to_have_count(2)
        # Shared IDs in inline and expanded SVG must not collide.
        ids = page.locator('svg [id], svg[id]').evaluate_all('nodes => nodes.map(n=>n.id)')
        assert len(ids) == len(set(ids))
        # One Escape closes the comment editor before the diagram or underlying MD.
        viewport.locator('[data-ca-annotation-index]').last.click()
        page.wait_for_timeout(500)
        page.keyboard.press('Escape')
        page.wait_for_timeout(550)
        expect(viewport).to_have_count(1)
        assert page.locator('[data-ca-overlay-surface]').count() == 2
        # Zoom changes one transform, and annotation geometry follows.
        before = viewport.locator('[data-ca-mermaid-svg]').get_attribute('style')
        page.locator('[data-ca-overlay-surface]').last.locator('button[title^="Zoom in"]').click()
        page.wait_for_timeout(500)
        after = viewport.locator('[data-ca-mermaid-svg]').get_attribute('style')
        assert before != after
        expect(viewport.locator('[data-ca-annotation-index]')).to_have_count(2)
        # Pan blank space, then wheel zoom: one owner, no accidental selection popup.
        r = viewport.bounding_box()
        transform_before = viewport.locator('[data-ca-mermaid-svg]').get_attribute('style')
        page.mouse.move(r['x'] + 40, r['y'] + 80); page.mouse.down()
        page.mouse.move(r['x'] + 65, r['y'] + 100, steps=12); page.mouse.up()
        page.wait_for_timeout(350)
        assert viewport.locator('[data-ca-mermaid-svg]').get_attribute('style') != transform_before
        expect(page.locator('[data-ca-island-visible=true]')).to_have_count(0)
        page.mouse.wheel(0, -25); page.wait_for_timeout(350)
        # Highlight geometry must follow the transformed SVG, not just remain present.
        target = viewport.locator('svg text').nth(a['meta']['mermaid']['labelIndex']).bounding_box()
        highlight = viewport.locator('[data-ca-annotation-overlay] > div').last.bounding_box()
        assert target and highlight and abs((highlight['x'] + 4) - target['x']) < 2 and abs((highlight['y'] + 1) - target['y']) < 2
        page.locator('[data-ca-overlay-surface]').last.locator('button[title="Copy code"]').click()
        assert 'flowchart LR' in page.evaluate('navigator.clipboard.readText()')
        # Cancel an unsaved comment without closing either dialog or persisting a note.
        island = drag_text(page, viewport.locator('svg text').filter(has_text='中文结束').first)
        island.get_by_role('button').first.click()
        page.locator('[data-ca-island-visible=true] textarea:not([aria-hidden=true])').fill('unsaved draft')
        page.keyboard.press('Escape'); page.wait_for_timeout(500)
        expect(viewport).to_have_count(1)
        page.keyboard.press('Escape'); page.wait_for_timeout(500)
        expect(viewport).to_have_count(1)
        expect(page.locator('[data-ca-island-visible=true]')).to_have_count(0)
        assert page.evaluate('window.fixture.annotations.length') == 2
        page.screenshot(path=str(OUT / f'expanded-{mode}-{host}-{width}.png'))
        # Closing the graph may not produce a delayed popup in the MD or inline view.
        page.keyboard.press('Escape')
        page.wait_for_timeout(600)
        expect(page.locator('[data-ca-diagram-viewport]')).to_have_count(0)
        expect(page.locator('[data-ca-island-visible=true]')).to_have_count(0)
        assert page.locator('[data-ca-overlay-surface]').count() == 1, f'{mode}/{host}/{width}: remaining={page.locator("[data-ca-overlay-surface]").count()}'
        expect(page.locator('[data-ca-overlay-surface] [data-ca-annotation-index]')).to_have_count(2)
        page.keyboard.press('Escape')
        page.wait_for_timeout(500)
        expect(page.locator('[data-ca-overlay-surface]')).to_have_count(0)
        expect(page.locator('[data-ca-island-visible=true]')).to_have_count(0)
        assert not page.evaluate('window.getSelection()?.toString()')
        # A second diagram opened straight from the message uses the same host.
        page.locator('#inline-document [data-ca-block-type=mermaid]').nth(1).locator('button').first.click()
        page.wait_for_timeout(400)
        sequence = page.locator('[data-ca-diagram-viewport]')
        island = drag_text(page, sequence.locator('svg text').filter(has_text='用户').last)
        sequence_annotation = save_note(page, island, 'sequence actor note')
        assert sequence_annotation['meta']['mermaid']['blockPath'] != a['meta']['mermaid']['blockPath']
        page.keyboard.press('Escape'); page.wait_for_timeout(500)
        expect(page.locator('[data-ca-island-visible=true]')).to_have_count(0)
        expect(page.locator('#inline-document [data-ca-annotation-index]')).to_have_count(3)
        # Runtime legacy-offset recovery: an old shifted position must resolve its quote.
        legacy = page.evaluate('''() => {
          const root=document.querySelector('#inline-document [data-ca-annotation-root]');
          const a=structuredClone(window.fixture.annotations[0]); delete a.meta.mermaid;
          const quote=a.target.selectors.find(s=>s.type==='text-quote');
          const pos=a.target.selectors.find(s=>s.type==='text-position'); pos.start=0;pos.end=quote.exact.length;
          const r=window.fixture.resolve(root,[a]); return {method:r.resolved[0]?.method,count:r.resolved.length};
        }''')
        assert legacy == {'method': 'text-quote', 'count': 1}
        page.locator('#toggle-theme').click()
        page.screenshot(path=str(OUT / f'dark-{mode}-{host}-{width}.png'))
        assert not errors, errors
        results.append({'mode':mode, 'host':host, 'width': width, 'inlineSelect': True, 'expandedSelectSave': True, 'duplicateLabelAnchor': a['meta']['mermaid']['labelIndex'], 'escapeStack': True, 'zoom': True, 'panAndWheel':True, 'copy':True, 'cancelWithoutSaving':True, 'sequenceDirectExpand':True, 'noDelayedPopup': True, 'legacyQuoteRecovery': True, 'pageErrors': errors})
        page.close()
    browser.close()
(OUT / 'results.json').write_text(json.dumps(results, ensure_ascii=False, indent=2))
print(json.dumps(results, ensure_ascii=False, indent=2))
