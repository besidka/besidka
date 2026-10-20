import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { defineComponent, h } from 'vue'
import ChatMarkdownSource from '../../../../app/components/Chat/MarkdownSource.vue'
import { useMarkdownSource } from '../../../../app/composables/markdown-source'

const Consumer = defineComponent({
  setup() {
    const markdownSource = useMarkdownSource()

    return () => {
      return h(
        'span',
        { 'data-testid': 'consumer' },
        JSON.stringify(markdownSource.value),
      )
    }
  },
})

function mountSource(source: string, streaming: boolean) {
  return mountSuspended(ChatMarkdownSource, {
    props: { source, streaming },
    slots: {
      default: () => h('div', { 'data-testid': 'slot' }, [h(Consumer)]),
    },
  })
}

describe('Chat/MarkdownSource.vue', () => {
  it('renders the slot content', async () => {
    const wrapper = await mountSource('hello', true)

    expect(wrapper.find('[data-testid="slot"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="consumer"]').exists()).toBe(true)
  })

  it('exposes its props to descendants reactively', async () => {
    const wrapper = await mountSource('first', true)

    expect(JSON.parse(wrapper.get('[data-testid="consumer"]').text()))
      .toEqual({ source: 'first', streaming: true })

    await wrapper.setProps({ source: 'second', streaming: false })

    expect(JSON.parse(wrapper.get('[data-testid="consumer"]').text()))
      .toEqual({ source: 'second', streaming: false })
  })
})
