import { describe, expect, it } from 'bun:test';
import { fromPiProviderId, toPiProviderId } from '../pi-provider-ids.ts';
import { getPiApiKeyProviders, getPiModelsForAuthProvider, getPiProviderBaseUrl } from '../models-pi.ts';

describe('Pi 1.4 host compatibility', () => {
  it('translates provider ids without migrating stored connection ids or API ids', () => {
    expect(toPiProviderId('azure-openai-responses')).toBe('azure');
    expect(fromPiProviderId('azure')).toBe('azure-openai-responses');
    expect(toPiProviderId('openai-codex')).toBe('openai-codex');
    const azure = getPiModelsForAuthProvider('azure-openai-responses');
    expect(azure.length).toBeGreaterThan(0);
    expect(azure).toEqual(getPiModelsForAuthProvider('azure'));
    expect(getPiApiKeyProviders().filter(p => p.key === 'azure-openai-responses')).toHaveLength(1);
    expect(getPiApiKeyProviders().some(p => p.key === 'azure')).toBe(false);
    expect(getPiProviderBaseUrl('azure-openai-responses')).toBe(getPiProviderBaseUrl('azure'));
  });

  it('keeps exactly one authoritative 500K Sol descriptor when the SDK already lists it', () => {
    const models = getPiModelsForAuthProvider('openai-codex').filter(m => m.id === 'pi/gpt-6.1-sol');
    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({ contextWindow: 500_000, supportsThinking: true, name: 'GPT-6.1 Sol' });
  });
});
