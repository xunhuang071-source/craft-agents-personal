import { describe, expect, test } from 'bun:test'
import { activateProxySubset } from './proxy-tool-sync.ts'
const tool = (name: string, description = name) => ({ name, description, inputSchema: { type: 'object', properties: {} } })
const sessionTool = tool('mcp__session__SubmitPlan'), sourceTool = tool('mcp__source__read')
function session(initial: string[]) {
  let active = initial
  return { getActiveToolNames: () => active, setActiveToolsByName: (names: string[]) => { active = names } }
}
describe('proxy snapshot subset updates', () => {
  test('removes the last source while retaining native and session tools', () => {
    const s = session(['read', sessionTool.name, sourceTool.name])
    expect(activateProxySubset(s, [sessionTool, sourceTool], [sessionTool])).toBe(true)
    expect(s.getActiveToolNames()).toEqual(['read', sessionTool.name])
  })
  test('can reactivate a definition already registered in the same SDK session', () => {
    const s = session(['read', sessionTool.name])
    expect(activateProxySubset(s, [sessionTool, sourceTool], [sessionTool, sourceTool])).toBe(true)
    expect(s.getActiveToolNames()).toContain(sourceTool.name)
  })
  test('requires a rebuild for genuinely new tools', () => {
    const s = session(['read', sessionTool.name])
    expect(activateProxySubset(s, [sessionTool], [sessionTool, sourceTool])).toBe(false)
    expect(s.getActiveToolNames()).toEqual(['read', sessionTool.name])
  })
  test('requires a rebuild if a schema or description changed', () => {
    const s = session(['read', sourceTool.name])
    expect(activateProxySubset(s, [sourceTool], [tool(sourceTool.name, 'changed')])).toBe(false)
  })
  test('handles an empty proxy snapshot without dropping native tools', () => {
    const s = session(['read', 'bash', sessionTool.name, sourceTool.name])
    expect(activateProxySubset(s, [sessionTool, sourceTool], [])).toBe(true)
    expect(s.getActiveToolNames()).toEqual(['read', 'bash'])
  })
})
