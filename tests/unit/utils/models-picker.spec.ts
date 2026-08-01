import { describe, expect, it } from 'vitest'
import type { Model, ModelPriceTier } from '#shared/types/providers.d'
import {
  formatModelTokenLimit,
  formatReleaseDate,
  getModelCategory,
  getModelPriceTip,
  getPriceTierClass,
  getPriceTierTooltipClass,
  hasImageGenerationCapability,
  modelCategoryOptions,
} from '../../../app/utils/models-picker'

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

describe('getPriceTierTooltipClass', () => {
  it('maps every price tier to a semantic tooltip color', () => {
    expect(getPriceTierTooltipClass('$')).toBe('tooltip-success')
    expect(getPriceTierTooltipClass('$$')).toBe('tooltip-info')
    expect(getPriceTierTooltipClass('$$$')).toBe('tooltip-warning')
    expect(getPriceTierTooltipClass('$$$+')).toBe('tooltip-error')
  })

  it('falls back to the cheapest tooltip color for an unmapped tier', () => {
    expect(getPriceTierTooltipClass('$$$$' as ModelPriceTier))
      .toBe('tooltip-success')
  })

  it('keeps the tooltip color in lockstep with the badge color', () => {
    const tiers: ModelPriceTier[] = ['$', '$$', '$$$', '$$$+']

    for (const tier of tiers) {
      const badgeColor = getPriceTierClass(tier).replace('badge-', '')
      const tooltipColor = getPriceTierTooltipClass(tier)
        .replace('tooltip-', '')

      expect(tooltipColor).toBe(badgeColor)
    }
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
