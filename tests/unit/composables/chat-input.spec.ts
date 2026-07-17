import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import { useChatInput } from '../../../app/composables/chat-input'

function createHost() {
  return defineComponent({
    setup() {
      const chatInput = useChatInput()

      return () => h('div', [
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

  it('reports nothing supported when the model cannot be resolved', async () => {
    const wrapper = await mountSuspended(createHost())

    const { userModel } = useUserModel()

    userModel.value = 'not-a-real-model'
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

  it('reports no research config for an unknown model', async () => {
    const wrapper = await mountSuspended(createHost())

    const { userModel } = useUserModel()

    userModel.value = 'not-a-real-model'
    await wrapper.vm.$nextTick()

    expect(
      wrapper.get('[data-testid="is-deep-research-model"]').text(),
    ).toBe('false')
    expect(
      wrapper.get('[data-testid="research-assist-model"]').text(),
    ).toBe('')
  })
})
