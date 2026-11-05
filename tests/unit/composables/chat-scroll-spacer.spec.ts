import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { computed, defineComponent, h, ref, shallowRef } from 'vue'
import { useChatScrollSpacer } from '../../../app/composables/chat-scroll-spacer'

type ChatSdk = Parameters<typeof useChatScrollSpacer>[0]['chatSdk']

const INPUT_HEIGHT_DEBOUNCE_MS = 150
const GROWN_INPUT_HEIGHT = 247
const KEYBOARD_INSET = 300

const keyboardInset = shallowRef<number>(0)

mockNuxtImport('useVisualViewportInset', () => {
  return () => ({
    bottomInset: keyboardInset,
    viewportHeight: shallowRef<number>(800),
    isKeyboardOpen: computed<boolean>(() => keyboardInset.value >= 120),
    update: vi.fn(),
  })
})

function createSpacerHarness(lastMessageRole: 'user' | 'assistant') {
  const spacerHeightsAtScroll: string[] = []
  const scrollByOffsets: number[] = []
  const spacer: {
    reservePinnedSpace: ((behavior?: ScrollBehavior) => Promise<void>) | null
    element: HTMLElement | null
  } = { reservePinnedSpace: null, element: null }
  const chatSdk = {
    status: 'ready',
    messages: [{ id: 'message-1', role: lastMessageRole, parts: [] }],
  } as unknown as ChatSdk

  const Harness = defineComponent({
    setup() {
      const scrollContainerRef = ref<HTMLElement | null>(null)
      const messagesEndRef = ref<HTMLElement | null>(null)
      const messagesDomRefs = shallowRef<HTMLDivElement[] | null>([])
      const { spacerHeight, reservePinnedSpace } = useChatScrollSpacer({
        scrollContainerRef,
        messagesDomRefs,
        messagesEndRef,
        chatSdk,
      })

      spacer.reservePinnedSpace = reservePinnedSpace

      function recordScroll(element: Element | null) {
        if (!(element instanceof HTMLElement)) {
          return
        }

        scrollContainerRef.value = element
        element.scrollTo = vi.fn(() => {
          const spacer = element.lastElementChild as HTMLElement | null

          spacerHeightsAtScroll.push(spacer?.style.height ?? '')
        }) as HTMLElement['scrollTo']
        element.scrollBy = vi.fn((options: ScrollToOptions) => {
          scrollByOffsets.push(options.top ?? 0)
        }) as HTMLElement['scrollBy']
      }

      function recordSpacer(element: Element | null) {
        spacer.element = element instanceof HTMLElement ? element : null
      }

      return () => h('div', { ref: recordScroll }, [
        h('div', { ref: messagesEndRef }),
        h('div', {
          ref: recordSpacer,
          style: { height: `${spacerHeight.value}px` },
        }),
      ])
    },
  })

  return { Harness, spacerHeightsAtScroll, scrollByOffsets, spacer }
}

describe('useChatScrollSpacer chat-input:height', () => {
  beforeEach(() => {
    keyboardInset.value = 0
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

  it('adds the keyboard inset so the last message clears the lifted '
    + 'composer', async () => {
    const { Harness, spacerHeightsAtScroll } = createSpacerHarness(
      'assistant',
    )

    await mountSuspended(Harness)

    await useNuxtApp().callHook('chat-input:height', GROWN_INPUT_HEIGHT)
    await vi.advanceTimersByTimeAsync(INPUT_HEIGHT_DEBOUNCE_MS)

    keyboardInset.value = KEYBOARD_INSET
    await vi.advanceTimersByTimeAsync(INPUT_HEIGHT_DEBOUNCE_MS)

    expect(spacerHeightsAtScroll.at(-1))
      .toBe(`${GROWN_INPUT_HEIGHT + KEYBOARD_INSET}px`)

    keyboardInset.value = 0
    await vi.advanceTimersByTimeAsync(INPUT_HEIGHT_DEBOUNCE_MS)

    expect(spacerHeightsAtScroll.at(-1)).toBe(`${GROWN_INPUT_HEIGHT}px`)
  })

  it('ignores an inset below the keyboard threshold', async () => {
    const { Harness, spacerHeightsAtScroll } = createSpacerHarness(
      'assistant',
    )

    await mountSuspended(Harness)

    await useNuxtApp().callHook('chat-input:height', GROWN_INPUT_HEIGHT)
    await vi.advanceTimersByTimeAsync(INPUT_HEIGHT_DEBOUNCE_MS)

    keyboardInset.value = 60
    await vi.advanceTimersByTimeAsync(INPUT_HEIGHT_DEBOUNCE_MS)

    expect(spacerHeightsAtScroll).toEqual([`${GROWN_INPUT_HEIGHT}px`])
  })

  it('grows a pinned spacer by the keyboard inset without refitting it',
    async () => {
      const {
        Harness,
        spacerHeightsAtScroll,
        scrollByOffsets,
        spacer,
      } = createSpacerHarness('assistant')

      await mountSuspended(Harness)

      await useNuxtApp().callHook('chat-input:height', GROWN_INPUT_HEIGHT)
      await vi.advanceTimersByTimeAsync(INPUT_HEIGHT_DEBOUNCE_MS)
      await spacer.reservePinnedSpace?.('instant')

      const pinnedHeight = spacer.element?.style.height
      const scrollsBeforeKeyboard = spacerHeightsAtScroll.length

      keyboardInset.value = KEYBOARD_INSET
      await vi.advanceTimersByTimeAsync(INPUT_HEIGHT_DEBOUNCE_MS)

      expect(spacer.element?.style.height)
        .toBe(`${Number.parseInt(pinnedHeight ?? '0') + KEYBOARD_INSET}px`)
      expect(scrollByOffsets).toEqual([KEYBOARD_INSET])
      expect(spacerHeightsAtScroll).toHaveLength(scrollsBeforeKeyboard)

      keyboardInset.value = 0
      await vi.advanceTimersByTimeAsync(INPUT_HEIGHT_DEBOUNCE_MS)

      expect(spacer.element?.style.height).toBe(pinnedHeight)
      expect(scrollByOffsets).toEqual([KEYBOARD_INSET])
    })
})
