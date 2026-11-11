import { describe, expect, it } from 'bun:test'
import { inlineDiagramLayout } from '../mermaid-inline-layout'

describe('inline diagram reading layout', () => {
  it('uses the 14px reading equivalent without stretching a small diagram', () => {
    expect(inlineDiagramLayout({ width: 316, height: 64 }, 650)).toEqual({
      scale: 0.875, width: 276.5, height: 56, needsScroll: false,
    })
  })
  it('fits moderate overflow while retaining readable labels and aspect ratio', () => {
    const layout = inlineDiagramLayout({ width: 800, height: 300 }, 650)!
    expect(layout.width).toBe(650)
    expect(layout.scale * 16).toBe(13)
    expect(layout.width / layout.height).toBeCloseTo(800 / 300)
    expect(layout.needsScroll).toBe(false)
  })
  it('scrolls a wide diagram instead of reducing its text below the reading floor', () => {
    const layout = inlineDiagramLayout({ width: 2000, height: 300 }, 650)!
    expect(layout.scale * 16).toBe(14)
    expect(layout.needsScroll).toBe(true)
  })
  it('handles the exact minimum fit boundary', () => {
    expect(inlineDiagramLayout({ width: 800, height: 300 }, 600)?.scale).toBe(0.75)
    expect(inlineDiagramLayout({ width: 800, height: 300 }, 599)?.needsScroll).toBe(true)
  })
  it('waits for valid SVG and measured container dimensions', () => {
    expect(inlineDiagramLayout(null, 650)).toBeNull()
    expect(inlineDiagramLayout({ width: 316, height: 64 }, 0)).toBeNull()
    expect(inlineDiagramLayout({ width: 0, height: 64 }, 650)).toBeNull()
  })
})
