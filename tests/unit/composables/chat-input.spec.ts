import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, shallowRef } from 'vue'
import { providerMeta } from '#shared/utils/provider-meta'
import { useChatInput } from '../../../app/composables/chat-input'
import { defaultModel, providers } from '../../../providers'

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
}))

mockNuxtImport('useUserKeys', () => mocks.useUserKeys)

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
  keyedProviderIds.value = ['openai', 'google', 'anthropic', 'vercel']

  mocks.useUserKeys.mockReturnValue({
    pending: shallowRef(false),
    error: shallowRef(null),
    hasKey: vi.fn(),
    hasKeyForProvider: (providerOrGatewayId: string) => {
      return keyedProviderIds.value.includes(providerOrGatewayId)
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

  it('resolves a gateway selection through its gateway id, not the catalog', async () => {
    const wrapper = await mountSuspended(createHost())

    const { selection } = useUserModel()

    selection.value = {
      source: 'gateway',
      gatewayId: 'vercel',
      modelId: 'anthropic/claude-sonnet-4',
    }
    await wrapper.vm.$nextTick()

    expect(
      wrapper.get('[data-testid="is-selected-model-keyless"]').text(),
    ).toBe('false')
    expect(
      wrapper.get('[data-testid="selected-model-key-owner-label"]').text(),
    ).toBe('Vercel AI Gateway')

    keyedProviderIds.value = ['openai']
    await wrapper.vm.$nextTick()

    expect(
      wrapper.get('[data-testid="is-selected-model-keyless"]').text(),
    ).toBe('true')
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

  it('reports nothing supported when the model cannot be resolved '
    + 'through the curated catalog', async () => {
    const wrapper = await mountSuspended(createHost())

    const { selection } = useUserModel()

    selection.value = {
      source: 'gateway',
      gatewayId: 'openrouter',
      modelId: 'not-a-real-model',
    }
    await wrapper.vm.$nextTick()

    expect(
      wrapper.get('[data-testid="is-image-generation-supported"]').text(),
    ).toBe('false')
    expect(
      wrapper.get('[data-testid="is-image-generation-required"]').text(),
    ).toBe('false')
    expect(
      wrapper.get('[data-testid="is-web-search-supported"]').text(),
    ).toBe('false')
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

  it('reports no research config for a gateway selection', async () => {
    const wrapper = await mountSuspended(createHost())

    const { selection } = useUserModel()

    selection.value = {
      source: 'gateway',
      gatewayId: 'openrouter',
      modelId: 'anthropic/claude-opus-5',
    }
    await wrapper.vm.$nextTick()

    expect(
      wrapper.get('[data-testid="is-deep-research-model"]').text(),
    ).toBe('false')
    expect(
      wrapper.get('[data-testid="research-assist-model"]').text(),
    ).toBe('')
  })
})
