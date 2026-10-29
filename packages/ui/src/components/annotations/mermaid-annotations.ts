import type { AnnotationV1 } from '@craft-agent/core'
import { getCanonicalText, resolveNodeOffset, type MermaidSelectionAnchor } from './annotation-core'
import { resolveTextAnnotations, type ResolveTextAnnotationResult } from '../markdown/annotation-resolver'

const elementOf = (node: Node) => node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement
const asTextRoot = (element: Element) => element as HTMLElement
const sourceHashOf = (block: HTMLElement | undefined) => (block?.matches('[data-ca-mermaid-source]') ? block : block?.querySelector('[data-ca-mermaid-source]'))?.getAttribute('data-ca-mermaid-source') ?? ''

/** Capture the block and label, not the screen coordinates of a particular view. */
export function captureMermaidSelection(range: Range): MermaidSelectionAnchor | undefined {
  const startEl = elementOf(range.startContainer)
  const endEl = elementOf(range.endContainer)
  const block = startEl?.closest<HTMLElement>('[data-ca-block-type="mermaid"]')
  if (!block || !endEl || !block.contains(endEl)) return undefined
  const svg = startEl?.closest('svg')
  if (!svg || !svg.contains(endEl)) return undefined
  const label = startEl?.closest('text')
  const isSingleLabel = label && label === endEl.closest('text')
  const target = isSingleLabel ? label : svg
  const start = resolveNodeOffset(asTextRoot(target), range.startContainer, range.startOffset)
  const end = resolveNodeOffset(asTextRoot(target), range.endContainer, range.endOffset)
  if (start == null || end == null || end <= start) return undefined
  const fullText = getCanonicalText(asTextRoot(target))
  return {
    version: 1,
    blockId: block.dataset.caBlockId ?? '',
    blockPath: block.dataset.caBlockPath ?? '',
    sourceHash: sourceHashOf(block),
    start, end, exact: fullText.slice(start, end),
    prefix: fullText.slice(Math.max(0, start - 24), start), suffix: fullText.slice(end, end + 24),
    ...(isSingleLabel ? { labelIndex: Array.from(svg.querySelectorAll('text')).indexOf(label) } : {}),
  }
}

function readAnchor(annotation: AnnotationV1): MermaidSelectionAnchor | null {
  const a = annotation.meta?.mermaid as MermaidSelectionAnchor | undefined
  return a?.version === 1 && typeof a.blockId === 'string' && typeof a.blockPath === 'string' &&
    typeof a.sourceHash === 'string' && typeof a.exact === 'string' && typeof a.prefix === 'string' &&
    typeof a.suffix === 'string' && Number.isInteger(a.start) && Number.isInteger(a.end) &&
    a.start >= 0 && a.end > a.start && (a.labelIndex === undefined || (Number.isInteger(a.labelIndex) && a.labelIndex >= 0)) ? a : null
}

export function resolveDomTextAnnotations(root: HTMLElement, annotations: AnnotationV1[] | undefined): ResolveTextAnnotationResult {
  const result: ResolveTextAnnotationResult = { resolved: [], unresolved: [] }
  const fullText = getCanonicalText(root)
  for (const annotation of annotations ?? []) {
    const anchor = readAnchor(annotation)
    if (!anchor) {
      const r = resolveTextAnnotations(fullText, [annotation])
      result.resolved.push(...r.resolved); result.unresolved.push(...r.unresolved)
      continue
    }
    const blocks = Array.from(root.querySelectorAll<HTMLElement>('[data-ca-block-type="mermaid"]'))
    if (root.matches('[data-ca-block-type="mermaid"]')) blocks.unshift(root)
    const matching = blocks.filter(b => anchor.blockId ? b.dataset.caBlockId === anchor.blockId : b.dataset.caBlockPath === anchor.blockPath)
    // Never choose a different diagram merely because it happens to have the same label.
    const block = matching.length === 1 ? matching[0] : undefined
    const svg = block?.querySelector('svg.pele')
    const hash = sourceHashOf(block)
    const target = svg && hash === anchor.sourceHash ? (anchor.labelIndex == null ? svg : svg.querySelectorAll('text')[anchor.labelIndex]) : undefined
    if (!target) { result.unresolved.push({ annotation, reason: 'quote-not-found' }); continue }
    const local: AnnotationV1 = { ...annotation, target: { ...annotation.target, selectors: [
      { type: 'text-position', start: anchor.start, end: anchor.end },
      { type: 'text-quote', exact: anchor.exact, prefix: anchor.prefix, suffix: anchor.suffix },
    ] } }
    const r = resolveTextAnnotations(getCanonicalText(asTextRoot(target)), [local])
    const offset = resolveNodeOffset(root, target, 0)
    if (r.resolved[0] && offset != null) {
      const { range, method } = r.resolved[0]
      result.resolved.push({ annotation, range: { start: range.start + offset, end: range.end + offset }, method })
    } else result.unresolved.push({ annotation, reason: 'quote-not-found' })
  }
  return result
}

export function diagramAnnotationsForView(sourceRoot: HTMLElement | null, diagram: HTMLElement | null, annotations: AnnotationV1[] | undefined): AnnotationV1[] {
  if (!sourceRoot || !diagram) return []
  const svg = diagram.querySelector('svg.pele')
  if (!svg) return []
  const offset = resolveNodeOffset(sourceRoot, svg, 0)
  if (offset == null) return []
  const text = getCanonicalText(asTextRoot(svg))
  return resolveDomTextAnnotations(sourceRoot, annotations).resolved.flatMap(({ annotation, range }) => {
    if (range.start < offset || range.end > offset + text.length) return []
    const start = range.start - offset, end = range.end - offset
    return [{ ...annotation, target: { ...annotation.target, selectors: [
      { type: 'text-position' as const, start, end },
      { type: 'text-quote' as const, exact: text.slice(start, end), prefix: text.slice(Math.max(0, start - 24), start), suffix: text.slice(end, end + 24) },
    ] } }]
  })
}

export function diagramAnnotationToSource(sourceRoot: HTMLElement | null, diagram: HTMLElement | null, annotation: AnnotationV1): AnnotationV1 | null {
  const svg = diagram?.querySelector('svg.pele')
  if (!sourceRoot || !svg) return null
  const offset = resolveNodeOffset(sourceRoot, svg, 0)
  const position = annotation.target.selectors.find(s => s.type === 'text-position')
  if (offset == null || position?.type !== 'text-position') return null
  const start = position.start + offset, end = position.end + offset
  const fullText = getCanonicalText(sourceRoot)
  return { ...annotation, target: { ...annotation.target, selectors: [
    { type: 'text-position', start, end },
    { type: 'text-quote', exact: fullText.slice(start, end), prefix: fullText.slice(Math.max(0, start - 24), start), suffix: fullText.slice(end, end + 24) },
  ] } }
}
