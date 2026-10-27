import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { computed } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GatewayModel } from '../../../shared/types/gateways.d'
import type { ModelSelection } from '../../../shared/types/model-selection.d'
import { useKnowledgeModelContext } from '../../../app/composables/project-knowledge-model'

const mocks = vi.hoisted(() => ({
  selection: { value: null as unknown },
  gatewayModel: { value: null as unknown },
  name: { value: 'Model' },
  models: {} as Record<string, unknown>,
}))

mockNuxtImport('useSelectedModelInfo', () => () => ({
  selection: computed(() => mocks.selection.value),
  gatewayModel: computed(() => mocks.gatewayModel.value),
  name: computed(() => mocks.name.value),
}))
mockNuxtImport('getModel', () => (modelId: string) => {
  return mocks.models[modelId] ?? {
    modelName: 'Select Model',
    model: null,
    provider: null,
  }
})

function registerDirect(
  providerId: string,
  model: Record<string, unknown>,
) {
  mocks.models[model.id as string] = {
    modelName: model.name,
    model,
    provider: { id: providerId, name: providerId },
  }
}

function selectProvider(modelId: string, name: string) {
  mocks.selection.value = { source: 'provider', modelId }
  mocks.name.value = name
}

function selectGateway(
  gatewayId: 'vercel' | 'cloudflare' | 'openrouter',
  modelId: string,
  gatewayModel: GatewayModel | null,
) {
  mocks.selection.value = {
    source: 'gateway',
    gatewayId,
    modelId,
  } satisfies ModelSelection
  mocks.gatewayModel.value = gatewayModel
  mocks.name.value = gatewayModel?.name ?? modelId
}

describe('useKnowledgeModelContext', () => {
  beforeEach(() => {
    mocks.models = {}
    mocks.gatewayModel.value = null
    registerDirect('anthropic', {
      id: 'claude-test',
      name: 'Claude Test',
      contextLength: 1_000_000,
      maxOutputTokens: 64_000,
      price: {
        tokens: 1_000_000,
        input: '$3.00',
        output: '$15.00',
        cacheRead: 0.3,
        cacheWrite: 3.75,
      },
      modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
    })
    registerDirect('moonshotai', {
      id: 'kimi-test',
      name: 'Kimi Test',
      contextLength: 262_144,
      maxOutputTokens: 32_768,
      price: { tokens: 1_000_000, input: '$0.60', output: '$2.50' },
      modalities: { input: ['text'], output: ['text'] },
    })
  })

  it('reads a direct model from the catalog', () => {
    selectProvider('claude-test', 'Claude Test')

    const context = useKnowledgeModelContext()

    expect(context.value).toEqual({
      name: 'Claude Test',
      family: 'anthropic',
      contextWindow: 1_000_000,
      maxOutputTokens: 64_000,
      acceptsImages: true,
      acceptsPdf: true,
      inputPrice: 3,
      cacheReadPrice: 0.3,
      isCachingAvailable: true,
    })
  })

  it('has no cache read price when the catalog publishes none', () => {
    selectProvider('kimi-test', 'Kimi Test')

    const context = useKnowledgeModelContext()

    expect(context.value.family).toBe('moonshotai')
    expect(context.value.cacheReadPrice).toBeNull()
    expect(context.value.acceptsImages).toBe(false)
    expect(context.value.acceptsPdf).toBe(false)
    expect(context.value.inputPrice).toBe(0.6)
  })

  it('normalizes a price quoted per another token unit', () => {
    registerDirect('openai', {
      id: 'per-thousand',
      name: 'Per Thousand',
      contextLength: 128_000,
      maxOutputTokens: 4096,
      price: { tokens: 1000, input: '$0.002', output: '$0.004' },
      modalities: { input: ['text'], output: ['text'] },
    })
    selectProvider('per-thousand', 'Per Thousand')

    expect(useKnowledgeModelContext().value.inputPrice).toBeCloseTo(2)
  })

  it('treats an unknown direct model as an unknown window', () => {
    selectProvider('missing', 'Missing')

    const context = useKnowledgeModelContext()

    expect(context.value.contextWindow).toBeNull()
    expect(context.value.inputPrice).toBeNull()
    expect(context.value.family).toBe('default')
  })

  it('reads a gateway model from the cached catalog, text only', () => {
    selectGateway('openrouter', 'anthropic/claude-sonnet', {
      id: 'anthropic/claude-sonnet',
      name: 'Claude Sonnet',
      contextLength: 200_000,
      maxOutputTokens: 8000,
      pricing: { input: '0.000003', output: '0.000015' },
      modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
      toolCall: true,
    })

    const context = useKnowledgeModelContext()

    expect(context.value).toEqual({
      name: 'Claude Sonnet',
      family: 'anthropic',
      contextWindow: 200_000,
      maxOutputTokens: 8000,
      acceptsImages: false,
      acceptsPdf: false,
      inputPrice: 3,
      cacheReadPrice: null,
      isCachingAvailable: true,
    })
  })

  it('has an unknown window until the gateway catalog is cached', () => {
    selectGateway('vercel', 'vendor/model', null)

    const context = useKnowledgeModelContext()

    expect(context.value.name).toBe('vendor/model')
    expect(context.value.contextWindow).toBeNull()
    expect(context.value.inputPrice).toBeNull()
    expect(context.value.family).toBe('default')
  })

  it('marks Cloudflare AI Gateway as having no caching', () => {
    selectGateway('cloudflare', 'openai/gpt-test', null)

    expect(useKnowledgeModelContext().value.isCachingAvailable).toBe(false)
  })

  it('follows the selection when it changes', () => {
    selectProvider('claude-test', 'Claude Test')
    mocks.selection.value = { source: 'provider', modelId: 'claude-test' }

    const context = useKnowledgeModelContext()

    expect(context.value.name).toBe('Claude Test')
  })
})
