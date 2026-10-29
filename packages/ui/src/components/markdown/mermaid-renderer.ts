import { PeleError, render } from 'pele'

export interface MermaidDiagramRenderResult {
  svg: string
  width: number
  height: number
  type: string
}

// Keep this policy in sync with session-tools-core/handlers/mermaid-validate.ts.
const SOURCE_LIMIT = 50_000
const OUTPUT_LIMIT = 4_000_000
const MAX_EDGES = 5_000
const FONT_FAMILY = 'system-ui, -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif'
const FONT_FAMILY_MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", monospace'

// Variables, rather than resolved colors, let the same SVG follow app theme
// changes. Fonts match the strings passed to Pele's text measurer.
const THEME = [
  '--pele-bg:var(--background)',
  '--pele-fg:var(--foreground)',
  '--pele-muted:var(--muted-foreground)',
  '--pele-line:var(--foreground-30)',
  '--pele-surface:var(--foreground-3)',
  '--pele-surface-alt:var(--foreground-5)',
  '--pele-border:var(--foreground-20)',
  '--pele-accent:var(--accent)',
  '--pele-critical:var(--destructive)',
  '--pele-error:var(--destructive)',
  '--pele-series-1:var(--accent)',
  '--pele-series-2:var(--info)',
  '--pele-series-3:var(--success)',
  '--pele-series-4:var(--destructive)',
  '--pele-series-5:color-mix(in oklch,var(--success) 60%,var(--accent))',
  '--pele-series-6:color-mix(in oklch,var(--info) 70%,var(--success))',
  '--pele-series-7:color-mix(in oklch,var(--accent) 65%,var(--destructive))',
  '--pele-series-8:var(--foreground-60)',
  `--pele-font:${FONT_FAMILY}`,
  `--pele-font-mono:${FONT_FAMILY_MONO}`,
].join(';') + ';'

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * Label Pele's visible text elements in SVG document order, not visual or source
 * order. The ordinal is independent of idPrefix, so duplicate labels map between
 * inline and overlay renders. Never rewrite text/tspan contents or source data-id.
 * This tokenizer only receives trusted Pele output (no icon/math resolvers).
 */
function markLabels(svg: string): string {
  const excluded = new Set(['defs', 'style', 'title', 'desc', 'metadata'])
  const stack: boolean[] = []
  let hidden = false
  let ordinal = 0
  return svg.replace(/<\/?([a-z][\w:-]*)\b[^>]*>/gi, (tag: string, name: string) => {
    if (tag.startsWith('</')) {
      hidden = stack.pop() ?? false
      return tag
    }
    const parentHidden = hidden
    hidden = hidden || excluded.has(name.toLowerCase())
    const marked = name.toLowerCase() === 'text' && !hidden
      ? tag.replace(/^<text\b/i, `<text data-ca-mermaid-label="${ordinal++}"`)
      : tag
    if (tag.endsWith('/>')) hidden = parentHidden
    else stack.push(parentHidden)
    return marked
  })
}

/**
 * Render once at natural pixel dimensions. The caller owns zoom, navigation and
 * a unique, safe idPrefix for each displayed copy. Do not pass author options.
 *
 * Pele understands frontmatter, comments and init directives. Only remove leading
 * whitespace/BOM; the legacy normalizeMermaidSource drops valid configuration.
 * SVG style/title/desc/defs/metadata must be excluded from annotation text.
 */
export function renderMermaidDiagram(source: string, idPrefix: string): MermaidDiagramRenderResult {
  if (!/^[A-Za-z0-9_-]+$/.test(idPrefix)) {
    throw new Error('Mermaid idPrefix must be non-empty and contain only letters, digits, hyphens and underscores')
  }
  // Check before trimming so whitespace cannot bypass the source limit.
  if (source.length > SOURCE_LIMIT) {
    throw new PeleError(`Diagram source is longer than the limit of ${SOURCE_LIMIT} characters.`, 'limit')
  }
  const result = render(source.trimStart(), {
    idPrefix,
    responsive: false,
    autoDirection: false,
    fontFamily: FONT_FAMILY,
    fontFamilyMono: FONT_FAMILY_MONO,
    links: false,
    images: false,
    limit: SOURCE_LIMIT,
    outputLimit: OUTPUT_LIMIT,
    maxEdges: MAX_EDGES,
  })
  // Pele emits a root style attribute for all diagram types. Add fixed app
  // bindings there; no global CSS or DOM is required, including in exported SVG.
  const themed = result.svg.replace(/^(<svg\b[^>]*\sstyle=")/, `$1${escapeAttribute(THEME)}`)
  const svg = markLabels(themed)
  if (svg.length > OUTPUT_LIMIT) {
    throw new PeleError(`Diagram output is longer than the limit of ${OUTPUT_LIMIT} characters.`, 'limit')
  }
  return { svg, width: result.width, height: result.height, type: result.type }
}
