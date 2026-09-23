import type { GatewayModel } from '#shared/types/gateways.d'
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, shallowRef } from 'vue'
import { providerMeta } from '#shared/utils/provider-meta'
import { useChatInput } from '../../../app/composables/chat-input'
import { defaultModel, providers } from '../../../providers'

const noToolCallReason = 'This model does not support tool calling, so it '
  + 'cannot use an external search provider.'

function defaultModelProviderLabel(): string {
  for (const provider of providers) {
    if (provider.models.some(model => model.id === defaultModel)) {
      return providerMeta[provider.id]?.label ?? provider.id
    }
  }

  return 'this provider'
}

const mocks = vi.hoisted(() => ({
  useUserKeys: vi.fn(),
  fetch: vi.fn(),
}))

mockNuxtImport('useUserKeys', () => mocks.useUserKeys)
mockNuxtImport('$fetch', () => mocks.fetch)

function flushPromises() {
  return Promise.resolve()
}

const keyedProviderIds = shallowRef<string[]>([])

function createHost() {
  return defineComponent({
    setup() {
      const chatInput = useChatInput()

      return () => h('div', [
        h('span', { 'data-testid': 'is-selected-model-keyless' }, [
          String(chatInput.isSelectedModelKeyless.value),
        ]),
        h('span', { 'data-testid': 'selected-model-key-owner-label' }, [
          chatInput.selectedModelKeyOwnerLabel.value,
        ]),
        h('span', { 'data-testid': 'is-image-generation-supported' }, [
          String(chatInput.isImageGenerationSupported.value),
        ]),
        h('span', { 'data-testid': 'is-image-generation-required' }, [
          String(chatInput.isImageGenerationRequired.value),
        ]),
        h('span', { 'data-testid': 'is-web-search-supported' }, [
          String(chatInput.isWebSearchSupported.value),
        ]),
        h('span', { 'data-testid': 'is-tool-calling-supported' }, [
          String(chatInput.isToolCallingSupported.value),
        ]),
        h('span', { 'data-testid': 'web-search-options' }, [
          JSON.stringify(chatInput.webSearchProviderOptions.value),
        ]),
        h('span', { 'data-testid': 'is-reasoning-supported' }, [
          String(chatInput.isReasoningSupported.value),
        ]),
        h('span', { 'data-testid': 'reasoning-mode' }, [
          chatInput.reasoningMode.value,
        ]),
        h('span', { 'data-testid': 'reasoning-menu-levels' }, [
          chatInput.reasoningMenuLevels.value.join(','),
        ]),
        h('span', { 'data-testid': 'is-image-input-supported' }, [
          String(chatInput.isImageInputSupported.value),
        ]),
        h('span', { 'data-testid': 'is-deep-research-model' }, [
          String(chatInput.isDeepResearchModel.value),
        ]),
        h('span', { 'data-testid': 'research-assist-model' }, [
          chatInput.researchConfig.value?.assistModel ?? '',
        ]),
      ])
    },
  })
}

beforeEach(() => {
  keyedProviderIds.value = ['openai', 'google', 'anthropic']

  mocks.useUserKeys.mockReturnValue({
    pending: shallowRef(false),
    error: shallowRef(null),
    hasKey: vi.fn(),
    hasKeyForProvider: (providerId: string) => {
      return keyedProviderIds.value.includes(providerId)
    },
    hasAnyKey: computed(() => keyedProviderIds.value.length > 0),
    refresh: vi.fn(),
  })
})

describe('useChatInput missing-key resolution', () => {
  it('reports a provider model as keyless once its key is gone', async () => {
    const wrapper = await mountSuspended(createHost())

    const { userModel } = useUserModel()

    userModel.value = 'gpt-5.4'
    await wrapper.vm.$nextTick()

    expect(
      wrapper.get('[data-testid="is-selected-model-keyless"]').text(),
    ).toBe('false')

    keyedProviderIds.value = ['google']
    await wrapper.vm.$nextTick()

    expect(
      wrapper.get('[data-testid="is-selected-model-keyless"]').text(),
    ).toBe('true')
    expect(
      wrapper.get('[data-testid="selected-model-key-owner-label"]').text(),
    ).toBe('OpenAI')
  })

  it('falls back to the default model rather than staying on an '
    + 'unresolvable provider selection', async () => {
    const wrapper = await mountSuspended(createHost())

    const { userModel } = useUserModel()

    userModel.value = 'not-a-real-model'
    keyedProviderIds.value = []
    await wrapper.vm.$nextTick()

    expect(userModel.value).toBe(defaultModel)
    expect(
      wrapper.get('[data-testid="is-selected-model-keyless"]').text(),
    ).toBe('true')
    expect(
      wrapper.get('[data-testid="selected-model-key-owner-label"]').text(),
    ).toBe(defaultModelProviderLabel())
  })
})

describe('useChatInput image model capability', () => {
  it('requires image generation for a purpose-built image model', async () => {
    const wrapper = await mountSuspended(createHost())

    const { userModel } = useUserModel()

    userModel.value = 'gpt-image-2'
    await wrapper.vm.$nextTick()

    expect(
      wrapper.get('[data-testid="is-image-generation-supported"]').text(),
    ).toBe('true')
    expect(
      wrapper.get('[data-testid="is-image-generation-required"]').text(),
    ).toBe('true')
    expect(
      wrapper.get('[data-testid="is-web-search-supported"]').text(),
    ).toBe('false')
  })

  it('keeps optional image generation optional on a regular model', async () => {
    const wrapper = await mountSuspended(createHost())

    const { userModel } = useUserModel()

    userModel.value = 'gpt-5.4'
    await wrapper.vm.$nextTick()

    expect(
      wrapper.get('[data-testid="is-image-generation-supported"]').text(),
    ).toBe('true')
    expect(
      wrapper.get('[data-testid="is-image-generation-required"]').text(),
    ).toBe('false')
    expect(
      wrapper.get('[data-testid="is-web-search-supported"]').text(),
    ).toBe('true')
  })
})

describe('useChatInput image input capability', () => {
  it('supports image input for a vision-capable provider model', async () => {
    const wrapper = await mountSuspended(createHost())

    const { userModel } = useUserModel()

    userModel.value = 'gpt-5.4'
    await wrapper.vm.$nextTick()

    expect(
      wrapper.get('[data-testid="is-image-input-supported"]').text(),
    ).toBe('true')
  })

  it('blocks image input for a provider model with no vision modality', async () => {
    const wrapper = await mountSuspended(createHost())

    const { userModel } = useUserModel()

    userModel.value = 'deepseek-v4-pro'
    await wrapper.vm.$nextTick()

    expect(
      wrapper.get('[data-testid="is-image-input-supported"]').text(),
    ).toBe('false')
  })

  it('fails open when the provider model cannot be resolved', async () => {
    const wrapper = await mountSuspended(createHost())

    const { userModel } = useUserModel()

    userModel.value = 'not-a-real-model'
    await wrapper.vm.$nextTick()

    expect(
      wrapper.get('[data-testid="is-image-input-supported"]').text(),
    ).toBe('true')
  })
})

describe('useChatInput reasoning menu levels', () => {
  it('reports a single "medium" level with no "off" prefix for a '
    + 'toggle-mode model', async () => {
    const wrapper = await mountSuspended(createHost())

    const { userModel } = useUserModel()

    userModel.value = 'qwen3.7-plus'
    await wrapper.vm.$nextTick()

    expect(
      wrapper.get('[data-testid="reasoning-mode"]').text(),
    ).toBe('toggle')
    expect(
      wrapper.get('[data-testid="reasoning-menu-levels"]').text(),
    ).toBe('medium')
  })

  it('reports the real levels with no leading "off" for a '
    + 'levels-mode model', async () => {
    const wrapper = await mountSuspended(createHost())

    const { userModel } = useUserModel()

    userModel.value = 'gemini-3.8-flash'
    await wrapper.vm.$nextTick()

    expect(
      wrapper.get('[data-testid="reasoning-mode"]').text(),
    ).toBe('levels')
    expect(
      wrapper.get('[data-testid="reasoning-menu-levels"]').text(),
    ).toBe('low,medium,high')
  })
})

describe('useChatInput research config', () => {
  it('reports research config for a dedicated deep research model', async () => {
    const wrapper = await mountSuspended(createHost(), {
      global: {
        provide: {},
      },
    })

    const { userModel } = useUserModel()

    userModel.value = 'o4-mini-deep-research'
    await wrapper.vm.$nextTick()

    expect(
      wrapper.get('[data-testid="is-deep-research-model"]').text(),
    ).toBe('true')
    expect(
      wrapper.get('[data-testid="research-assist-model"]').text(),
    ).toBeTruthy()
  })

  it('reports no research config for a regular chat model', async () => {
    const wrapper = await mountSuspended(createHost())

    const { userModel } = useUserModel()

    userModel.value = 'gpt-5.4'
    await wrapper.vm.$nextTick()

    expect(
      wrapper.get('[data-testid="is-deep-research-model"]').text(),
    ).toBe('false')
    expect(
      wrapper.get('[data-testid="research-assist-model"]').text(),
    ).toBe('')
  })

  it('falls back to the default model for an unresolvable provider '
    + 'selection, reporting whatever research config that model has', async () => {
    const wrapper = await mountSuspended(createHost())

    const { userModel } = useUserModel()

    userModel.value = 'not-a-real-model'
    await wrapper.vm.$nextTick()

    expect(userModel.value).toBe(defaultModel)
    expect(
      wrapper.get('[data-testid="is-deep-research-model"]').text(),
    ).toBe('false')
    expect(
      wrapper.get('[data-testid="research-assist-model"]').text(),
    ).toBe('')
  })
})

describe('useChatInput web search provider options', () => {
  it('reports tool calling supported and full options for a model with '
    + 'both native search and tool calling', async () => {
    keyedProviderIds.value = ['brave']

    const wrapper = await mountSuspended(createHost())

    const { userModel } = useUserModel()

    userModel.value = 'gemini-3.8-flash'
    await wrapper.vm.$nextTick()

    expect(
      wrapper.get('[data-testid="is-tool-calling-supported"]').text(),
    ).toBe('true')

    const options = JSON.parse(
      wrapper.get('[data-testid="web-search-options"]').text(),
    )

    expect(options).toEqual([
      { value: 'web_search', label: 'Model\'s built-in search', enabled: true },
      {
        value: 'web_search_brave',
        label: 'Brave Search',
        providerId: 'brave',
        enabled: true,
      },
      {
        value: 'web_search_exa',
        label: 'Exa',
        providerId: 'exa',
        enabled: false,
        disabledReason: 'Add an Exa key in Search Providers.',
      },
    ])
  })

  it('collapses Brave and Exa to a single tool-calling reason for a '
    + 'model that cannot call tools', async () => {
    keyedProviderIds.value = ['brave', 'exa']

    const wrapper = await mountSuspended(createHost())

    const { userModel } = useUserModel()

    userModel.value = 'grok-imagine-image-2.0'
    await wrapper.vm.$nextTick()

    expect(
      wrapper.get('[data-testid="is-tool-calling-supported"]').text(),
    ).toBe('false')

    const options = JSON.parse(
      wrapper.get('[data-testid="web-search-options"]').text(),
    )
    const noToolCallReason = 'This model does not support tool calling, so '
      + 'it cannot use an external search provider.'

    expect(options).toEqual([
      {
        value: 'web_search',
        label: 'Model\'s built-in search',
        enabled: false,
        disabledReason: 'This model has no built-in web search.',
      },
      {
        value: 'web_search_brave',
        label: 'Brave Search',
        providerId: 'brave',
        enabled: false,
        disabledReason: noToolCallReason,
      },
      {
        value: 'web_search_exa',
        label: 'Exa',
        providerId: 'exa',
        enabled: false,
        disabledReason: noToolCallReason,
      },
    ])
  })
})

describe('useChatInput gateway model capability', () => {
  it('fails closed on web search, tool calling, image generation, and '
    + 'reasoning before the catalog has been fetched', async () => {
    const wrapper = await mountSuspended(createHost())

    const { selection } = useUserModel()

    selection.value = {
      source: 'gateway',
      gatewayId: 'openrouter',
      modelId: 'anthropic/claude-opus-5',
    }
    await wrapper.vm.$nextTick()

    expect(
      wrapper.get('[data-testid="is-web-search-supported"]').text(),
    ).toBe('false')
    expect(
      wrapper.get('[data-testid="is-tool-calling-supported"]').text(),
    ).toBe('false')
    expect(
      wrapper.get('[data-testid="is-image-generation-supported"]').text(),
    ).toBe('false')
    expect(
      wrapper.get('[data-testid="is-reasoning-supported"]').text(),
    ).toBe('false')

    const options = JSON.parse(
      wrapper.get('[data-testid="web-search-options"]').text(),
    )

    expect(options[1]).toEqual({
      value: 'web_search_brave',
      label: 'Brave Search',
      providerId: 'brave',
      enabled: false,
      disabledReason: noToolCallReason,
    })
  })

  it('supports native web search, tool calling, and levels reasoning for a '
    + 'fully-capable OpenRouter model once the catalog loads', async () => {
    keyedProviderIds.value = ['brave', 'exa']

    const gatewayCatalogCache = useGatewayCatalogCache()

    gatewayCatalogCache.value.openrouter = [{
      id: 'anthropic/claude-opus-5',
      name: 'Claude Opus 5',
      supportsWebSearch: 'native',
      supportsReasoning: true,
      toolCall: true,
    } satisfies GatewayModel]

    const wrapper = await mountSuspended(createHost())

    const { selection } = useUserModel()

    selection.value = {
      source: 'gateway',
      gatewayId: 'openrouter',
      modelId: 'anthropic/claude-opus-5',
    }
    await wrapper.vm.$nextTick()

    expect(
      wrapper.get('[data-testid="is-web-search-supported"]').text(),
    ).toBe('true')
    expect(
      wrapper.get('[data-testid="is-tool-calling-supported"]').text(),
    ).toBe('true')
    expect(
      wrapper.get('[data-testid="is-reasoning-supported"]').text(),
    ).toBe('true')
    expect(
      wrapper.get('[data-testid="reasoning-mode"]').text(),
    ).toBe('levels')

    const options = JSON.parse(
      wrapper.get('[data-testid="web-search-options"]').text(),
    )

    expect(options).toEqual([
      { value: 'web_search', label: 'Model\'s built-in search', enabled: true },
      {
        value: 'web_search_brave',
        label: 'Brave Search',
        providerId: 'brave',
        enabled: true,
      },
      {
        value: 'web_search_exa',
        label: 'Exa',
        providerId: 'exa',
        enabled: true,
      },
    ])
  })

  it('gates Brave and Exa closed for a gateway model whose catalog reports '
    + 'no tool-calling support', async () => {
    keyedProviderIds.value = ['brave', 'exa']

    const gatewayCatalogCache = useGatewayCatalogCache()

    gatewayCatalogCache.value.openrouter = [{
      id: 'openai/gpt-oss',
      name: 'GPT OSS',
      toolCall: false,
    } satisfies GatewayModel]

    const wrapper = await mountSuspended(createHost())

    const { selection } = useUserModel()

    selection.value = {
      source: 'gateway',
      gatewayId: 'openrouter',
      modelId: 'openai/gpt-oss',
    }
    await wrapper.vm.$nextTick()

    expect(
      wrapper.get('[data-testid="is-tool-calling-supported"]').text(),
    ).toBe('false')

    const options = JSON.parse(
      wrapper.get('[data-testid="web-search-options"]').text(),
    )

    expect(options[1]).toEqual({
      value: 'web_search_brave',
      label: 'Brave Search',
      providerId: 'brave',
      enabled: false,
      disabledReason: noToolCallReason,
    })
  })

  it('rejects image generation on Cloudflare even when the catalog reports '
    + 'an image-output model, because the gateway policy denies the tool', async () => {
    const gatewayCatalogCache = useGatewayCatalogCache()

    gatewayCatalogCache.value.cloudflare = [{
      id: '@cf/black-forest-labs/flux-1',
      name: 'FLUX.1',
      supportsImageGeneration: true,
      toolCall: false,
    } satisfies GatewayModel]

    const wrapper = await mountSuspended(createHost())

    const { selection } = useUserModel()

    selection.value = {
      source: 'gateway',
      gatewayId: 'cloudflare',
      modelId: '@cf/black-forest-labs/flux-1',
    }
    await wrapper.vm.$nextTick()

    expect(
      wrapper.get('[data-testid="is-image-generation-supported"]').text(),
    ).toBe('false')
  })

  it('allows image generation on Vercel when the catalog confirms an '
    + 'image-output model', async () => {
    const gatewayCatalogCache = useGatewayCatalogCache()

    gatewayCatalogCache.value.vercel = [{
      id: 'google/gemini-3-flash-image',
      name: 'Gemini 3 Flash Image',
      supportsImageGeneration: true,
      toolCall: false,
    } satisfies GatewayModel]

    const wrapper = await mountSuspended(createHost())

    const { selection } = useUserModel()

    selection.value = {
      source: 'gateway',
      gatewayId: 'vercel',
      modelId: 'google/gemini-3-flash-image',
    }
    await wrapper.vm.$nextTick()

    expect(
      wrapper.get('[data-testid="is-image-generation-supported"]').text(),
    ).toBe('true')
  })

  it('never offers reasoning levels on Cloudflare even when the catalog '
    + 'reports supportsReasoning', async () => {
    const gatewayCatalogCache = useGatewayCatalogCache()

    gatewayCatalogCache.value.cloudflare = [{
      id: '@cf/meta/llama-4',
      name: 'Llama 4',
      supportsReasoning: true,
      toolCall: false,
    } satisfies GatewayModel]

    const wrapper = await mountSuspended(createHost())

    const { selection } = useUserModel()

    selection.value = {
      source: 'gateway',
      gatewayId: 'cloudflare',
      modelId: '@cf/meta/llama-4',
    }
    await wrapper.vm.$nextTick()

    expect(
      wrapper.get('[data-testid="is-reasoning-supported"]').text(),
    ).toBe('false')
  })

  it('resolves the selected-model key owner to the gateway id', async () => {
    keyedProviderIds.value = []

    const gatewayCatalogCache = useGatewayCatalogCache()

    gatewayCatalogCache.value.vercel = [{
      id: 'openai/gpt-5',
      name: 'GPT-5',
      toolCall: true,
    } satisfies GatewayModel]

    const wrapper = await mountSuspended(createHost())

    const { selection } = useUserModel()

    selection.value = {
      source: 'gateway',
      gatewayId: 'vercel',
      modelId: 'openai/gpt-5',
    }
    await wrapper.vm.$nextTick()

    expect(
      wrapper.get('[data-testid="selected-model-key-owner-label"]').text(),
    ).toBe('Vercel AI Gateway')
    expect(
      wrapper.get('[data-testid="is-selected-model-keyless"]').text(),
    ).toBe('true')
  })
})

describe('useChatInput eager gateway catalog hydration', () => {
  beforeEach(() => {
    const gatewayCatalogCache = useGatewayCatalogCache()

    gatewayCatalogCache.value = {}
  })

  it('fetches the gateway catalog as soon as a persisted gateway '
    + 'selection is restored, without the picker having been opened, and '
    + 'reveals the search toggle once it resolves', async () => {
    const { selection } = useUserModel()

    selection.value = {
      source: 'gateway',
      gatewayId: 'openrouter',
      modelId: 'anthropic/claude-opus-5',
    }

    mocks.fetch.mockResolvedValue({
      gateway: 'openrouter',
      models: [{
        id: 'anthropic/claude-opus-5',
        name: 'Claude Opus 5',
        supportsWebSearch: 'native',
        toolCall: true,
      } satisfies GatewayModel],
    })

    const wrapper = await mountSuspended(createHost())

    expect(mocks.fetch).toHaveBeenCalledWith(
      '/api/v1/gateways/openrouter/models',
    )

    await flushPromises()
    await wrapper.vm.$nextTick()

    expect(
      wrapper.get('[data-testid="is-web-search-supported"]').text(),
    ).toBe('true')
    expect(
      wrapper.get('[data-testid="is-tool-calling-supported"]').text(),
    ).toBe('true')
  })

  it('does not reveal the search toggle when the hydrated catalog reports '
    + 'no capability, matching a direct-provider model with no search '
    + 'support', async () => {
    const { selection } = useUserModel()

    selection.value = {
      source: 'gateway',
      gatewayId: 'cloudflare',
      modelId: '@cf/zai-org/glm-5.3-flash',
    }

    mocks.fetch.mockResolvedValue({
      gateway: 'cloudflare',
      models: [{
        id: '@cf/zai-org/glm-5.3-flash',
        name: 'GLM 5.3 Flash',
        toolCall: false,
      } satisfies GatewayModel],
    })

    const wrapper = await mountSuspended(createHost())

    await flushPromises()
    await wrapper.vm.$nextTick()

    expect(
      wrapper.get('[data-testid="is-web-search-supported"]').text(),
    ).toBe('false')
    expect(
      wrapper.get('[data-testid="is-tool-calling-supported"]').text(),
    ).toBe('false')
  })

  it('never fetches a gateway catalog for a direct-provider selection', async () => {
    const { userModel } = useUserModel()

    userModel.value = 'gpt-5.4'

    const wrapper = await mountSuspended(createHost())

    await flushPromises()
    await wrapper.vm.$nextTick()

    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('does not refetch when the gateway catalog is already cached', async () => {
    const gatewayCatalogCache = useGatewayCatalogCache()

    gatewayCatalogCache.value.vercel = [{
      id: 'openai/gpt-5',
      name: 'GPT-5',
      supportsWebSearch: 'native',
      toolCall: true,
    } satisfies GatewayModel]

    const { selection } = useUserModel()

    selection.value = {
      source: 'gateway',
      gatewayId: 'vercel',
      modelId: 'openai/gpt-5',
    }

    const wrapper = await mountSuspended(createHost())

    await flushPromises()
    await wrapper.vm.$nextTick()

    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(
      wrapper.get('[data-testid="is-web-search-supported"]').text(),
    ).toBe('true')
  })

  it('swallows a hydration failure and keeps the search toggle hidden '
    + 'rather than surfacing an error', async () => {
    const { selection } = useUserModel()

    selection.value = {
      source: 'gateway',
      gatewayId: 'cloudflare',
      modelId: '@cf/zai-org/glm-5.3-flash',
    }

    mocks.fetch.mockRejectedValue(new Error('No credentials configured'))

    const wrapper = await mountSuspended(createHost())

    await flushPromises()
    await wrapper.vm.$nextTick()

    expect(
      wrapper.get('[data-testid="is-web-search-supported"]').text(),
    ).toBe('false')
    expect(
      wrapper.get('[data-testid="is-tool-calling-supported"]').text(),
    ).toBe('false')
  })

  it('dedupes an in-flight hydration across two useChatInput() consumers '
    + 'selecting the same gateway at once', async () => {
    const { selection } = useUserModel()

    selection.value = {
      source: 'gateway',
      gatewayId: 'openrouter',
      modelId: 'anthropic/claude-opus-5',
    }

    mocks.fetch.mockReturnValue(new Promise(() => {}))

    await mountSuspended(createHost())
    await mountSuspended(createHost())

    await flushPromises()

    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })
})
