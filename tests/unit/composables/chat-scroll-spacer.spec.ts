import { defineComponent, h, ref, shallowRef } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { mountSuspended } from '@nuxt/test-utils/runtime'
import {
  INITIAL_SPACER_PADDING,
  useChatScrollSpacer,
} from '../../../app/composables/chat-scroll-spacer'

function mountSpacerHost() {
  let exposed!: ReturnType<typeof useChatScrollSpacer>

  const scrollContainerRef = ref<HTMLElement | null>(
    document.createElement('div'),
  )
  const messagesEndRef = ref<HTMLElement | null>(
    document.createElement('div'),
  )
  const messagesDomRefs = shallowRef<HTMLDivElement[] | null>([])

  const Host = defineComponent({
    setup() {
      exposed = useChatScrollSpacer({
        scrollContainerRef,
        messagesEndRef,
        messagesDomRefs,
        chatSdk: { messages: [], status: 'ready' } as any,
      })

      return () => h('div')
    },
  })

  return mountSuspended(Host).then((wrapper) => {
    return { spacer: exposed, messagesEndRef, wrapper }
  })
}

describe('useChatScrollSpacer reserveSpaceForClarify', () => {
  it('reserves room above the fixed input and scrolls the form into view', async () => {
    const { spacer, messagesEndRef, wrapper } = await mountSpacerHost()
    const scrollIntoViewMock = vi.fn()

    messagesEndRef.value!.scrollIntoView = scrollIntoViewMock

    await useNuxtApp().callHook('chat-input:height', 120)
    await spacer.reserveSpaceForClarify()

    expect(spacer.spacerHeight.value).toBe(120 + INITIAL_SPACER_PADDING)
    expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: 'smooth' })

    wrapper.unmount()
  })

  it('keeps the reserved height when the input later reports the same size', async () => {
    const { spacer, messagesEndRef, wrapper } = await mountSpacerHost()

    messagesEndRef.value!.scrollIntoView = vi.fn()

    await useNuxtApp().callHook('chat-input:height', 90)
    await spacer.reserveSpaceForClarify()

    const reservedHeight = spacer.spacerHeight.value

    await useNuxtApp().callHook('chat-input:height', 90)

    expect(spacer.spacerHeight.value).toBe(reservedHeight)

    wrapper.unmount()
  })
})
