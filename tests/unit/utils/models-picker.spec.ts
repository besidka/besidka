import { describe, expect, it } from 'vitest'
import type { GatewayModel } from '#shared/types/gateways.d'
import type { Model, ModelPriceTier } from '#shared/types/providers.d'
import {
  countSelectableModels,
  formatGatewayPriceDetail,
  formatModelCount,
  formatModelTokenLimit,
  formatRailCount,
  formatReleaseDate,
  gatewayModelCategoryOptions,
  getGatewayProviderGroups,
  getModelCategory,
  getModelPriceTip,
  getPriceTierClass,
  hasImageGenerationCapability,
  modelCategoryOptions,
  sortGatewayModelsByProvider,
} from '../../../app/utils/models-picker'

function createGatewayModel(id: string, name: string): GatewayModel {
  return { id, name }
}

function createModel(overrides: Partial<Model> = {}): Model {
  return {
    id: 'gpt-5.4',
    name: 'GPT-5.4',
    description: 'Flagship chat model',
    contextLength: 400_000,
    maxOutputTokens: 128_000,
    price: {
      tokens: 1_000_000,
      input: 'from $2.50',
      output: 'from $15.00',
    },
    priceTier: '$$',
    modalities: {
      input: ['text', 'image'],
      output: ['text'],
    },
    tools: ['web_search'],
    ...overrides,
  }
}

const research = {
  tier: 'quick',
  assistModel: 'gpt-5.4-nano',
  costEstimate: '~$1 / task',
  timeEstimate: '5–15 min',
} as const

describe('getModelCategory', () => {
  it('categorises a plain chat model as chat', () => {
    expect(getModelCategory(createModel())).toBe('chat')
  })

  it('categorises a research model as research', () => {
    const model = createModel({ research })

    expect(getModelCategory(model)).toBe('research')
  })

  it('categorises a model with the imageGeneration field as image generation', () => {
    const model = createModel({
      tools: [],
      imageGeneration: { controllerModel: 'gpt-5-nano' },
    })

    expect(getModelCategory(model)).toBe('image-generation')
  })

  it('keeps a chat model that merely offers the image_generation tool in chat', () => {
    const model = createModel({ tools: ['image_generation'] })

    expect(getModelCategory(model)).toBe('chat')
    expect(hasImageGenerationCapability(model)).toBe(true)
  })

  it('prefers research over image generation when both are set', () => {
    const model = createModel({
      research,
      imageGeneration: { controllerModel: 'gpt-5-nano' },
    })

    expect(getModelCategory(model)).toBe('research')
  })
})

describe('hasImageGenerationCapability', () => {
  it('is true for a chat model that exposes the image_generation tool', () => {
    const model = createModel({ tools: ['image_generation'] })

    expect(hasImageGenerationCapability(model)).toBe(true)
  })

  it('is true for a purpose-built image model without the tool', () => {
    const model = createModel({
      tools: [],
      imageGeneration: { controllerModel: 'gemini-2.5-flash-lite' },
    })

    expect(hasImageGenerationCapability(model)).toBe(true)
  })

  it('is true when the tool and the imageGeneration field are both set', () => {
    const model = createModel({
      tools: ['image_generation'],
      imageGeneration: { controllerModel: 'gemini-2.5-flash-lite' },
    })

    expect(hasImageGenerationCapability(model)).toBe(true)
  })

  it('is false when neither the tool nor the field is present', () => {
    expect(hasImageGenerationCapability(createModel())).toBe(false)
  })
})

describe('getPriceTierClass', () => {
  it('maps every price tier to a semantic badge color', () => {
    expect(getPriceTierClass('$')).toBe('badge-success')
    expect(getPriceTierClass('$$')).toBe('badge-info')
    expect(getPriceTierClass('$$$')).toBe('badge-warning')
    expect(getPriceTierClass('$$$+')).toBe('badge-error')
  })

  it('falls back to the cheapest badge for an unmapped tier', () => {
    expect(getPriceTierClass('$$$$' as ModelPriceTier))
      .toBe('badge-success')
  })
})

describe('getModelPriceTip', () => {
  it('joins the research cost and time estimates', () => {
    const model = createModel({ research })

    expect(getModelPriceTip(model)).toBe('~$1 / task · 5–15 min')
  })

  it('prefers the research estimate over a price display string', () => {
    const model = createModel({
      research,
      price: { tokens: 1, input: '$1', output: '$2', display: '$3 / image' },
    })

    expect(getModelPriceTip(model)).toBe('~$1 / task · 5–15 min')
  })

  it('uses the price display string when there is one', () => {
    const model = createModel({
      price: {
        tokens: 1,
        input: '$0.30',
        output: '$30.00',
        display: '$0.039 / image',
      },
    })

    expect(getModelPriceTip(model)).toBe('$0.039 / image')
  })

  it('joins input and output prices when both are set', () => {
    expect(getModelPriceTip(createModel()))
      .toBe('from $2.50 / from $15.00')
  })

  it('returns only the input price when there is no output price', () => {
    const model = createModel({
      price: { tokens: 1_000_000, input: '$0.10', output: '' },
    })

    expect(getModelPriceTip(model)).toBe('$0.10')
  })

  it('returns undefined when neither price is set', () => {
    const model = createModel({
      price: { tokens: 1_000_000, input: '', output: '' },
    })

    expect(getModelPriceTip(model)).toBeUndefined()
  })
})

describe('formatModelTokenLimit', () => {
  it('groups thousands and appends the unit', () => {
    expect(formatModelTokenLimit(1_048_576)).toBe('1,048,576 tokens')
    expect(formatModelTokenLimit(32_768)).toBe('32,768 tokens')
    expect(formatModelTokenLimit(1)).toBe('1 tokens')
  })

  it('returns an empty string for a zero limit so callers drop the row', () => {
    expect(formatModelTokenLimit(0)).toBe('')
  })
})

describe('formatReleaseDate', () => {
  it('formats an ISO date as a short month and year', () => {
    expect(formatReleaseDate('2026-05-01')).toBe('May 2026')
    expect(formatReleaseDate('2026-12-31')).toBe('Dec 2026')
  })

  it('keeps the first of the month in its own month across timezones', () => {
    expect(formatReleaseDate('2026-01-01')).toBe('Jan 2026')
  })

  it('formats a year-month value without a day', () => {
    expect(formatReleaseDate('2026-07')).toBe('Jul 2026')
  })

  it('returns the input unchanged when the month is out of range', () => {
    expect(formatReleaseDate('2026-13-01')).toBe('2026-13-01')
    expect(formatReleaseDate('2026-00-01')).toBe('2026-00-01')
  })

  it('returns the input unchanged when it is not a date', () => {
    expect(formatReleaseDate('not-a-date')).toBe('not-a-date')
    expect(formatReleaseDate('')).toBe('')
  })
})

describe('modelCategoryOptions', () => {
  it('lists chat, deep research and image generation in that order', () => {
    expect(modelCategoryOptions).toEqual([
      { value: 'chat', label: 'Chat', icon: 'lucide:message-square' },
      { value: 'research', label: 'Deep research', icon: 'lucide:telescope' },
      {
        value: 'image-generation',
        label: 'Image generation',
        icon: 'lucide:image-plus',
      },
    ])
  })

  it('offers a filter option for every category getModelCategory returns', () => {
    const categories = [
      getModelCategory(createModel()),
      getModelCategory(createModel({ research })),
      getModelCategory(createModel({
        imageGeneration: { controllerModel: 'gpt-5-nano' },
      })),
    ]
    const optionValues = modelCategoryOptions.map((option) => {
      return option.value
    })

    for (const category of categories) {
      expect(optionValues).toContain(category)
    }
  })
})

describe('gateway pricing', () => {
  it('absorbs the float error the scale-up introduces', () => {
    expect(Number('0.0000029') * 1_000_000).toBe(2.9000000000000004)
    expect(formatGatewayPriceDetail({ input: '0.0000029', output: '0.0000029' }))
      .toBe('$2.90 in / $2.90 out per 1M tokens')
  })

  it('keeps sub-dollar prices readable', () => {
    expect(
      formatGatewayPriceDetail({ input: '0.00000005', output: '0.0000002' }),
    ).toBe('$0.050 in / $0.200 out per 1M tokens')
  })

  it('labels a zero-cost model as free', () => {
    expect(formatGatewayPriceDetail({ input: '0', output: '0' })).toBe('Free')
  })

  it('spells out the unit in the detail form', () => {
    expect(formatGatewayPriceDetail({ input: '0.0000025', output: '0.00001' }))
      .toBe('$2.50 in / $10.00 out per 1M tokens')
  })

  it('returns nothing when pricing is missing or unparseable', () => {
    expect(formatGatewayPriceDetail(undefined)).toBeUndefined()
    expect(formatGatewayPriceDetail({ input: 'n/a', output: '0.001' }))
      .toBeUndefined()
  })
})

describe('gateway provider grouping', () => {
  const catalog = [
    createGatewayModel('openai/gpt-5.4', 'GPT-5.4'),
    createGatewayModel('anthropic/claude-opus-5', 'Claude Opus 5'),
    createGatewayModel('openai/gpt-5.4-mini', 'GPT-5.4 mini'),
    createGatewayModel('zzz-labs/only-model', 'Only model'),
    createGatewayModel('anthropic/claude-haiku-4.5', 'Claude Haiku 4.5'),
    createGatewayModel('aaa-labs/only-model', 'Only model'),
  ]

  it('counts models per underlying provider, most stocked first', () => {
    expect(getGatewayProviderGroups(catalog)).toEqual([
      { prefix: 'anthropic', count: 2 },
      { prefix: 'openai', count: 2 },
      { prefix: 'aaa-labs', count: 1 },
      { prefix: 'zzz-labs', count: 1 },
    ])
  })

  it('treats an id without a separator as its own provider', () => {
    const groups = getGatewayProviderGroups([
      createGatewayModel('@cf/meta/llama-4', 'Llama 4'),
      createGatewayModel('bare-model-id', 'Bare'),
    ])

    expect(groups).toEqual([
      { prefix: 'bare-model-id', count: 1 },
      { prefix: 'meta', count: 1 },
    ])
  })

  it('groups a Cloudflare-style catalog by real vendor, not the shared '
    + '@cf namespace segment', () => {
    const groups = getGatewayProviderGroups([
      createGatewayModel('@cf/meta/llama-4', 'Llama 4'),
      createGatewayModel('@cf/meta/llama-3.1-8b', 'Llama 3.1 8B'),
      createGatewayModel('@cf/google/gemma-3-12b-it', 'Gemma 3 12B'),
      createGatewayModel('@cf/mistralai/mistral-small-3.1', 'Mistral Small'),
    ])

    expect(groups).toEqual([
      { prefix: 'meta', count: 2 },
      { prefix: 'google', count: 1 },
      { prefix: 'mistralai', count: 1 },
    ])
  })

  it('clusters models by provider, then by name inside a cluster', () => {
    expect(sortGatewayModelsByProvider(catalog).map((model) => {
      return model.id
    })).toEqual([
      'anthropic/claude-haiku-4.5',
      'anthropic/claude-opus-5',
      'openai/gpt-5.4',
      'openai/gpt-5.4-mini',
      'aaa-labs/only-model',
      'zzz-labs/only-model',
    ])
  })

  it('leaves the source catalog untouched', () => {
    const source = [...catalog]

    sortGatewayModelsByProvider(source)

    expect(source.map((model) => {
      return model.id
    })).toEqual(catalog.map((model) => {
      return model.id
    }))
  })

  it('offers only the free category in gateway mode', () => {
    expect(gatewayModelCategoryOptions.map((option) => {
      return option.value
    })).toEqual(['free'])
    expect(gatewayModelCategoryOptions[0]?.icon).toBe('lucide:banknote-x')
  })
})

describe('rail count badges', () => {
  function createRailModel(id: string, status?: Model['status']): Model {
    return { id, name: id, status } as Model
  }

  it('counts the models the picker will actually list', () => {
    expect(countSelectableModels([
      createRailModel('one'),
      createRailModel('two', 'beta'),
      createRailModel('three', 'deprecated'),
    ])).toBe(2)
  })

  it('counts nothing for an empty catalog', () => {
    expect(countSelectableModels([])).toBe(0)
  })

  it('prints a small count as-is', () => {
    expect(formatRailCount(0)).toBe('0')
    expect(formatRailCount(7)).toBe('7')
    expect(formatRailCount(99)).toBe('99')
  })

  it('caps anything past two digits so the badge stays narrow', () => {
    expect(formatRailCount(100)).toBe('99+')
    expect(formatRailCount(412)).toBe('99+')
  })

  it('spells the count out with a matching unit', () => {
    expect(formatModelCount(1)).toBe('1 model')
    expect(formatModelCount(0)).toBe('0 models')
    expect(formatModelCount(95)).toBe('95 models')
  })
})
