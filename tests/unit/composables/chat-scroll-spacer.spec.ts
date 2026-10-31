import { mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, ref, shallowRef } from 'vue'
import { useChatScrollSpacer } from '../../../app/composables/chat-scroll-spacer'

type ChatSdk = Parameters<typeof useChatScrollSpacer>[0]['chatSdk']

const INPUT_HEIGHT_DEBOUNCE_MS = 150
const GROWN_INPUT_HEIGHT = 247

function createSpacerHarness(lastMessageRole: 'user' | 'assistant') {
  const spacerHeightsAtScroll: string[] = []
  const chatSdk = {
    status: 'ready',
    messages: [{ id: 'message-1', role: lastMessageRole, parts: [] }],
  } as unknown as ChatSdk

  const Harness = defineComponent({
    setup() {
      const scrollContainerRef = ref<HTMLElement | null>(null)
      const messagesEndRef = ref<HTMLElement | null>(null)
      const messagesDomRefs = shallowRef<HTMLDivElement[] | null>([])
      const { spacerHeight } = useChatScrollSpacer({
        scrollContainerRef,
        messagesDomRefs,
        messagesEndRef,
        chatSdk,
      })

      function recordScroll(element: Element | null) {
        if (!(element instanceof HTMLElement)) {
          return
        }

        scrollContainerRef.value = element
        element.scrollTo = vi.fn(() => {
          const spacer = element.lastElementChild as HTMLElement | null

          spacerHeightsAtScroll.push(spacer?.style.height ?? '')
        }) as HTMLElement['scrollTo']
      }

      return () => h('div', { ref: recordScroll }, [
        h('div', { ref: messagesEndRef }),
        h('div', { style: { height: `${spacerHeight.value}px` } }),
      ])
    },
  })

  return { Harness, spacerHeightsAtScroll }
}

describe('useChatScrollSpacer chat-input:height', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('scrolls to the bottom only after the spacer renders the new input '
    + 'height', async () => {
    const { Harness, spacerHeightsAtScroll } = createSpacerHarness(
      'assistant',
    )

    await mountSuspended(Harness)

    await useNuxtApp().callHook('chat-input:height', GROWN_INPUT_HEIGHT)
    await vi.advanceTimersByTimeAsync(INPUT_HEIGHT_DEBOUNCE_MS)

    expect(spacerHeightsAtScroll).toEqual([`${GROWN_INPUT_HEIGHT}px`])
  })

  it('leaves the spacer and scroll alone when the last message is from '
    + 'the user', async () => {
    const { Harness, spacerHeightsAtScroll } = createSpacerHarness('user')

    await mountSuspended(Harness)

    await useNuxtApp().callHook('chat-input:height', GROWN_INPUT_HEIGHT)
    await vi.advanceTimersByTimeAsync(INPUT_HEIGHT_DEBOUNCE_MS)

    expect(spacerHeightsAtScroll).toEqual([])
  })
})
