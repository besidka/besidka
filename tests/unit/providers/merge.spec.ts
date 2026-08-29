import { describe, expect, it } from 'vitest'
import type {
  CuratedModel,
  ModelSnapshotEntry,
} from '../../../providers/merge'
import { formatPrice, mergeModelMetadata } from '../../../providers/merge'
import { providers } from '../../../providers'
import snapshot from '../../../providers/data/models-dev-snapshot.json'
import { getModelCostMap } from '../../../server/utils/ai/cost-map'

const snapshotEntry: ModelSnapshotEntry = {
  name: 'Fetched Name',
  description: 'Fetched description',
  limit: {
    context: 400_000,
    output: 128_000,
  },
  modalities: {
    input: ['text', 'image', 'pdf'],
    output: ['text'],
  },
  cost: {
    input: 1.25,
    output: 10,
  },
}

const chatModel: CuratedModel = {
  id: 'test-chat-model',
  price: {
    tokens: 1_000_000,
  },
  tools: ['web_search'],
  reasoning: {
    mode: 'levels',
    levels: ['low', 'high'],
  },
}

describe('mergeModelMetadata', () => {
  it('takes objective metadata from the snapshot', () => {
    const model = mergeModelMetadata(chatModel, snapshotEntry)

    expect(model.name).toBe('Fetched Name')
    expect(model.description).toBe('Fetched description')
    expect(model.contextLength).toBe(400_000)
    expect(model.maxOutputTokens).toBe(128_000)
    expect(model.modalities).toEqual(snapshotEntry.modalities)
    expect(model.price.input).toBe('$1.25')
    expect(model.price.output).toBe('$10.00')
  })

  it('takes the release date from the snapshot', () => {
    const model = mergeModelMetadata(chatModel, {
      ...snapshotEntry,
      releaseDate: '2026-04-21',
    })

    expect(model.releaseDate).toBe('2026-04-21')
  })

  it('omits the release date key when the snapshot has none', () => {
    const model = mergeModelMetadata(chatModel, snapshotEntry)

    expect('releaseDate' in model).toBe(false)
  })

  it('keeps curated capabilities and the price token divisor', () => {
    const model = mergeModelMetadata(
      {
        ...chatModel,
        default: true,
        forProjectMemory: true,
      },
      snapshotEntry,
    )

    expect(model.tools).toEqual(['web_search'])
    expect(model.reasoning).toEqual({ mode: 'levels', levels: ['low', 'high'] })
    expect(model.default).toBe(true)
    expect(model.forProjectMemory).toBe(true)
    expect(model.price.tokens).toBe(1_000_000)
  })

  it('keeps the reasoningAlwaysOn flag when curated', () => {
    const model = mergeModelMetadata(
      { ...chatModel, reasoning: undefined, reasoningAlwaysOn: true },
      snapshotEntry,
    )

    expect(model.reasoningAlwaysOn).toBe(true)
  })

  it('omits the reasoningAlwaysOn key entirely when not curated', () => {
    const model = mergeModelMetadata(chatModel, snapshotEntry)

    expect('reasoningAlwaysOn' in model).toBe(false)
  })

  it('keeps curated name, description and price for research models', () => {
    const model = mergeModelMetadata(
      {
        ...chatModel,
        name: 'Curated Deep Research',
        description: 'Cited report for $1–3 per task',
        price: {
          tokens: 1_000_000,
          input: '$1–3 / task',
          output: '',
        },
        research: {
          tier: 'quick',
          assistModel: 'test-chat-model',
          costEstimate: '$1–3 / task',
          timeEstimate: 'under 20 min',
        },
      },
      snapshotEntry,
    )

    expect(model.name).toBe('Curated Deep Research')
    expect(model.description).toBe('Cited report for $1–3 per task')
    expect(model.price.input).toBe('$1–3 / task')
    expect(model.price.output).toBe('')
    expect(model.contextLength).toBe(400_000)
  })

  it('keeps the curated name when the fetched one is the bare model id', () => {
    const model = mergeModelMetadata(
      {
        ...chatModel,
        name: 'Test Chat Model',
      },
      {
        ...snapshotEntry,
        name: 'Test-Chat-Model',
      },
    )

    expect(model.name).toBe('Test Chat Model')
    expect(model.description).toBe('Fetched description')
  })

  it('keeps an explicit curated name over a distinct fetched name', () => {
    const model = mergeModelMetadata(
      {
        ...chatModel,
        name: 'Claude Haiku 4.5',
      },
      {
        ...snapshotEntry,
        name: 'Claude Haiku 4.5 (latest)',
      },
    )

    expect(model.name).toBe('Claude Haiku 4.5')
    expect(model.description).toBe('Fetched description')
  })

  it('falls back to the fetched name when curated sets none', () => {
    const model = mergeModelMetadata(chatModel, {
      ...snapshotEntry,
      name: 'Fetched Only',
    })

    expect(model.name).toBe('Fetched Only')
  })

  it('keeps the curated per-image price display', () => {
    const model = mergeModelMetadata(
      {
        ...chatModel,
        price: {
          tokens: 1,
          display: '$0.039 / 1K image, plus input',
        },
        imageGeneration: {
          controllerModel: 'test-chat-model',
        },
      },
      snapshotEntry,
    )

    expect(model.price.display).toBe('$0.039 / 1K image, plus input')
    expect(model.price.tokens).toBe(1)
    expect(model.price.input).toBe('$1.25')
  })

  it('marks context-tiered pricing so the number reads as a floor', () => {
    const model = mergeModelMetadata(chatModel, {
      ...snapshotEntry,
      tieredPricing: true,
    })

    expect(model.price.input).toBe('from $1.25')
    expect(model.price.output).toBe('from $10.00')
  })

  it('falls back to a fully curated model without a snapshot entry', () => {
    const model = mergeModelMetadata(
      {
        ...chatModel,
        name: 'Curated Only',
        description: 'Not tracked by models.dev',
        contextLength: 200_000,
        maxOutputTokens: 100_000,
        releaseDate: '2025-11-18',
        status: 'deprecated',
        price: {
          tokens: 1_000_000,
          input: '$10.00',
          output: '$40.00',
        },
        modalities: {
          input: ['text'],
          output: ['text'],
        },
      },
      undefined,
    )

    expect(model.name).toBe('Curated Only')
    expect(model.contextLength).toBe(200_000)
    expect(model.price.input).toBe('$10.00')
    expect(model.releaseDate).toBe('2025-11-18')
    expect(model.status).toBe('deprecated')
  })

  it('passes curated status and releaseDate through when there is no snapshot', () => {
    const withStatus = mergeModelMetadata(
      {
        ...chatModel,
        name: 'Retired Legacy',
        description: 'Curated after retirement',
        contextLength: 200_000,
        maxOutputTokens: 100_000,
        releaseDate: '2025-11-18',
        status: 'deprecated',
        modalities: {
          input: ['text'],
          output: ['text'],
        },
      },
      undefined,
    )

    expect(withStatus.releaseDate).toBe('2025-11-18')
    expect(withStatus.status).toBe('deprecated')

    const withoutStatus = mergeModelMetadata(
      {
        ...chatModel,
        name: 'Exempt No Status',
        description: 'Curated, no status or date',
        contextLength: 200_000,
        maxOutputTokens: 100_000,
        modalities: {
          input: ['text'],
          output: ['text'],
        },
      },
      undefined,
    )

    expect('releaseDate' in withoutStatus).toBe(false)
    expect('status' in withoutStatus).toBe(false)
  })

  it('passes curated retiredAt through both merge paths', () => {
    const snapshotBacked = mergeModelMetadata(
      {
        ...chatModel,
        retiredAt: '2027-05-07',
      },
      snapshotEntry,
    )

    expect(snapshotBacked.retiredAt).toBe('2027-05-07')

    const fullyCurated = mergeModelMetadata(
      {
        ...chatModel,
        name: 'Retired Legacy',
        description: 'Curated after retirement',
        contextLength: 200_000,
        maxOutputTokens: 100_000,
        status: 'deprecated',
        retiredAt: '2026-03-09',
        modalities: {
          input: ['text'],
          output: ['text'],
        },
      },
      undefined,
    )

    expect(fullyCurated.retiredAt).toBe('2026-03-09')
  })

  it('omits retiredAt when curated sets none', () => {
    const model = mergeModelMetadata(chatModel, snapshotEntry)

    expect('retiredAt' in model).toBe(false)
  })

  it('lets a hand-set curated status outrank the fetched one', () => {
    const model = mergeModelMetadata(
      {
        ...chatModel,
        status: 'deprecated',
      },
      { ...snapshotEntry, status: 'beta' },
    )

    expect(model.status).toBe('deprecated')
  })

  it('still takes status from the snapshot when curated sets none', () => {
    const model = mergeModelMetadata(
      chatModel,
      { ...snapshotEntry, status: 'alpha' },
    )

    expect(model.status).toBe('alpha')
  })

  it('throws when a model has neither a snapshot entry nor full curation', () => {
    expect(() => mergeModelMetadata(chatModel, undefined))
      .toThrowError(/test-chat-model/)
  })
})

describe('price tiers', () => {
  it.each([
    [0.05, '$'],
    [0.5, '$'],
    [0.75, '$$'],
    [2, '$$'],
    [2.5, '$$$'],
    [5, '$$$'],
    [12, '$$$+'],
  ])('maps $%s per million input tokens to %s', (input, tier) => {
    const model = mergeModelMetadata(chatModel, {
      ...snapshotEntry,
      cost: {
        input,
        output: input * 4,
      },
    })

    expect(model.priceTier).toBe(tier)
  })

  it.each([
    ['~$1 / task', '$$'],
    ['$1–3 / task', '$$$'],
    ['$3–7 / task', '$$$'],
    ['~$10 / task', '$$$+'],
  ])('maps the %s research estimate to %s', (costEstimate, tier) => {
    const model = mergeModelMetadata(
      {
        ...chatModel,
        research: {
          tier: 'quick',
          assistModel: 'test-chat-model',
          costEstimate,
          timeEstimate: 'under 20 min',
        },
      },
      snapshotEntry,
    )

    expect(model.priceTier).toBe(tier)
  })

  it.each([
    ['$0.0336 / 1K image, plus input', '$'],
    ['$0.039 / 1K image, plus input', '$'],
    ['$0.041–$0.053 / medium image, plus input', '$$'],
    ['$0.067 / 1K image, plus input', '$$'],
    ['$0.134 / 1K or 2K image, plus input', '$$$'],
  ])(
    'maps the per-image price display %s to %s regardless of per-token cost',
    (display, tier) => {
      const model = mergeModelMetadata(
        {
          ...chatModel,
          price: {
            tokens: 1,
            display,
          },
          imageGeneration: {
            controllerModel: 'test-chat-model',
          },
        },
        {
          ...snapshotEntry,
          cost: {
            input: 5,
            output: 30,
          },
        },
      )

      expect(model.priceTier).toBe(tier)
    },
  )

  it('ranks gpt-image-2 cheaper than Nano Banana Pro by per-image price', () => {
    const gptImage2 = mergeModelMetadata(
      {
        ...chatModel,
        price: {
          tokens: 1,
          display: '$0.041–$0.053 / medium image, plus input',
        },
        imageGeneration: {
          controllerModel: 'test-chat-model',
        },
      },
      {
        ...snapshotEntry,
        cost: {
          input: 5,
          output: 30,
        },
      },
    )
    const nanoBananaPro = mergeModelMetadata(
      {
        ...chatModel,
        price: {
          tokens: 1,
          display: '$0.134 / 1K or 2K image, plus input',
        },
        imageGeneration: {
          controllerModel: 'test-chat-model',
        },
      },
      {
        ...snapshotEntry,
        cost: {
          input: 2,
          output: 120,
        },
      },
    )

    expect(gptImage2.priceTier).toBe('$$')
    expect(nanoBananaPro.priceTier).toBe('$$$')
  })
})

describe('formatPrice', () => {
  it('keeps sub-cent precision instead of rounding to two decimals', () => {
    expect(formatPrice(0.075)).toBe('$0.075')
    expect(formatPrice(0.005)).toBe('$0.005')
    expect(formatPrice(0.3)).toBe('$0.30')
    expect(formatPrice(12)).toBe('$12.00')
  })
})

describe('merged catalog', () => {
  const snapshotEntries: Record<string, { input: number, output: number }>
    = Object.fromEntries(
      Object.entries(snapshot).map(([id, entry]) => {
        return [id, entry.cost]
      }),
    )

  it('bills every per-token model at its exact fetched cost', () => {
    const costMap = getModelCostMap()

    for (const provider of providers) {
      for (const model of provider.models) {
        const cost = snapshotEntries[model.id]

        if (!cost || model.research || model.price.tokens !== 1_000_000) {
          continue
        }

        expect(costMap[model.id]).toEqual(cost)
      }
    }
  })

  it('carries a release date for snapshot-backed and curated-only models', () => {
    for (const provider of providers) {
      for (const model of provider.models) {
        const entry = snapshot[model.id as keyof typeof snapshot]

        if (!entry) {
          // Fully curated exempt models (e.g. deep-research ids, retired
          // legacy ids) may carry a curated releaseDate; if present it
          // must still be a valid date.
          if ('releaseDate' in model) {
            expect(model.releaseDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
          }

          continue
        }

        expect(model.releaseDate).toBe(entry.releaseDate)
        expect(model.releaseDate).toMatch(/^\d{4}-\d{2}(-\d{2})?$/)
      }
    }
  })

  it('gives every model a complete, displayable shape', () => {
    for (const provider of providers) {
      for (const model of provider.models) {
        expect(model.name).toBeTruthy()
        expect(model.description).toBeTruthy()
        expect(model.priceTier).toMatch(/^\$+\+?$/)
        expect(model.modalities.input.length).toBeGreaterThan(0)
        expect(model.modalities.output.length).toBeGreaterThan(0)
      }
    }
  })

  it('never displays a models.dev alias-tracking suffix like "(latest)"', () => {
    for (const provider of providers) {
      for (const model of provider.models) {
        expect(model.name).not.toMatch(/\(latest\)/i)
      }
    }
  })
})
