import { describe, expect, it } from 'vitest'
import type { Model } from '#shared/types/providers.d'
import { providers } from '../../../../providers'
import { isUsableMemoryCatalogModel } from '../../../../server/utils/memory/catalog-usability'

const deepResearchModelId = 'deep-research-preview-04-2026'

function findCatalogModel(providerId: string, modelId: string): Model {
  const model = providers
    .find((provider) => {
      return provider.id === providerId
    })
    ?.models.find((candidate) => {
      return candidate.id === modelId
    })

  if (!model) {
    throw new Error(`Catalog model ${providerId}/${modelId} not found`)
  }

  return model as Model
}

const openAiMemoryModel = findCatalogModel('openai', 'gpt-6-luna')

describe('isUsableMemoryCatalogModel', () => {
  const textModel = openAiMemoryModel

  it('accepts a plain text catalog model', () => {
    expect(isUsableMemoryCatalogModel(textModel)).toBe(true)
  })

  it('rejects a model without text output', () => {
    expect(isUsableMemoryCatalogModel({
      ...textModel,
      modalities: { input: ['text'], output: ['image'] },
    })).toBe(false)
  })

  it('rejects deep-research and image-generation models', () => {
    expect(isUsableMemoryCatalogModel(
      findCatalogModel('google', deepResearchModelId),
    )).toBe(false)
    expect(isUsableMemoryCatalogModel(
      findCatalogModel('google', 'gemini-3.1-flash-image'),
    )).toBe(false)
  })

  it('rejects a model whose retirement date has passed', () => {
    expect(isUsableMemoryCatalogModel({
      ...textModel,
      retiredAt: '2000-01-01',
    })).toBe(false)
  })

  it('accepts a deprecated model that retires in the future', () => {
    expect(isUsableMemoryCatalogModel({
      ...textModel,
      status: 'deprecated',
      retiredAt: '2999-01-01',
    })).toBe(true)
  })

  it('accepts a deprecated model with no retirement date', () => {
    expect(isUsableMemoryCatalogModel({
      ...textModel,
      status: 'deprecated',
    })).toBe(true)
  })
})
