import { createContext } from 'react'
/** Unmasked, untransformed portal host inside the currently active dialog. */
export const OverlayPortalContext = createContext<HTMLElement | null>(null)

export const OVERLAY_ANNOTATION_ESCAPE = 'craft-overlay-annotation-escape'
/** A standalone dialog has no app registry; ask its own active annotation host. */
export function dispatchOverlayAnnotationEscape(host: HTMLElement | null): boolean {
  if (!host) return false
  const event = new Event(OVERLAY_ANNOTATION_ESCAPE, { cancelable: true })
  host.dispatchEvent(event)
  return event.defaultPrevented
}
