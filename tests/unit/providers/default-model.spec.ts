import { describe, expect, it } from 'vitest'
import type { Providers } from '../../../shared/types/providers.d'
import { defaultModel, resolveDefaultMarkedModel } from '../../../providers'

function buildProvider(
  id: string,
  modelIds: Array<{ id: string, default?: boolean }>,
): Providers[number] {
  return {
    id,
    name: id,
    models: modelIds.map((model) => {
      return {
        id: model.id,
        name: model.id,
        default: model.default,
        description: '',
        contextLength: 0,
        maxOutputTokens: 0,
        price: { tokens: 1_000_000, input: '', output: '' },
        priceTier: '$',
        modalities: { input: [], output: [] },
        tools: [],
      }
    }),
  }
}

describe('global default model resolution', () => {
  it('stays gemini-2.5-flash-lite after the direct-provider additions', () => {
    expect(defaultModel).toBe('gemini-2.5-flash-lite')
  })

  it('returns undefined when no model is marked default', () => {
    const providers = [
      buildProvider('a', [{ id: 'a-1' }, { id: 'a-2' }]),
      buildProvider('b', [{ id: 'b-1' }]),
    ]

    expect(resolveDefaultMarkedModel(providers)).toBeUndefined()
  })

  it('picks a default marked on the first provider', () => {
    const providers = [
      buildProvider('a', [{ id: 'a-1' }, { id: 'a-2', default: true }]),
      buildProvider('b', [{ id: 'b-1', default: true }]),
    ]

    expect(resolveDefaultMarkedModel(providers)).toBe('a-2')
  })

  it('lets a later provider default win when no earlier one is marked', () => {
    const providers = [
      buildProvider('a', [{ id: 'a-1' }, { id: 'a-2' }]),
      buildProvider('b', [{ id: 'b-1' }, { id: 'b-2', default: true }]),
    ]

    expect(resolveDefaultMarkedModel(providers)).toBe('b-2')
  })

  it('stops scanning after the first match instead of letting a later '
    + 'provider default silently overwrite it', () => {
    const providers = [
      buildProvider('a', [{ id: 'a-1', default: true }]),
      buildProvider('b', [{ id: 'b-1', default: true }]),
    ]

    expect(resolveDefaultMarkedModel(providers)).toBe('a-1')
  })
})
