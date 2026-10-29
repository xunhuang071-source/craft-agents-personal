import * as React from 'react'
import { renderMermaidDiagram } from './mermaid-renderer'
import { MermaidAnnotationContext } from '../annotations/MermaidAnnotationContext'
import { clearDomSelection } from '../annotations/selection-restore'
import { Maximize2 } from 'lucide-react'
import { cn } from '../../lib/utils'
import { CodeBlock } from './CodeBlock'
import { MermaidPreviewOverlay } from '../overlay/MermaidPreviewOverlay'
import { useScrollFade } from './useScrollFade'
import { useTranslation } from 'react-i18next'

// ============================================================================
// MarkdownMermaidBlock — renders mermaid code fences as SVG diagrams.
//
// Uses Pele to parse Mermaid text and produce a themeable SVG string.
// Falls back to a plain code block if rendering fails (invalid syntax, etc).
//
// Theming: Colors are passed as CSS variable references (var(--background),
// var(--foreground), etc.) so the SVG inherits from the app's theme system
// via CSS cascade. Theme switches (light/dark, preset changes) apply
// automatically without re-rendering — the browser resolves the variables.
//
// Wide diagrams: Horizontal diagrams (graph LR) with many nodes can become
// unreadably small when fit to container width. To fix this, we enforce a
// minimum rendered height (MIN_READABLE_HEIGHT). If the natural scale would
// produce a height below this threshold, we scale up and allow horizontal
// scroll. A CSS mask gradient fades the edges to indicate scrollable content.
// ============================================================================

// Minimum rendered height for diagrams. Wide horizontal diagrams are scaled
// up to at least this height to keep text readable, with horizontal scroll.
const MIN_READABLE_HEIGHT = 280

// Fade zone size for scroll indicators (px)
const FADE_SIZE = 32

// Small overflow threshold — if diagram overflows by less than this, scale to fit
const SMALL_OVERFLOW_THRESHOLD = 200

/** Parse width/height from an SVG string's root element attributes. */
function parseSvgDimensions(svgString: string): { width: number; height: number } | null {
  const widthMatch = svgString.match(/width="(\d+(?:\.\d+)?)"/)
  const heightMatch = svgString.match(/height="(\d+(?:\.\d+)?)"/)
  if (!widthMatch?.[1] || !heightMatch?.[1]) return null
  return { width: parseFloat(widthMatch[1]), height: parseFloat(heightMatch[1]) }
}

interface MarkdownMermaidBlockProps {
  code: string
  className?: string
  /** Whether to show the inline expand button. Default true.
   *  Set to false when the mermaid block is the first block in a message,
   *  where the TurnCard's own fullscreen button already occupies the same position. */
  showExpandButton?: boolean
  /** Whether clicking/tapping the inline diagram should open fullscreen.
   *  Enabled by default for chat parity with image blocks; editor node-views can disable it. */
  tapToOpen?: boolean
  /** Optional minimum block height to reserve space before responsive sizing settles. */
  minHeight?: number
}

export function MarkdownMermaidBlock({ code, className, showExpandButton = true, tapToOpen = true, minHeight }: MarkdownMermaidBlockProps) {
  const { t } = useTranslation()
  const diagramId = `diagram-${React.useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const annotationHost = React.useContext(MermaidAnnotationContext)
  const hostRef = React.useRef(annotationHost)
  hostRef.current = annotationHost
  const inlineRef = React.useRef<HTMLDivElement>(null)
  const sourceHash = React.useMemo(() => {
    let hash = 2166136261
    for (let i = 0; i < code.length; i++) hash = Math.imul(hash ^ code.charCodeAt(i), 16777619)
    return (hash >>> 0).toString(36)
  }, [code])
  const { svg, error } = React.useMemo(() => {
    try { return { svg: renderMermaidDiagram(code, diagramId).svg, error: null } }
    catch (error) { return { svg: null, error } }
  }, [code, diagramId])
  const [isFullscreen, setIsFullscreen] = React.useState(false)
  const openFullscreen = (explicit = false) => {
    const selection = window.getSelection()
    // A drag to select text must never be interpreted as a click-to-expand.
    if (!explicit && selection && !selection.isCollapsed && inlineRef.current?.contains(selection.anchorNode)) return
    clearDomSelection()
    hostRef.current?.onDiagramOpenChange(true)
    setIsFullscreen(true)
  }
  const closeFullscreen = () => {
    clearDomSelection()
    hostRef.current?.onDiagramOpenChange(false)
    setIsFullscreen(false)
  }
  React.useEffect(() => {
    if (!isFullscreen) return
    const host = hostRef.current
    return () => { host?.onDiagramOpenChange(false) }
  }, [isFullscreen])
  const { scrollRef, maskImage } = useScrollFade(FADE_SIZE)

  // Stable container width — measured via useLayoutEffect (before browser paint)
  // to avoid the flash caused by scrollRef.current being null on first render.
  const [containerWidth, setContainerWidth] = React.useState(0)

  React.useLayoutEffect(() => {
    const el = scrollRef.current
    if (el) setContainerWidth(el.clientWidth)
  }, [svg])

  React.useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setContainerWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Calculate scaled dimensions for wide diagrams.
  // If the natural height at container width would be below MIN_READABLE_HEIGHT,
  // scale up to reach that height — but never exceed 100% (natural size).
  // This prevents small diagrams from being over-zoomed and pixelated.
  const getScaledDimensions = React.useCallback(() => {
    if (!svg) return null
    if (!containerWidth) return null

    const dims = parseSvgDimensions(svg)
    if (!dims) return null

    // Calculate what height we'd get if we fit to container width
    const fitToContainerScale = containerWidth / dims.width
    const projectedHeight = dims.height * fitToContainerScale

    // If diagram height is fine at natural size, check if width overflows
    if (projectedHeight >= MIN_READABLE_HEIGHT) {
      const overflow = dims.width - containerWidth

      // Small overflow: scale to fit rather than scroll
      if (overflow > 0 && overflow < SMALL_OVERFLOW_THRESHOLD) {
        const scaledHeight = dims.height * fitToContainerScale
        return { scale: fitToContainerScale, width: containerWidth, height: scaledHeight, needsScroll: false }
      }

      // Large overflow: enable scroll at natural size
      const needsScroll = overflow > 0
      return {
        scale: 1,
        width: needsScroll ? dims.width : undefined,
        height: needsScroll ? dims.height : undefined,
        needsScroll,
      }
    }

    // Diagram would be too small at container width.
    // Scale up to reach MIN_READABLE_HEIGHT, but cap at 100% (natural size).
    const desiredScale = MIN_READABLE_HEIGHT / dims.height
    const scale = Math.min(desiredScale, 1.0)

    const scaledWidth = dims.width * scale
    const scaledHeight = dims.height * scale

    // Enable scroll if scaled content is wider than container (beyond threshold)
    const scaledOverflow = scaledWidth - containerWidth
    if (scaledOverflow > 0 && scaledOverflow < SMALL_OVERFLOW_THRESHOLD) {
      // Small overflow: scale to fit container
      const fitScale = containerWidth / dims.width
      const fitHeight = dims.height * fitScale
      return { scale: fitScale, width: containerWidth, height: fitHeight, needsScroll: false }
    }

    return {
      scale,
      width: scaledWidth,
      height: scaledHeight,
      needsScroll: scaledOverflow > 0,
    }
  }, [svg, containerWidth])

  // On error, fall back to a plain code block showing the mermaid source
  if (error) {
    return <CodeBlock code={code} language="mermaid" mode="full" className={className} />
  }

  // Fallback: if SVG is null (should be caught by error above, but just in case)
  if (!svg) {
    return <CodeBlock code={code} language="mermaid" mode="full" className={className} />
  }

  const scaledDims = getScaledDimensions()
  const minHeightStyle = minHeight != null ? { minHeight: `${minHeight}px` } : undefined

  // Scaling mode: when dimensions are provided OR scale !== 1
  // This is separate from needsScroll — we may scale to fit without scrolling
  const needsScaling = scaledDims && (scaledDims.width != null || scaledDims.scale !== 1)

  return (
    <>
      {/* Wrapper with group class so the expand button shows on hover */}
      <div ref={inlineRef} data-ca-mermaid-source={sourceHash} data-ca-mermaid-svg="true" className={cn('relative group [&_text]:select-text [&_tspan]:select-text [&_text]:cursor-text', className)} style={minHeightStyle}>
        {/* Expand button — matches code block expand button style (TurnCard pattern).
            Hidden when showExpandButton is false (first block in message, where
            TurnCard's own fullscreen button occupies the same top-right position). */}
        {showExpandButton && (
          <button
            onClick={() => openFullscreen(true)}
            className={cn(
              "absolute top-2 right-2 p-1 rounded-[6px] transition-all z-10 select-none",
              "opacity-0 group-hover:opacity-100",
              "bg-background shadow-minimal",
              "text-muted-foreground/50 hover:text-foreground",
              "focus:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:opacity-100"
            )}
            title={t('common.viewFullscreen')}
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Scroll container with fade mask for overflow indication.
            CSS mask gradient fades the edges when content is scrollable. */}
        <div
          ref={scrollRef}
          style={{
            overflowX: 'auto',
            overflowY: 'hidden',
            maskImage,
            WebkitMaskImage: maskImage,
            ...minHeightStyle,
          }}
        >
          {/* Size wrapper — uses explicit dimensions when scaling or scrolling.
              Block display for scaled/scrolling content, flex center for natural fit. */}
          <div
            style={{
              width: needsScaling && scaledDims?.width ? `${scaledDims.width}px` : undefined,
              height: needsScaling && scaledDims?.height ? `${scaledDims.height}px` : undefined,
              display: needsScaling ? 'block' : 'flex',
              justifyContent: needsScaling ? undefined : 'center',
              margin: needsScaling && !scaledDims?.needsScroll ? '0 auto' : undefined,
              cursor: tapToOpen ? 'pointer' : undefined,
            }}
            onClick={tapToOpen ? () => openFullscreen() : undefined}
            role={tapToOpen ? 'button' : undefined}
            aria-label={tapToOpen ? 'Open Mermaid diagram fullscreen' : undefined}
            tabIndex={tapToOpen ? 0 : undefined}
            onKeyDown={tapToOpen ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                openFullscreen(true)
              }
            } : undefined}
          >
            {/* SVG container — CSS transform scales the SVG visually.
                transform-origin: top left ensures scaling expands down and right. */}
            <div
              dangerouslySetInnerHTML={{ __html: svg }}
              style={{
                transformOrigin: 'top left',
                transform: scaledDims && scaledDims.scale !== 1 ? `scale(${scaledDims.scale})` : undefined,
              }}
            />
          </div>
        </div>
      </div>

      {/* Fullscreen overlay with zoom/pan */}
      <MermaidPreviewOverlay
        isOpen={isFullscreen}
        onClose={closeFullscreen}
        code={code}
        annotationHost={annotationHost}
        diagramElement={inlineRef.current}
      />
    </>
  )
}
