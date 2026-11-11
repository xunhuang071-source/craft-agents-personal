/** Diagram view: Pele renders, the app owns one zoom/selection/annotation layer. */
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { GitGraph } from 'lucide-react'
import { PreviewOverlay } from './PreviewOverlay'
import { CopyButton } from './CopyButton'
import { ZoomControls } from './ZoomControls'
import { RICH_BLOCK_DEFAULTS } from './rich-block-interaction-spec'
import { useRichBlockInteractions } from './useRichBlockInteractions'
import { renderMermaidDiagram } from '../markdown/mermaid-renderer'
import { AnnotatableMarkdownDocument } from './AnnotatableMarkdownDocument'
import type { MermaidAnnotationHost } from '../annotations/MermaidAnnotationContext'
import { diagramAnnotationsForView, diagramAnnotationToSource } from '../annotations/mermaid-annotations'

export interface MermaidPreviewOverlayProps {
  isOpen: boolean
  onClose: () => void
  code: string
  annotationHost?: MermaidAnnotationHost | null
  diagramElement?: HTMLElement | null
}
export function MermaidPreviewOverlay({ isOpen, onClose, code, annotationHost, diagramElement }: MermaidPreviewOverlayProps) {
  const { t } = useTranslation()
  const [container, setContainer] = React.useState<HTMLDivElement | null>(null)
  const id = `diagram-preview-${React.useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const result = React.useMemo(() => isOpen ? renderMermaidDiagram(code, id) : null, [code, id, isOpen])
  const {
    scale, translate, isDragging, isAnimating, setIsAnimating,
    zoomByStep, zoomToPreset, zoomToFit, reset, onMouseDown, onDoubleClick,
  } = useRichBlockInteractions({ isOpen, container, selectableText: true })
  const sourceBlock = diagramElement?.closest<HTMLElement>('[data-ca-block-type="mermaid"]')
  const annotations = React.useMemo(() => diagramAnnotationsForView(
    annotationHost?.sourceRootRef.current ?? null, diagramElement ?? null, annotationHost?.annotations,
  ), [annotationHost?.sourceRootRef, annotationHost?.annotations, diagramElement, isOpen])
  const isDefaultView = scale === 1 && translate.x === 0 && translate.y === 0
  const diagram = result && <div
    data-ca-block-type="mermaid"
    data-ca-block-id={sourceBlock?.dataset.caBlockId ?? ''}
    data-ca-block-path={sourceBlock?.dataset.caBlockPath ?? ''}
    data-ca-mermaid-source={diagramElement?.dataset.caMermaidSource ?? ''}
    data-ca-mermaid-svg="true"
    className="[&_text]:select-text [&_tspan]:select-text [&_text]:cursor-text"
    onTransitionEnd={() => setIsAnimating(false)}
    style={{
      position: 'absolute', left: '50%', top: '50%', width: result.width, height: result.height,
      transform: `translate(-50%, -50%) translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
      transformOrigin: 'center center', transition: isAnimating ? 'transform 150ms ease-out' : 'none',
    }}
    dangerouslySetInnerHTML={{ __html: result.svg }}
  />
  return <PreviewOverlay isOpen={isOpen} onClose={onClose}
    typeBadge={{ icon: GitGraph, label: 'Diagram', variant: 'purple' }}
    title={t('overlay.mermaidDiagram')}
    headerActions={<div className="flex items-center gap-1.5">
      <ZoomControls scale={scale} minScale={RICH_BLOCK_DEFAULTS.minScale} maxScale={RICH_BLOCK_DEFAULTS.maxScale}
        zoomPresets={RICH_BLOCK_DEFAULTS.zoomPresets} onZoomIn={() => zoomByStep('in')} onZoomOut={() => zoomByStep('out')}
        onZoomToPreset={zoomToPreset} onZoomToFit={() => zoomToFit(result)} onReset={reset} resetDisabled={isDefaultView} />
      <CopyButton content={code} title={t('common.copyCode')} className="bg-background shadow-minimal opacity-70 hover:opacity-100" />
    </div>}
  >
    <div ref={setContainer} data-ca-diagram-viewport="true" onMouseDown={onMouseDown} onDoubleClick={onDoubleClick}
      style={{ height: 'calc(100vh - 120px)', minHeight: 200, position: 'relative', width: '100%', overflow: 'hidden', cursor: isDragging ? 'grabbing' : 'grab' }}>
      {annotationHost ? <AnnotatableMarkdownDocument content={code} messageId={annotationHost.messageId}
        sessionId={annotationHost.sessionId} annotations={annotations} sendMessageKey={annotationHost.sendMessageKey}
        onAddAnnotation={(messageId, annotation) => {
          const mapped = diagramAnnotationToSource(annotationHost.sourceRootRef.current, diagramElement ?? null, annotation)
          if (mapped) annotationHost.onAddAnnotation(messageId, mapped)
        }}
        onRemoveAnnotation={annotationHost.onRemoveAnnotation} onUpdateAnnotation={annotationHost.onUpdateAnnotation}
        geometryKey={`${scale}:${translate.x}:${translate.y}:${isAnimating}`}>
        {diagram}
      </AnnotatableMarkdownDocument> : diagram}
    </div>
  </PreviewOverlay>
}
