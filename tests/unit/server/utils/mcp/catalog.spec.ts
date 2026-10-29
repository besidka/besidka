import { describe, expect, it } from 'vitest'
import { providers } from '~~/providers'
import { listCatalog, toCatalogModel } from '~~/server/utils/mcp/catalog'
import type { Model, Providers } from '#shared/types/providers.d'

function createModel(overrides: Partial<Model> = {}): Model {
  return {
    id: 'model-a',
    name: 'Model A',
    default: true,
    forProjectMemory: true,
    description: 'A model',
    contextLength: 1000,
    maxOutputTokens: 100,
    price: { tokens: 1_000_000, input: '$1.00', output: '$2.00' },
    priceTier: '$',
    modalities: { input: ['text'], output: ['text'] },
    tools: [],
    toolCall: true,
    ...overrides,
  }
}

const fixtureProviders: Providers = [
  {
    id: 'alpha',
    name: 'Alpha',
    models: [
      createModel({ id: 'alpha-1' }),
      createModel({ id: 'alpha-old', status: 'deprecated' }),
    ],
  },
  {
    id: 'beta',
    name: 'Beta',
    models: [createModel({ id: 'beta-1' })],
  },
]

describe('toCatalogModel', () => {
  it('keeps the public capability fields and price with its token unit', () => {
    const catalogModel = toCatalogModel(createModel())

    expect(catalogModel.price).toEqual({
      tokens: 1_000_000,
      input: '$1.00',
      output: '$2.00',
    })
    expect(catalogModel.toolCall).toBe(true)
  })

  it('drops internal curation flags', () => {
    const catalogModel = toCatalogModel(createModel()) as Record<
      string,
      unknown
    >

    expect(catalogModel).not.toHaveProperty('default')
    expect(catalogModel).not.toHaveProperty('forProjectMemory')
    expect(catalogModel).not.toHaveProperty('research')
  })
})

describe('listCatalog', () => {
  it('hides deprecated models by default', () => {
    const catalog = listCatalog(fixtureProviders)
    const alphaModelIds = catalog[0]?.models.map((model) => {
      return model.id
    })

    expect(alphaModelIds).toEqual(['alpha-1'])
  })

  it('includes deprecated models on request', () => {
    const catalog = listCatalog(fixtureProviders, {
      includeDeprecated: true,
    })

    expect(catalog[0]?.models).toHaveLength(2)
  })

  it('filters by provider id', () => {
    const catalog = listCatalog(fixtureProviders, { providerId: 'beta' })

    expect(catalog.map((provider) => {
      return provider.id
    })).toEqual(['beta'])
  })

  it('returns an empty list for an unknown provider id', () => {
    expect(listCatalog(fixtureProviders, { providerId: 'missing' }))
      .toEqual([])
  })

  it('projects the real curated catalog without internal flags', () => {
    const catalog = listCatalog(providers)
    const models = catalog.flatMap((provider) => {
      return provider.models
    })

    expect(catalog.length).toBeGreaterThan(0)
    expect(models.length).toBeGreaterThan(0)
    expect(JSON.stringify(catalog)).not.toContain('forProjectMemory')
  })
})
