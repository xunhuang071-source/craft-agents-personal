import { detectType } from 'pele'

/** Remove Mermaid YAML frontmatter (`--- ... ---`) from the start of a diagram. */
export function stripMermaidFrontmatter(code: string): string {
  const withoutBom = code.replace(/^\uFEFF/, '')
  const leadingWhitespace = withoutBom.match(/^\s*/)?.[0] ?? ''
  const candidate = withoutBom.slice(leadingWhitespace.length)
  const lines = candidate.split(/\r?\n/)

  if (lines[0]?.trim() !== '---') return code

  const endIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---')
  if (endIndex === -1) return code

  return lines.slice(endIndex + 1).join('\n').trimStart()
}

/**
 * Normalize Mermaid before handing it to the native renderer.
 * Frontmatter is metadata, and leading comments/directives should not control
 * diagram-type detection for renderers that route by the first meaningful line.
 */
export function normalizeMermaidSource(code: string): string {
  const lines = stripMermaidFrontmatter(code).split(/\r?\n/)
  while (lines.length > 0) {
    const first = lines[0]?.trim() ?? ''
    if (first.length === 0 || first.startsWith('%%')) {
      lines.shift()
      continue
    }
    break
  }
  return lines.join('\n').trimStart()
}

export function getFirstMermaidDiagramLine(code: string): string | null {
  const first = normalizeMermaidSource(code).split(/\r?\n/)[0]?.trim()
  return first && first.length > 0 ? first : null
}

export function looksLikeMermaidSource(code: string): boolean {
  if (code.length > 50_000) return false
  // Use the same engine's type detector rather than maintaining a second,
  // incomplete list of Mermaid prefixes for paste and file import.
  try { return detectType(code.trimStart()) != null } catch { return false }
}
