import * as React from 'react'
import type { AnnotationV1 } from '@craft-agent/core'

/** The active message owns persistence; a diagram overlay only supplies a view. */
export interface MermaidAnnotationHost {
  messageId: string
  sessionId?: string
  annotations?: AnnotationV1[]
  sourceRootRef: React.RefObject<HTMLDivElement | null>
  onAddAnnotation: (messageId: string, annotation: AnnotationV1) => void
  onRemoveAnnotation?: (messageId: string, annotationId: string) => void
  onUpdateAnnotation?: (messageId: string, annotationId: string, patch: Partial<AnnotationV1>) => void
  sendMessageKey?: 'enter' | 'cmd-enter'
  onDiagramOpenChange: (open: boolean) => void
}
export const MermaidAnnotationContext = React.createContext<MermaidAnnotationHost | null>(null)
