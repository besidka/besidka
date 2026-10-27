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

  it('accepts vision capable chat models', () => {
    const model = createModel({
      modalities: { input: ['text', 'image'], output: ['text'] },
    })

    expect(isMemoryModelSelectable(model)).toBe(true)
  })

  it('accepts a curated chat model that can also speak, like Qwen Omni', () => {
    const model = createModel({
      modalities: {
        input: ['text', 'image', 'audio'],
        output: ['text', 'audio'],
      },
    })

    expect(isMemoryModelSelectable(model)).toBe(true)
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

  it('rejects a model that cannot take text input', () => {
    const model = createGatewayModel({
      modalities: { input: ['audio'], output: ['text'] },
    })

    expect(isMemoryGatewayModelSelectable(model)).toBe(false)
  })

  it('accepts a vision gateway model', () => {
    const model = createGatewayModel({
      modalities: { input: ['text', 'image'], output: ['text'] },
    })

    expect(isMemoryGatewayModelSelectable(model)).toBe(true)
  })

  it.each([
    [['audio'], 'audio only'],
    [['image'], 'image only'],
    [['embeddings'], 'embeddings only'],
    [['text', 'audio'], 'text with audio'],
    [['text', 'image'], 'text with image'],
    [['text', 'audio', 'image'], 'text with audio and image'],
    [['audio', 'text'], 'audio listed before text'],
    [['video'], 'video only'],
  ])('rejects declared output %j (%s)', (output) => {
    const model = createGatewayModel({
      id: 'openai/gpt-audio',
      name: 'OpenAI: GPT Audio',
      modalities: { input: ['text', 'audio'], output },
    })

    expect(isMemoryGatewayModelSelectable(model)).toBe(false)
  })

  it('keeps a plain text output model with rich inputs', () => {
    const model = createGatewayModel({
      id: 'google/gemini-3.1-flash-lite',
      modalities: {
        input: ['text', 'image', 'audio', 'video', 'file'],
        output: ['text'],
      },
    })

    expect(isMemoryGatewayModelSelectable(model)).toBe(true)
  })

  it('rejects OpenRouter GPT Audio and GPT Audio Mini with declared output', () => {
    const output = ['text', 'audio']

    expect(isMemoryGatewayModelSelectable(createGatewayModel({
      id: 'openai/gpt-audio',
      name: 'OpenAI: GPT Audio',
      modalities: { input: ['audio', 'text'], output },
    }))).toBe(false)
    expect(isMemoryGatewayModelSelectable(createGatewayModel({
      id: 'openai/gpt-audio-mini',
      name: 'OpenAI: GPT Audio Mini',
      modalities: { input: ['audio', 'text'], output },
    }))).toBe(false)
  })

  it('rejects a gateway model declaring an empty output list', () => {
    const model = createGatewayModel({
      modalities: { input: ['text'], output: [] },
    })

    expect(isMemoryGatewayModelSelectable(model)).toBe(false)
  })

  it.each([
    ['@cf/baai/bge-large-en-v1.5-embedding', 'BGE embedding'],
    ['@cf/openai/whisper', 'Whisper'],
    ['vendor/rerank-v3', 'Rerank'],
    ['vendor/tts-1', 'TTS'],
    ['vendor/model', 'Text to speech'],
    ['vendor/omni-moderation', 'Moderation'],
    ['@cf/stabilityai/stable-diffusion-xl', 'Stable Diffusion'],
    ['openai/gpt-audio', 'OpenAI: GPT Audio'],
    ['openai/gpt-audio-mini', 'OpenAI: GPT Audio Mini'],
    ['vendor/model', 'Vendor Audio Chat'],
  ])('rejects %s without modality data by name', (id, name) => {
    expect(isMemoryGatewayModelSelectable(createGatewayModel({ id, name })))
      .toBe(false)
  })

  it('trusts declared modalities over the id pattern', () => {
    const model = createGatewayModel({
      id: 'vendor/speech-chat',
      modalities: { input: ['text'], output: ['text'] },
    })

    expect(isMemoryGatewayModelSelectable(model)).toBe(true)
  })

  it('keeps ordinary chat names that merely resemble the patterns', () => {
    const model = createGatewayModel({
      id: 'vendor/embedded-assistant-chat',
      name: 'Assistant',
    })

    expect(isMemoryGatewayModelSelectable(model)).toBe(true)
  })

  it.each([
    ['vendor/claudio-chat', 'Claudio Chat'],
    ['vendor/audiobook-writer', 'Audiobook Writer'],
    ['anthropic/claude-haiku-5.5', 'Anthropic: Claude Haiku 5.5'],
    ['openai/gpt-6-luna', 'OpenAI: GPT-6 Luna'],
    ['qwen/qwen3.8-flash', 'Qwen: Qwen3.8 Flash'],
  ])('keeps the chat model %s when no modalities are declared', (id, name) => {
    expect(isMemoryGatewayModelSelectable(createGatewayModel({ id, name })))
      .toBe(true)
  })

  it('trusts declared plain text output over an audio token in the name', () => {
    const model = createGatewayModel({
      id: 'vendor/audio-describer',
      name: 'Audio Describer',
      modalities: { input: ['text'], output: ['text'] },
    })

    expect(isMemoryGatewayModelSelectable(model)).toBe(true)
  })
})
