import { describe, expect, it } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import { defineComponent, h, nextTick, shallowRef } from 'vue'
import {
  markdownSourceKey,
  useMarkdownSource,
} from '../../../app/composables/markdown-source'
import type { MarkdownSourceContext } from '../../../app/composables/markdown-source'

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

describe('composables/markdown-source', () => {
  it('defaults to an empty, non-streaming context when nothing is provided',
    async () => {
      const wrapper = await mountSuspended(Consumer)

      expect(JSON.parse(wrapper.get('[data-testid="consumer"]').text()))
        .toEqual({ source: '', streaming: false })
    })

  it('reads the provided getter reactively', async () => {
    const context = shallowRef<MarkdownSourceContext>({
      source: 'first',
      streaming: true,
    })

    const wrapper = await mountSuspended(Consumer, {
      global: {
        provide: {
          [markdownSourceKey as symbol]: () => context.value,
        },
      },
    })

    expect(JSON.parse(wrapper.get('[data-testid="consumer"]').text()))
      .toEqual({ source: 'first', streaming: true })

    context.value = { source: 'second', streaming: false }

    await nextTick()

    expect(JSON.parse(wrapper.get('[data-testid="consumer"]').text()))
      .toEqual({ source: 'second', streaming: false })
  })
})
