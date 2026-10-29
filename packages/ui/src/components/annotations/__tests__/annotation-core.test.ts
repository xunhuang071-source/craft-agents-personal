import { describe, expect, it } from 'bun:test'
import {
  createSelectionPreviewAnnotation,
  createTextSelectionAnnotation,
} from '../annotation-core'
import { getAnnotationChipVisual } from '../annotation-style-tokens'

describe('annotation core helpers', () => {
  it('creates text selection annotation with follow-up metadata and session id', () => {
    const annotation = createTextSelectionAnnotation(
      'msg-1',
      {
        start: 2,
        end: 9,
        selectedText: 'example',
        prefix: 'pre',
        suffix: 'suf',
      },
      'Need follow-up',
      'session-42',
    )

    expect(annotation.target.source).toEqual({
      sessionId: 'session-42',
      messageId: 'msg-1',
    })

    const noteBody = annotation.body.find(body => body.type === 'note')
    expect(noteBody && 'text' in noteBody ? noteBody.text : '').toBe('Need follow-up')

    const followUp = (annotation.meta as Record<string, unknown> | undefined)?.followUp as Record<string, unknown> | undefined
    expect(followUp?.text).toBe('Need follow-up')
    expect(typeof followUp?.createdAt).toBe('number')
  })

  it('creates preview annotation marked ephemeral with explicit source', () => {
    const preview = createSelectionPreviewAnnotation(
      'msg-2',
      {
        start: 0,
        end: 4,
        selectedText: 'test',
        prefix: '',
        suffix: ' data',
      },
      'session-preview',
    )

    expect(preview.target.source).toEqual({ sessionId: 'session-preview', messageId: 'msg-2' })
    expect((preview.meta as Record<string, unknown>)?.ephemeral).toBe(true)
    expect((preview.meta as Record<string, unknown>)?.source).toBe('follow-up-selection-preview')
  })

  it('keeps chip visuals consistent across pending and sent states', () => {
    const pending = getAnnotationChipVisual({ pendingFollowUp: true, sentFollowUp: false })
    const sent = getAnnotationChipVisual({ pendingFollowUp: false, sentFollowUp: true })

    expect(pending.className.includes('shadow-tinted')).toBe(true)
    expect(String(pending.style.backgroundColor)).toContain('34%')
    expect(String(sent.style.backgroundColor)).toContain('14%')
  })
})


it('preserves a block-local diagram anchor in preview and saved annotations', () => {
  const mermaid = { version: 1 as const, blockId: 'b', blockPath: 'line:1-4', sourceHash: 'hash', start: 0, end: 2, exact: '开始', prefix: '', suffix: '', labelIndex: 1 }
  const selection = { start: 10, end: 12, selectedText: '开始', prefix: '', suffix: '', mermaid }
  expect(createSelectionPreviewAnnotation('m', selection).meta?.mermaid).toEqual(mermaid)
  expect(createTextSelectionAnnotation('m', selection, '批注').meta?.mermaid).toEqual(mermaid)
})
