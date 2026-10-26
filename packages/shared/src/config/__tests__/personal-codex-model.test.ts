import { expect, it } from 'bun:test'
import { getPiModelsForAuthProvider } from '../models-pi'
it('retains the exact installed GPT-6.1 Sol descriptor, including 500K', () => {
 expect(getPiModelsForAuthProvider('openai-codex').find(m => m.id === 'pi/gpt-6.1-sol')).toEqual({ id: 'pi/gpt-6.1-sol', name: 'GPT-6.1 Sol', shortName: 'GPT-6.1 Sol', description: 'openai-codex model via Craft Agents Backend', provider: 'pi', contextWindow: 500000, supportsThinking: true })
})
