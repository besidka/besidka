import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GatewayModel } from '#shared/types/gateways.d'
import type { Model } from '#shared/types/providers.d'
import {
  isMemoryGatewayModelSelectable,
  isMemoryModelSelectable,
} from '../../../app/utils/memory-model-filter'

function createModel(overrides: Partial<Model> = {}): Model {
  return {
    id: 'text-model',
    name: 'Text model',
    description: 'A text model',
    contextLength: 1000,
    maxOutputTokens: 100,
    price: { tokens: 1000000, input: '1', output: '2' },
    priceTier: '$',
    modalities: { input: ['text'], output: ['text'] },
    tools: [],
    toolCall: true,
    ...overrides,
  }
}

function createGatewayModel(
  overrides: Partial<GatewayModel> = {},
): GatewayModel {
  return {
    id: 'vendor/model',
    name: 'Gateway model',
    toolCall: true,
    ...overrides,
  }
}

describe('isMemoryModelSelectable', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-25T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('accepts a plain text model', () => {
    expect(isMemoryModelSelectable(createModel())).toBe(true)
  })

  it('rejects a model without text output', () => {
    const model = createModel({
      modalities: { input: ['text'], output: ['image'] },
    })

    expect(isMemoryModelSelectable(model)).toBe(false)
  })

  it('rejects image generation models', () => {
    const model = createModel({
      imageGeneration: { controllerModel: 'controller' },
    })

    expect(isMemoryModelSelectable(model)).toBe(false)
  })

  it('rejects deep research models', () => {
    const model = createModel({
      research: {
        tier: 'thorough',
        assistModel: 'assist-model',
        costEstimate: '$1',
        timeEstimate: '10 min',
      },
    })

    expect(isMemoryModelSelectable(model)).toBe(false)
  })

  it('rejects models retired on or before today', () => {
    expect(isMemoryModelSelectable(createModel({
      retiredAt: '2026-10-25',
    }))).toBe(false)
    expect(isMemoryModelSelectable(createModel({
      retiredAt: '2026-01-01',
    }))).toBe(false)
  })

  it('accepts models retiring in the future', () => {
    expect(isMemoryModelSelectable(createModel({
      retiredAt: '2027-05-07',
    }))).toBe(true)
  })
})

describe('isMemoryGatewayModelSelectable', () => {
  it('accepts a gateway model without modality data', () => {
    expect(isMemoryGatewayModelSelectable(createGatewayModel())).toBe(true)
  })

  it('accepts a gateway model with text output', () => {
    const model = createGatewayModel({
      modalities: { input: ['text'], output: ['text'] },
    })

    expect(isMemoryGatewayModelSelectable(model)).toBe(true)
  })

  it('rejects a gateway model without text output', () => {
    const model = createGatewayModel({
      modalities: { input: ['text'], output: ['image'] },
    })

    expect(isMemoryGatewayModelSelectable(model)).toBe(false)
  })

  it('rejects a gateway image generation model', () => {
    const model = createGatewayModel({
      supportsImageGeneration: true,
      modalities: { input: ['text'], output: ['text', 'image'] },
    })

    expect(isMemoryGatewayModelSelectable(model)).toBe(false)
  })
})
