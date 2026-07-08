import { mountSuspended } from '@nuxt/test-utils/runtime'
import { describe, expect, it } from 'vitest'
import { defineComponent, h } from 'vue'
import { useChatInput } from '../../../app/composables/chat-input'

function createHost() {
  return defineComponent({
    setup() {
      const chatInput = useChatInput()

      return () => h('div', [
        h('span', { 'data-testid': 'is-research-supported' }, [
          String(chatInput.isDeepResearchSupported.value),
        ]),
        h('span', { 'data-testid': 'research-quick-model' }, [
          chatInput.researchCapability.value?.levels.quick.modelId ?? '',
        ]),
      ])
    },
  })
}

describe('useChatInput research capability', () => {
  it('reports research support and levels for an OpenAI model', async () => {
    const wrapper = await mountSuspended(createHost(), {
      global: {
        provide: {},
      },
    })

    const { userModel } = useUserModel()

    userModel.value = 'gpt-5.4'
    await wrapper.vm.$nextTick()

    expect(
      wrapper.get('[data-testid="is-research-supported"]').text(),
    ).toBe('true')
    expect(
      wrapper.get('[data-testid="research-quick-model"]').text(),
    ).toBeTruthy()
  })

  it('reports no research support for an unknown model', async () => {
    const wrapper = await mountSuspended(createHost())

    const { userModel } = useUserModel()

    userModel.value = 'not-a-real-model'
    await wrapper.vm.$nextTick()

    expect(
      wrapper.get('[data-testid="is-research-supported"]').text(),
    ).toBe('false')
    expect(
      wrapper.get('[data-testid="research-quick-model"]').text(),
    ).toBe('')
  })
})
