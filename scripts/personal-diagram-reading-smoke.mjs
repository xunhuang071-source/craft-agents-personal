#!/usr/bin/env node
/** Real UI components, isolated Electron shell, synthetic gestures; never reads a real profile. */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import http from 'node:http'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const candidate = fs.realpathSync(process.argv[2] || '')
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'craft-diagram-reading-'))
const app = path.join(fixture, 'Diagram Reading Test.app')
const renderer = path.join(candidate, 'Contents/Resources/app/dist/renderer')
const reportFile = process.argv[3] && path.resolve(process.argv[3])
function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, ...options }); let out = '', err = ''
    child.stdout?.on('data', d => out += d); child.stderr?.on('data', d => err += d)
    const timer = setTimeout(() => child.kill('SIGKILL'), 45000)
    child.on('error', reject); child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(out) : reject(Error(`${path.basename(command)}: ${code}\n${err}\n${out}`)) })
  })
}
const tests = async () => {
  let assertions = 0
  const check = (condition, label) => { if (!condition) throw Error(label); assertions++ }
  const pause = () => new Promise(resolve => setTimeout(resolve, 35))
  const wait = async selector => { for (let n = 0; n < 80; n++) { const el = document.querySelector(selector); if (el) return el; await pause() } throw Error('Missing ' + selector) }
  const viewport = kind => document.querySelector(`[data-ca-${kind}-viewport]`)
  const content = el => el.querySelector('[data-ca-mermaid-svg]') || el.querySelector('img')
  const state = el => {
    const t = content(el).style.transform
    const xy = t.match(/translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/)
    return { scale: Number(t.match(/scale\(([\d.]+)\)/)?.[1]), x: Number(xy?.[1]), y: Number(xy?.[2]) }
  }
  const wheel = (el, props) => { const r = el.getBoundingClientRect(); const e = new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: r.x + r.width / 2 + 40, clientY: r.y + r.height / 2 - 30, ...props }); el.dispatchEvent(e); return e.defaultPrevented }
  const close = async el => { el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })); await pause(); await pause() }
  await wait('#flow svg.pele')
  await pause()
  const labels = []
  for (const id of ['flow', 'vertical', 'sequence', 'wide']) {
    const svg = document.querySelector(`#${id} svg.pele`)
    check(!!svg, id + ' renders')
    const scale = svg.getBoundingClientRect().width / svg.width.baseVal.value
    const size = parseFloat(getComputedStyle(svg).fontSize) * scale
    check(size >= 11.99 && size <= 14.01, id + ' reading size')
    labels.push({ id, effectiveRootFont: size })
  }
  const flow = document.querySelector('#flow'), readingSvg = flow.querySelector('svg.pele')
  const lightColor = getComputedStyle(readingSvg).color
  document.documentElement.classList.add('dark'); await pause()
  check(getComputedStyle(readingSvg).color !== lightColor, 'SVG follows dark theme')
  check(getComputedStyle(readingSvg).color === getComputedStyle(document.body).color, 'SVG matches document foreground')
  document.documentElement.classList.remove('dark')
  const originalWidth = flow.style.width; flow.style.width = '200px'; await pause(); await pause()
  check(flow.querySelector('svg.pele').getBoundingClientRect().width > 200, 'narrow document scrolls instead of tiny text')
  flow.style.width = originalWidth; await pause(); await pause()
  for (const kind of ['diagram', 'image']) {
    for (let iteration = 0; iteration < 2; iteration++) {
      document.querySelector(kind === 'diagram' ? '#flow [role="button"]' : '#open-image').click()
      const el = await wait(`[data-ca-${kind}-viewport]`)
      await wait(kind === 'diagram' ? '[data-ca-diagram-viewport] svg' : '[data-ca-image-viewport] img')
      await pause()
      check(state(el).scale === 1, kind + ' opens at natural scale')
      check(wheel(el, { deltaY: -40, ctrlKey: true }), kind + ' captures pinch after portal mount')
      await pause()
      const zoomed = state(el)
      check(zoomed.scale > 1, kind + ' pinch zooms')
      check(Math.abs(zoomed.x - (40 - 40 * zoomed.scale)) < 0.02, kind + ' cursor x anchor')
      check(Math.abs(zoomed.y - (-30 + 30 * zoomed.scale)) < 0.02, kind + ' cursor y anchor')
      wheel(el, { deltaX: 55, deltaY: 30 }); await pause()
      const panned = state(el)
      check(Math.abs(panned.x - zoomed.x + 55) < 0.02 && Math.abs(panned.y - zoomed.y + 30) < 0.02, kind + ' two-finger pan')
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: 100, clientY: 100 }))
      await pause()
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 140, clientY: 125 })); await pause()
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); await pause()
      const dragged = state(el)
      check(Math.abs(dragged.x - panned.x - 40) < 0.02 && Math.abs(dragged.y - panned.y - 25) < 0.02, kind + ' mouse drag')
      if (kind === 'diagram') {
        const text = el.querySelector('text'), before = content(el).style.transform
        text.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: 100, clientY: 100 }))
        window.dispatchEvent(new MouseEvent('mousemove', { clientX: 170, clientY: 150 })); window.dispatchEvent(new MouseEvent('mouseup'))
        await pause(); check(content(el).style.transform === before, 'text gesture does not pan')
        const range = document.createRange(); range.selectNodeContents(text); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range)
        check(selection.toString() === text.textContent, 'diagram labels remain selectable')
        check(text.dataset.caMermaidLabel === document.querySelector('#flow text').dataset.caMermaidLabel, 'annotation ordinals stable')
        const expandedAnchor = window.captureMermaidFixture(range)
        const inlineRange = document.createRange(); inlineRange.selectNodeContents(document.querySelector('#flow text'))
        const inlineAnchor = window.captureMermaidFixture(inlineRange)
        check(!!expandedAnchor && expandedAnchor.exact === text.textContent, 'expanded annotation captures exact text')
        check(JSON.stringify(expandedAnchor) === JSON.stringify(inlineAnchor), 'inline and expanded annotation anchors match despite transforms')
        selection.removeAllRanges()
      }
      document.querySelector('button[title="Zoom in"]').click(); await pause()
      check(state(el).scale > dragged.scale, kind + ' plus button')
      wheel(el, { deltaY: -10000, ctrlKey: true }); await pause(); check(state(el).scale === 4, kind + ' upper zoom bound')
      wheel(el, { deltaY: 10000, ctrlKey: true }); await pause(); check(state(el).scale === 0.25, kind + ' lower zoom bound')
      document.querySelector('button[title="Reset zoom"]').click(); await pause(); check(state(el).scale === 1 && state(el).x === 0 && state(el).y === 0, kind + ' reset')
      await close(el)
      check(!viewport(kind), kind + ' closes')
      check(!wheel(el, { deltaY: -40, ctrlKey: true }), kind + ' detached viewport listener removed')
    }
  }
  return { assertions, labels, profileUsed: false }
}
let server
try {
  await build({ entryPoints: [path.join(root, 'scripts/fixtures/diagram-reading.tsx')], outfile: path.join(fixture, 'fixture.js'), bundle: true, platform: 'browser', format: 'esm', jsx: 'automatic', loader: { '.css': 'empty' }, alias: { react: path.join(root, 'node_modules/react'), 'react-dom': path.join(root, 'node_modules/react-dom') }, define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{ name: 'fixture-worker-url', setup(b) { b.onResolve({ filter: /\?url$/ }, a => ({ path: a.path, namespace: 'fixture-url' })); b.onLoad({ filter: /.*/, namespace: 'fixture-url' }, () => ({ contents: 'export default "/unused-worker.js"' })) } }] })
  const css = fs.readdirSync(path.join(renderer, 'assets')).filter(f => f.endsWith('.css'))
  fs.writeFileSync(path.join(fixture, 'index.html'), '<!doctype html><meta charset="UTF-8">' + css.map(f => `<link rel="stylesheet" href="/candidate/assets/${f}">`).join('') + '<style>body{margin:0;padding:30px;background:var(--background);color:var(--foreground)}button{padding:8px}</style><div id="root"></div><script type="module" src="/fixture.js"></script>')
  server = http.createServer((q, s) => {
    const url = new URL(q.url, 'http://fixture'), candidateAsset = url.pathname.startsWith('/candidate/')
    const directory = candidateAsset ? renderer : fixture
    const file = path.resolve(directory, '.' + (candidateAsset ? url.pathname.slice('/candidate'.length) : url.pathname === '/' ? '/index.html' : url.pathname))
    if (!file.startsWith(directory + path.sep)) { s.writeHead(403); s.end(); return }
    try { s.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream'); s.end(fs.readFileSync(file)) } catch { s.writeHead(404); s.end() }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}/`
  fs.cpSync(candidate, app, { recursive: true, verbatimSymlinks: true, filter: source => { const rel = path.relative(candidate, source); return rel !== 'Contents/Resources/app' && !rel.startsWith('Contents/Resources/app/') } })
  const target = path.join(app, 'Contents/Resources/app'); fs.mkdirSync(target, { recursive: true })
  fs.writeFileSync(path.join(target, 'package.json'), JSON.stringify({ name: 'diagram-reading-fixture', main: 'main.cjs' }))
  fs.writeFileSync(path.join(target, 'main.cjs'), `const{app,BrowserWindow}=require('electron');process.stdout.write('MAIN\\n');app.setPath('userData',${JSON.stringify(path.join(fixture, 'profile'))});app.setAppLogsPath(${JSON.stringify(path.join(fixture, 'logs'))});app.whenReady().then(async()=>{try{process.stdout.write('READY\\n');app.dock?.hide();const win=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{backgroundThrottling:false,contextIsolation:true,sandbox:true}});win.webContents.on('console-message',(_e,_l,m)=>process.stderr.write('UI:'+m+'\\n'));win.webContents.on('render-process-gone',(_e,d)=>process.stderr.write('RENDER:'+JSON.stringify(d)+'\\n'));const results=[];for(const width of[1280,900]){process.stdout.write('LOAD:'+width+'\\n');win.setContentSize(width,900);await win.loadURL(${JSON.stringify(url)});process.stdout.write('TEST:'+width+'\\n');results.push({width,...await win.webContents.executeJavaScript(${JSON.stringify('(' + tests.toString() + ')()')})})}process.stdout.write('RESULT:'+JSON.stringify({results,electron:process.versions.electron})+'\\n');app.exit(0)}catch(e){process.stderr.write(e.stack+'\\n');app.exit(1)}})`)
  await run(process.execPath, ['--check', path.join(target, 'main.cjs')])
  await run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', '--preserve-metadata=entitlements,requirements,flags,runtime', app])
  const output = await run(path.join(app, 'Contents/MacOS/Craft Agents'), ['--no-first-run', '--disable-gpu'], { env: { HOME: fixture, USERPROFILE: fixture, CRAFT_CONFIG_DIR: fixture, PATH: '/usr/bin:/bin', TMPDIR: os.tmpdir() } })
  const line = output.split('\n').find(line => line.startsWith('RESULT:')); if (!line) throw Error('Missing test result')
  const report = JSON.parse(line.slice(7)); if (reportFile) fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify(report))
} finally { server?.close(); fs.rmSync(fixture, { recursive: true, force: true }) }
