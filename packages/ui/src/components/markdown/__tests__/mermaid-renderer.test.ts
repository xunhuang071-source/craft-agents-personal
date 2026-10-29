import { describe, expect, it } from 'bun:test'
import { PeleError, render } from 'pele'
import { renderMermaidDiagram } from '../mermaid-renderer'

const diagrams = [
  ['flowchart', 'flowchart LR\n A[开始] -->|继续| B[完成]'],
  ['sequence', 'sequenceDiagram\n participant A as 用户\n participant B as 助手\n A->>B: 请求\n B-->>A: 响应'],
  ['state', 'stateDiagram-v2\n [*] --> Idle\n Idle --> Active: 启动\n Active --> [*]'],
  ['class', 'classDiagram\n class Animal {\n +String name\n +speak()\n }\n Animal <|-- Cat'],
  ['er', 'erDiagram\n CUSTOMER ||--o{ ORDER : places\n CUSTOMER {\n string name\n }'],
  ['gantt', 'gantt\n dateFormat YYYY-MM-DD\n title 计划\n section 开发\n 编码 :a1, 2026-10-01, 3d\n 测试 :after a1, 2d'],
  ['pie', 'pie title 份额\n "甲" : 40\n "乙" : 60'],
  ['mindmap', 'mindmap\n root((中心))\n   分支甲\n   分支乙'],
  ['xychart', 'xychart-beta\n title "收入"\n x-axis [Jan, Feb, Mar]\n y-axis "元" 0 --> 100\n bar [25, 45, 80]\n line [20, 50, 70]'],
] as const

const invalidDiagrams = [
  '',
  'notADiagram\n A --> B',
  'flowchart LR\n A[Unclosed',
  'sequenceDiagram\n A->>B',
  'classDiagram\n class A {',
  'erDiagram\n A ||--o{',
  'pie\n "Invalid" : nope',
] as const

function labels(svg: string) {
  return Array.from(svg.matchAll(/<text\b[^>]*data-ca-mermaid-label="(\d+)"[^>]*>([\s\S]*?)<\/text>/g), match => ({
    ordinal: Number(match[1]),
    contents: match[2],
  }))
}

function expectLimit(source: string) {
  try {
    renderMermaidDiagram(source, 'limits')
    throw new Error('Expected a Pele size limit error')
  } catch (error) {
    expect(error).toBeInstanceOf(PeleError)
    expect((error as PeleError).code).toBe('limit')
  }
}

describe('renderMermaidDiagram', () => {
  for (const [type, source] of diagrams) {
    it(`renders ${type} with natural pixel dimensions and app theme`, () => {
      const result = renderMermaidDiagram(source, `inline-${type}`)
      expect(Object.keys(result).sort()).toEqual(['height', 'svg', 'type', 'width'])
      expect(result.type).toBe(type)
      expect(Number.isFinite(result.width) && result.width > 0).toBe(true)
      expect(Number.isFinite(result.height) && result.height > 0).toBe(true)
      const root = result.svg.match(/^<svg\b[^>]*>/)![0]
      expect(root).toMatch(/\bwidth="\d+(?:\.\d+)?"/)
      expect(root).toMatch(/\bheight="\d+(?:\.\d+)?"/)
      expect(root).not.toContain('max-width:100%')
      expect(root).not.toContain('height:auto')
      expect(root).toContain('--pele-bg:var(--background)')
      expect(root).toContain('--pele-fg:var(--foreground)')
      expect(root).toContain('--pele-font:')
      expect(root).toContain('PingFang SC')
      expect(root).toContain('Microsoft YaHei')
      expect(labels(result.svg).map(label => label.ordinal)).toEqual(labels(result.svg).map((_, index) => index))
      expect(labels(result.svg).length).toBeGreaterThan(0)
    })
  }

  it('binds all palette colors to app CSS variables without resolving the current theme', () => {
    const { svg } = renderMermaidDiagram('pie\n "A": 1\n "B": 2', 'palette')
    for (const [pele, app] of [
      ['muted', 'muted-foreground'], ['line', 'foreground-30'],
      ['surface', 'foreground-3'], ['surface-alt', 'foreground-5'],
      ['border', 'foreground-20'], ['accent', 'accent'],
      ['critical', 'destructive'], ['error', 'destructive'],
    ]) expect(svg).toContain(`--pele-${pele}:var(--${app})`)
    for (let index = 1; index <= 8; index++) expect(svg).toContain(`--pele-series-${index}:`)
    expect(svg).toContain('--pele-font-mono:')
    expect(svg).toContain('Noto Sans CJK SC')
  })

  it('preserves a horizontal source direction instead of applying responsive direction changes', () => {
    const { width, height } = renderMermaidDiagram('flowchart LR\n A --> B --> C --> D --> E --> F --> G --> H', 'horizontal')
    expect(width).toBeGreaterThan(height * 5)
  })

  it('keeps frontmatter, init directives and comments after leading whitespace/BOM', () => {
    const source = '\uFEFF\n---\ntitle: 配置标题\nconfig:\n  flowchart:\n    nodeSpacing: 100\n---\n%% comment\n%%{init: {"flowchart": {"rankSpacing": 150}}}%%\nflowchart LR\n A[甲]-->B[乙]'
    const result = renderMermaidDiagram(source, 'configured')
    const plain = renderMermaidDiagram('flowchart LR\n A[甲]-->B[乙]', 'plain')
    expect(result.type).toBe('flowchart')
    expect(result.svg).toContain('配置标题')
    expect(result.width).toBeGreaterThan(plain.width)
  })

  it('retains independent SVG IDs while assigning the same label ordinals to inline and overlay copies', () => {
    const source = 'flowchart LR\n accTitle: 可访问标题\n accDescr: 可访问描述\n A[重复] -->|标签| B[重复]'
    const inline = renderMermaidDiagram(source, 'inline-safe_1')
    const overlay = renderMermaidDiagram(source, 'overlay-safe_2')
    expect(inline.svg).toContain('id="inline-safe_1-title"')
    expect(inline.svg).toContain('id="inline-safe_1-desc"')
    expect(overlay.svg).toContain('id="overlay-safe_2-title"')
    expect(overlay.svg).not.toContain('inline-safe_1')
    expect(labels(inline.svg)).toEqual(labels(overlay.svg))
    expect(labels(inline.svg).map(label => label.contents)).toEqual(['标签', '重复', '重复'])
    expect(inline.svg).toContain('data-id="A"')
    expect(inline.svg).toContain('data-id="B"')
    expect(inline.svg).not.toMatch(/<(?:title|desc)\b[^>]*data-ca-mermaid-label=/)
  })

  it('does not reorder or rewrite label text or tspans', () => {
    const source = '---\ntitle: 可见标题\n---\nflowchart LR\n A["第一行<br/>第二行"] -->|连线| B["**粗体**"]'
    const { svg } = renderMermaidDiagram(source, 'multiline')
    const original = render(source, { responsive: false, autoDirection: false }).svg
    const originalText = Array.from(original.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g), match => match[1])
    expect(labels(svg).map(label => label.contents)).toEqual(originalText)
    expect(labels(svg).find(label => label.contents?.includes('第一行'))?.contents).toContain('第二行')
  })

  for (const source of invalidDiagrams) {
    it(`rejects invalid syntax: ${source.split('\n')[0] || '(empty)'}`, () => {
      expect(() => renderMermaidDiagram(source, 'invalid')).toThrow(PeleError)
    })
  }

  for (const prefix of ['', 'space here', 'with.dot', 'with:colon', '中文', '" onload="alert(1)', '<svg>']) {
    it(`rejects an unsafe or empty idPrefix: ${JSON.stringify(prefix)}`, () => {
      expect(() => renderMermaidDiagram('flowchart LR\n A --> B', prefix)).toThrow('idPrefix')
    })
  }

  it('disables external/relative links and click callbacks, even if source configuration requests them', () => {
    const source = [
      '---', 'config:', '  securityLevel: loose', '  links: true', '---',
      'flowchart LR', ' A[甲] --> B[乙] --> C[丙] --> D[丁]',
      ' click A "https://example.invalid/path" "外链"',
      ' click B "./relative" "相对链接"',
      ' click C "javascript:alert(1)"',
      ' click D call callback() "回调"',
    ].join('\n')
    const { svg } = renderMermaidDiagram(source, 'no-links')
    expect(svg).not.toMatch(/<a\b|\b(?:xlink:)?href=|\son[a-z]+\s*=|<script\b/i)
    expect(svg).not.toContain('https://example.invalid')
    expect(svg).not.toContain('javascript:')
    expect(svg).not.toContain('callback()')
  })

  it('does not emit network or data images, even if source configuration requests them', () => {
    const source = [
      '---', 'config:', '  images: true', '---',
      'flowchart LR',
      ' A@{ img: "https://example.invalid/image.png", label: "图片", h: 60, w: 60 } --> B',
      ' C@{ img: "data:image/svg+xml,test", label: "数据图片", h: 60, w: 60 }',
    ].join('\n')
    const { svg } = renderMermaidDiagram(source, 'no-images')
    expect(svg).not.toMatch(/<image\b|<img\b|<foreignObject\b|\b(?:xlink:)?href=/i)
    expect(svg).not.toContain('https://example.invalid')
    expect(svg).not.toContain('data:image')
    expect(svg).toContain('图片')
  })

  it('does not promote label HTML into scripts, event handlers or foreign objects', () => {
    const { svg } = renderMermaidDiagram('flowchart LR\n A["<script>alert(1)</script>"] --> B["<img src=x onerror=alert(1)>"]', 'no-html')
    expect(svg).not.toMatch(/<script\b|<img\b|<foreignObject\b|\son[a-z]+\s*=/i)
  })

  it('enforces the original source length limit before trimming', () => {
    expectLimit(' '.repeat(50_000) + 'flowchart LR\n A-->B')
  })

  it('enforces the flowchart edge limit', () => {
    expectLimit('flowchart LR\n' + 'A-->B\n'.repeat(5_001))
  })

  it('enforces the SVG output limit for a source below 50,000 characters', () => {
    const source = 'mindmap\n root\n' + '  a\n'.repeat(12_000)
    expect(source.length).toBeLessThan(50_000)
    expectLimit(source)
  })
})
