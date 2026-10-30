import { describe, expect, it } from 'bun:test'
import {
  buildCustomEndpointModelDef,
  normalizeCustomEndpointModelEntry,
  stripPiPrefix,
} from './custom-endpoint-models.ts'

describe('normalizeCustomEndpointModelEntry', () => {
  it('strips pi/ prefixes from string model IDs', () => {
    expect(stripPiPrefix('pi/my-model')).toBe('my-model')
    expect(normalizeCustomEndpointModelEntry('pi/my-model')).toEqual({ id: 'my-model' })
  })

  it('preserves per-model image support when enabled', () => {
    expect(normalizeCustomEndpointModelEntry({
      id: 'pi/vision-model',
      supportsImages: true,
    })).toEqual({
      id: 'vision-model',
      supportsImages: true,
    })
  })

  it('preserves explicit per-model image support when disabled', () => {
    expect(normalizeCustomEndpointModelEntry({
      id: 'pi/text-only-model',
      supportsImages: false,
    })).toEqual({
      id: 'text-only-model',
      supportsImages: false,
    })
  })

  it('preserves context window and image support together', () => {
    expect(normalizeCustomEndpointModelEntry({
      id: 'pi/vision-model',
      contextWindow: 262_144,
      supportsImages: true,
    })).toEqual({
      id: 'vision-model',
      contextWindow: 262_144,
      supportsImages: true,
    })
  })
})

describe('buildCustomEndpointModelDef', () => {
  it('defaults custom endpoint models to text-only input', () => {
    const model = buildCustomEndpointModelDef('my-model')
    expect(model.input).toEqual(['text'])
  })

  it('enables image input when the connection explicitly opts in', () => {
    const model = buildCustomEndpointModelDef('vision-model', { supportsImages: true })
    expect(model.input).toEqual(['text', 'image'])
  })

  it('lets per-model overrides disable image input even when the connection default is enabled', () => {
    const model = buildCustomEndpointModelDef('text-only-model', { supportsImages: true }, { supportsImages: false })
    expect(model.input).toEqual(['text'])
  })

  it('lets per-model overrides enable image input and custom context window', () => {
    const model = buildCustomEndpointModelDef('vision-model', undefined, { supportsImages: true, contextWindow: 262_144 })
    expect(model.input).toEqual(['text', 'image'])
    expect(model.contextWindow).toBe(262_144)
  })

  // Regression: craft-agents-oss#1022 — strict OpenAI-compatible gateways 400 on the
  // `store` param. supportsStore:false makes the pi-ai driver omit it entirely.
  it('disables the store param for openai-completions endpoints', () => {
    const model = buildCustomEndpointModelDef('gpt-model', undefined, undefined, 'openai-completions')
    expect((model as { compat?: { supportsStore?: boolean } }).compat).toEqual({ supportsStore: false })
  })

  it('does not set store compat for anthropic-messages endpoints', () => {
    const model = buildCustomEndpointModelDef('claude-model', undefined, undefined, 'anthropic-messages')
    expect((model as { compat?: unknown }).compat).toBeUndefined()
  })

  it('does not set store compat when the api is unspecified', () => {
    const model = buildCustomEndpointModelDef('some-model')
    expect((model as { compat?: unknown }).compat).toBeUndefined()
  })
})

describe('explicit managed-provider capabilities', () => {
  it('preserves reasoning and output metadata through normalization', () => {
    expect(normalizeCustomEndpointModelEntry({
      id: 'pi/gemini-example', contextWindow: 1_048_576,
      supportsThinking: true, maxTokens: 65_536,
    })).toEqual({ id: 'gemini-example', contextWindow: 1_048_576, supportsThinking: true, maxTokens: 65_536 })
  })
  it('only enables reasoning when explicitly declared', () => {
    expect(buildCustomEndpointModelDef('old-endpoint').reasoning).toBe(false)
    expect(buildCustomEndpointModelDef('new-endpoint', undefined, { supportsThinking: true }).reasoning).toBe(true)
    expect(buildCustomEndpointModelDef('text-model', undefined, { supportsThinking: false }).reasoning).toBe(false)
  })
  it('retains the legacy output limit unless a valid explicit limit is supplied', () => {
    expect(buildCustomEndpointModelDef('old-endpoint').maxTokens).toBe(8192)
    expect(buildCustomEndpointModelDef('new-endpoint', undefined, { maxTokens: 65536 }).maxTokens).toBe(65536)
    for (const maxTokens of [0, -1, Infinity, NaN]) {
      expect(buildCustomEndpointModelDef('invalid', undefined, { maxTokens }).maxTokens).toBe(8192)
    }
  })
})
