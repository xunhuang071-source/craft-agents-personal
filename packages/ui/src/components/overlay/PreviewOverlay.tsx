/**
 * PreviewOverlay - Base component for all preview overlays
 *
 * Provides unified presentation logic for modal/fullscreen overlays:
 * - Portal rendering to document.body (via FullscreenOverlayBase for fullscreen mode)
 * - Responsive modal (>=1200px) vs fullscreen (<1200px) modes
 * - Escape key to close
 * - Backdrop click to close (modal mode)
 * - Consistent header layout with badges, close button
 * - Optional error banner
 *
 * Header is delegated to FullscreenOverlayBase in fullscreen mode (which renders
 * FullscreenOverlayBaseHeader). In modal/embedded mode, renders the header directly.
 *
 * Used by: CodePreviewOverlay, TerminalPreviewOverlay, GenericOverlay, etc.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { OverlayPortalContext, dispatchOverlayAnnotationEscape } from '../../lib/overlay-portal-context'
import { getDismissibleLayerBridge } from '../../lib/dismissible-layer-bridge'
import * as Dialog from '@radix-ui/react-dialog'
import { type LucideIcon } from 'lucide-react'
import { useOverlayMode, OVERLAY_LAYOUT } from '../../lib/layout'
import { FullscreenOverlayBase } from './FullscreenOverlayBase'
import { FullscreenOverlayBaseHeader } from './FullscreenOverlayBaseHeader'
import { OverlayErrorBanner } from './OverlayErrorBanner'
import type { PreviewBadgeVariant } from '../ui/PreviewHeader'

/** Badge color variants - re-export for backwards compatibility */
export type BadgeVariant = PreviewBadgeVariant

/** Shared background class for all overlay modes - single source of truth */
const OVERLAY_BG = 'bg-background'

export interface PreviewOverlayProps {
  /** Whether the overlay is visible */
  isOpen: boolean
  /** Callback when the overlay should close */
  onClose: () => void
  /** Theme mode */
  theme?: 'light' | 'dark'

  /** Type badge configuration — tool/format indicator */
  typeBadge: {
    icon: LucideIcon
    label: string
    variant: BadgeVariant
  }

  /** File path — shows dual-trigger menu badge with "Open" + "Reveal in {file manager}" */
  filePath?: string
  /** Title — displayed as badge. Fallback when no file path. */
  title?: string
  /** Callback when title badge is clicked (only used when no filePath) */
  onTitleClick?: () => void
  /** Optional subtitle (e.g., line range info) */
  subtitle?: string

  /** Optional error state */
  error?: {
    label: string
    message: string
  }

  /** Actions to show in header right side */
  headerActions?: ReactNode

  /** Main content */
  children: ReactNode

  /** Render inline (no dialog/portal) — for embedding in design system playground */
  embedded?: boolean

  /** Custom class names for the overlay container (e.g., to override bg-background) */
  className?: string
}

export function PreviewOverlay({
  isOpen,
  onClose,
  theme = 'light',
  typeBadge,
  filePath,
  title,
  onTitleClick,
  subtitle,
  error,
  headerActions,
  children,
  embedded = false,
  className,
}: PreviewOverlayProps) {
  // Use custom className if provided, otherwise fall back to default bg
  const bgClass = className || OVERLAY_BG
  const responsiveMode = useOverlayMode()
  const isModal = responsiveMode === 'modal'
  const [portalHost, setPortalHost] = useState<HTMLDivElement | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const modalId = useRef(`preview-modal-${Math.random().toString(36).slice(2)}`)

  // Register modal and fullscreen previews in the same dismissal stack.
  useEffect(() => {
    if (!isOpen || !isModal || embedded) return
    return getDismissibleLayerBridge()?.registerLayer({
      id: modalId.current, type: 'modal', priority: 100, close: () => onCloseRef.current(),
    })
  }, [isOpen, isModal, embedded])

  if (!isOpen && !embedded) return null

  // Header rendered in modal/embedded mode (fullscreen delegates to FullscreenOverlayBase)
  const header = (
    <FullscreenOverlayBaseHeader
      onClose={onClose}
      typeBadge={typeBadge}
      filePath={filePath}
      title={title}
      onTitleClick={onTitleClick}
      subtitle={subtitle}
      headerActions={headerActions}
    />
  )

  // Error banner — uses shared OverlayErrorBanner with tinted-shadow styling.
  // Rendered inside the centering wrapper so error + content are centered together.
  const errorBanner = error && (
    <div className="px-6 pb-4">
      <OverlayErrorBanner label={error.label} message={error.message} />
    </div>
  )

  // Gradient fade mask for modal/embedded modes — mirrors FullscreenOverlayBase's
  // scroll container structure so children (ContentFrame, etc.) work identically
  // in all modes using flow-based layout inside a scrollable, masked viewport.
  const FADE_SIZE = 24
  const FADE_MASK = `linear-gradient(to bottom, transparent 0%, black ${FADE_SIZE}px, black calc(100% - ${FADE_SIZE}px), transparent 100%)`

  const contentArea = (
    <div
      className="flex-1 min-h-0 relative"
      style={{ maskImage: FADE_MASK, WebkitMaskImage: FADE_MASK }}
    >
      <div
        className="absolute inset-0 overflow-y-auto"
        style={{ paddingTop: FADE_SIZE, paddingBottom: FADE_SIZE, scrollPaddingTop: FADE_SIZE }}
      >
        {/* Centering wrapper — error + content are vertically centered together when small */}
        <div className="min-h-full flex flex-col justify-center">
          {errorBanner}
          {children}
        </div>
      </div>
    </div>
  )

  // Embedded mode — renders inline without dialog/portal, for design system playground
  if (embedded) {
    return (
      <div className={`flex flex-col ${bgClass} h-full w-full overflow-hidden rounded-lg border border-foreground/5`}>
        {header}
        {contentArea}
      </div>
    )
  }

  // Fullscreen mode — FullscreenOverlayBase renders the header via structured props
  // and owns the masked scroll container. Children are rendered directly inside it.
  if (!isModal) {
    return (
      <FullscreenOverlayBase
        isOpen={isOpen}
        onClose={onClose}
        typeBadge={typeBadge}
        filePath={filePath}
        title={title}
        onTitleClick={onTitleClick}
        subtitle={subtitle}
        headerActions={headerActions}
        error={error}
      >
        {children}
      </FullscreenOverlayBase>
    )
  }

  // Modal mode - uses its own portal with backdrop click to close
  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => !open && onClose()}>
    <Dialog.Portal>
    <Dialog.Content
      className={`fixed inset-0 flex items-center justify-center outline-none ${OVERLAY_LAYOUT.modalBackdropClass}`}
      style={{ zIndex: 'var(--z-fullscreen, 350)' }}
      onOpenAutoFocus={(event) => event.preventDefault()}
      onEscapeKeyDown={(event) => {
            if (event.defaultPrevented) return
        const bridge = getDismissibleLayerBridge()
        if (bridge?.handleEscape() || dispatchOverlayAnnotationEscape(portalHost)) {
          event.preventDefault()
          event.stopPropagation()

        }
      }}
      data-ca-overlay-surface="true"
      role="dialog"
      aria-modal="true"
      aria-label={title || typeBadge.label}
      onMouseDown={(e) => e.stopPropagation()}
      onMouseUp={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation()
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <Dialog.Title className="sr-only">{title || typeBadge.label}</Dialog.Title>
      <OverlayPortalContext.Provider value={portalHost}>
      <div
        className={`flex flex-col ${bgClass} shadow-3xl overflow-hidden smooth-corners`}
        style={{
          width: '90vw',
          maxWidth: OVERLAY_LAYOUT.modalMaxWidth,
          height: `${OVERLAY_LAYOUT.modalMaxHeightPercent}vh`,
          borderRadius: 16,
        }}
      >
        {header}
        {contentArea}
      </div>
      <div ref={setPortalHost} data-ca-overlay-portals="true" />
      </OverlayPortalContext.Provider>
    </Dialog.Content>
    </Dialog.Portal>
    </Dialog.Root>
  )
}
