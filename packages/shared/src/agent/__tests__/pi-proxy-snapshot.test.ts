import { expect, test } from 'bun:test'
import { PiAgent } from '../pi-agent.ts'
const prototype = PiAgent.prototype as any
const source = { name: 'mcp__fixture__read', description: 'Fixture source', inputSchema: { type: 'object' } }
test('host combines session tools with source tools and retains sessions when none remain', () => {
  const context = { config: { miniModel: 'fixture-fast' }, mcpPool: { getProxyToolDefs: () => [source] } }
  const first = prototype.buildProxyToolDefs.call(context)
  expect(first.some((t: any) => t.name === source.name)).toBe(true)
  expect(first.some((t: any) => t.name === 'mcp__session__SubmitPlan')).toBe(true)
  context.mcpPool.getProxyToolDefs = () => []
  const next = prototype.buildProxyToolDefs.call(context)
  expect(next.some((t: any) => t.name === source.name)).toBe(false)
  expect(next.some((t: any) => t.name === 'mcp__session__SubmitPlan')).toBe(true)
  const description = next.find((t: any) => t.name === 'mcp__session__call_llm').description
  expect(description.split('fixture-fast')).toHaveLength(2)
})
test('host sends full empty-source snapshots, deduplicates, and resends to a new subprocess', () => {
  let defs = [source]
  const sent: unknown[] = []
  const context = { subprocess: { stdin: { writable: true } }, sentProxyTools: null, buildProxyToolDefs: () => defs, send: (m: unknown) => sent.push(m), debug: () => {} }
  prototype.syncProxyTools.call(context); prototype.syncProxyTools.call(context)
  expect(sent).toHaveLength(1)
  defs = []; prototype.syncProxyTools.call(context)
  expect(sent[1]).toEqual({ type: 'register_tools', tools: [] })
  context.sentProxyTools = null; prototype.syncProxyTools.call(context)
  expect(sent).toHaveLength(3)
})
