import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  computed,
  defineComponent,
  h,
  nextTick,
  reactive,
  ref,
  shallowRef,
  watch,
} from 'vue'
import { useChatScrollSpacer } from '../../../app/composables/chat-scroll-spacer'

type ChatSdk = Parameters<typeof useChatScrollSpacer>[0]['chatSdk']

const INPUT_HEIGHT_DEBOUNCE_MS = 150
const GROWN_INPUT_HEIGHT = 247
const KEYBOARD_INSET = 300
const WHEEL_AFTER_MOMENTUM_MS = 300

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

function defineBox(
  element: HTMLElement,
  box: { offsetTop?: number, offsetHeight?: number, clientHeight?: number },
) {
  for (const [key, value] of Object.entries(box)) {
    Object.defineProperty(element, key, { configurable: true, value })
  }
}

/**
 * A paused reply: the last user message, the reply under it with the
 * approval bubble at its end, and an 800px scroll container.
 */
function createContinuationHarness(initialEndOffsetTop: number = 1100) {
  const scrollTos: ScrollToOptions[] = []
  const scrollBys: ScrollToOptions[] = []
  const tick = shallowRef<number>(0)
  const spacerHeights: number[] = []
  const layout: {
    endOffsetTop: number
    container: HTMLElement | null
    end: HTMLElement | null
  } = { endOffsetTop: initialEndOffsetTop, container: null, end: null }
  const chatSdk = reactive({
    status: 'ready',
    messages: [
      { id: 'user-1', role: 'user', parts: [] },
      { id: 'assistant-1', role: 'assistant', parts: [] },
    ],
  }) as unknown as ChatSdk & { status: string }

  const Harness = defineComponent({
    setup() {
      const scrollContainerRef = ref<HTMLElement | null>(null)
      const messagesEndRef = ref<HTMLElement | null>(null)
      const messagesDomRefs = shallowRef<HTMLDivElement[] | null>([])
      const messageElements: Partial<
        Record<'user' | 'assistant', HTMLDivElement>
      > = {}
      const { spacerHeight } = useChatScrollSpacer({
        scrollContainerRef,
        messagesDomRefs,
        messagesEndRef,
        chatSdk,
      })

      watch(spacerHeight, (height) => {
        spacerHeights.push(height)
      })

      function setContainer(element: Element | null) {
        if (!(element instanceof HTMLElement)) {
          return
        }

        defineBox(element, { clientHeight: 800 })
        element.getBoundingClientRect = () => ({ top: 0 }) as DOMRect
        element.scrollTo = vi.fn((options: ScrollToOptions) => {
          scrollTos.push(options)
        }) as HTMLElement['scrollTo']
        element.scrollBy = vi.fn((options: ScrollToOptions) => {
          scrollBys.push(options)
        }) as HTMLElement['scrollBy']
        scrollContainerRef.value = element
        layout.container = element
      }

      function setMessage(
        role: 'user' | 'assistant',
        element: Element | null,
      ) {
        if (!(element instanceof HTMLDivElement)) {
          return
        }

        defineBox(element, role === 'user'
          ? { offsetTop: 100, offsetHeight: 60 }
          : { offsetTop: 172, offsetHeight: 900 })

        messageElements[role] = element

        if (messageElements.user && messageElements.assistant) {
          messagesDomRefs.value = [
            messageElements.user,
            messageElements.assistant,
          ]
        }
      }

      function setBubble(element: Element | null) {
        if (element instanceof HTMLElement) {
          element.getBoundingClientRect = () => {
            return { top: 700, bottom: 1000 } as DOMRect
          }
        }
      }

      function setEnd(element: Element | null) {
        if (element instanceof HTMLElement) {
          defineBox(element, { offsetTop: layout.endOffsetTop })
          messagesEndRef.value = element
          layout.end = element
        }
      }

      return () => h('div', { 'ref': setContainer, 'data-tick': tick.value }, [
        h('div', {
          'ref': (element: Element | null) => setMessage('user', element),
          'data-role': 'user',
          'data-message-id': 'user-1',
        }),
        h('div', {
          'ref': (element: Element | null) => setMessage('assistant', element),
          'data-role': 'assistant',
          'data-message-id': 'assistant-1',
        }, [
          h('section', {
            ref: setBubble,
            class: 'js-tool-approval-bubble',
          }),
        ]),
        h('div', { ref: setEnd }),
      ])
    },
  })

  function moveMessagesEnd(offsetTop: number) {
    layout.endOffsetTop = offsetTop

    if (layout.end) {
      defineBox(layout.end, { offsetTop })
    }
  }

  return {
    Harness,
    chatSdk,
    scrollTos,
    scrollBys,
    tick,
    spacerHeights,
    layout,
    moveMessagesEnd,
  }
}

const resizeObservations: Array<{ target: Element, notify: () => void }> = []

async function notifyContentResize() {
  resizeObservations.at(-1)?.notify()
  await nextTick()
  await nextTick()
}

function dispatchWheelAt(target: HTMLElement, timeStamp: number) {
  const event = new Event('wheel')

  Object.defineProperty(event, 'timeStamp', { value: timeStamp })
  target.dispatchEvent(event)
}

const BUBBLE_MARGIN_TOP = 12

function placeApprovalBubble(
  layout: ReturnType<typeof createContinuationHarness>['layout'],
  bubbleMessageTop: number,
) {
  const bubbleMessage = layout.container!.querySelector<HTMLElement>(
    '[data-role="assistant"]',
  )!

  const readComputedStyle = window.getComputedStyle.bind(window)

  vi.spyOn(window, 'getComputedStyle').mockImplementation((element) => {
    if (element === bubbleMessage) {
      return { marginTop: `${BUBBLE_MARGIN_TOP}px` } as CSSStyleDeclaration
    }

    return readComputedStyle(element)
  })
  bubbleMessage.getBoundingClientRect = () => {
    return { top: bubbleMessageTop } as DOMRect
  }
  layout.end!.getBoundingClientRect = () => {
    return { top: layout.endOffsetTop } as DOMRect
  }
}

function removeApprovalBubble(
  layout: ReturnType<typeof createContinuationHarness>['layout'],
) {
  layout.container!.querySelector('.js-tool-approval-bubble')?.remove()
}

describe('useChatScrollSpacer continuations and approval pauses', () => {
  beforeEach(() => {
    keyboardInset.value = 0
    resizeObservations.length = 0
    vi.useFakeTimers()
    vi.stubGlobal('ResizeObserver', class {
      private readonly callback: ResizeObserverCallback
      private readonly observations: typeof resizeObservations = []

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback
      }

      observe(target: Element) {
        const observation = {
          target,
          notify: () => {
            this.callback([], this as unknown as ResizeObserver)
          },
        }

        this.observations.push(observation)
        resizeObservations.push(observation)
      }

      unobserve() {}

      disconnect() {
        for (const observation of this.observations) {
          resizeObservations.splice(resizeObservations.indexOf(observation), 1)
        }

        this.observations.length = 0
      }
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('keeps the continuation pin when the approval bubble leaves and the '
    + 'reply under the user message gets shorter', async () => {
    const {
      Harness,
      chatSdk,
      scrollTos,
      spacerHeights,
      moveMessagesEnd,
    } = createContinuationHarness(400)

    await mountSuspended(Harness)
    await vi.advanceTimersByTimeAsync(INPUT_HEIGHT_DEBOUNCE_MS)

    chatSdk.status = 'submitted'
    await useNuxtApp().callHook('chat:continue')
    await nextTick()

    expect(spacerHeights.at(-1)).toBe(488)

    scrollTos.length = 0
    moveMessagesEnd(250)
    await notifyContentResize()

    expect(spacerHeights.at(-1)).toBe(638)
    expect(scrollTos).toEqual([{ top: 88, behavior: 'instant' }])
  })

  it('grows the spacer but leaves the scroll position after the user '
    + 'scrolled during the continuation', async () => {
    const {
      Harness,
      chatSdk,
      scrollTos,
      spacerHeights,
      layout,
      moveMessagesEnd,
    } = createContinuationHarness(400)

    await mountSuspended(Harness)
    await vi.advanceTimersByTimeAsync(INPUT_HEIGHT_DEBOUNCE_MS)

    chatSdk.status = 'submitted'
    await useNuxtApp().callHook('chat:continue')
    await nextTick()
    dispatchWheelAt(
      layout.container!,
      performance.now() + WHEEL_AFTER_MOMENTUM_MS,
    )
    scrollTos.length = 0
    moveMessagesEnd(250)
    await notifyContentResize()

    expect(spacerHeights.at(-1)).toBe(638)
    expect(scrollTos).toEqual([])
  })

  it('observes the messages container, the parent of the messages end '
    + 'element', async () => {
    const { Harness, layout } = createContinuationHarness(400)

    await mountSuspended(Harness)

    expect(layout.end?.parentElement).toBe(layout.container)
    expect(resizeObservations.map(observation => observation.target))
      .toContain(layout.end?.parentElement)
  })

  it('keeps the pin on a wheel event inside the momentum window after the '
    + 'pin', async () => {
    const { Harness, chatSdk, scrollTos, layout, moveMessagesEnd } = (
      createContinuationHarness(400)
    )

    await mountSuspended(Harness)
    await vi.advanceTimersByTimeAsync(INPUT_HEIGHT_DEBOUNCE_MS)

    chatSdk.status = 'submitted'
    await useNuxtApp().callHook('chat:continue')
    await nextTick()
    dispatchWheelAt(layout.container!, performance.now())
    scrollTos.length = 0
    moveMessagesEnd(250)
    await notifyContentResize()

    expect(scrollTos).toEqual([{ top: 88, behavior: 'instant' }])
  })

  it('releases the pin on a wheel event after the momentum window',
    async () => {
      const { Harness, chatSdk, scrollTos, layout, moveMessagesEnd } = (
        createContinuationHarness(400)
      )

      await mountSuspended(Harness)
      await vi.advanceTimersByTimeAsync(INPUT_HEIGHT_DEBOUNCE_MS)

      chatSdk.status = 'submitted'
      await useNuxtApp().callHook('chat:continue')
      await nextTick()
      dispatchWheelAt(
        layout.container!,
        performance.now() + WHEEL_AFTER_MOMENTUM_MS,
      )
      scrollTos.length = 0
      moveMessagesEnd(250)
      await notifyContentResize()

      expect(scrollTos).toEqual([])
    })

  it.each([
    'PageUp',
    'PageDown',
    'Home',
    'End',
    'ArrowUp',
    'ArrowDown',
    ' ',
  ])('releases the pin on the %j key', async (key) => {
    const { Harness, chatSdk, scrollTos, moveMessagesEnd } = (
      createContinuationHarness(400)
    )

    await mountSuspended(Harness)
    await vi.advanceTimersByTimeAsync(INPUT_HEIGHT_DEBOUNCE_MS)

    chatSdk.status = 'submitted'
    await useNuxtApp().callHook('chat:continue')
    await nextTick()
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
    scrollTos.length = 0
    moveMessagesEnd(250)
    await notifyContentResize()

    expect(scrollTos).toEqual([])
  })

  it('keeps the pin on a letter key and on a scroll key typed in a text '
    + 'field', async () => {
    const { Harness, chatSdk, scrollTos, moveMessagesEnd } = (
      createContinuationHarness(400)
    )
    const textarea = document.createElement('textarea')

    document.body.append(textarea)
    await mountSuspended(Harness)
    await vi.advanceTimersByTimeAsync(INPUT_HEIGHT_DEBOUNCE_MS)

    chatSdk.status = 'submitted'
    await useNuxtApp().callHook('chat:continue')
    await nextTick()
    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'a',
      bubbles: true,
    }))
    textarea.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
    }))
    textarea.remove()
    scrollTos.length = 0
    moveMessagesEnd(250)
    await notifyContentResize()

    expect(scrollTos).toEqual([{ top: 88, behavior: 'instant' }])
  })

  it('releases the pin on a pointer press on the scroll container itself, '
    + 'the scrollbar', async () => {
    const { Harness, chatSdk, scrollTos, layout, moveMessagesEnd } = (
      createContinuationHarness(400)
    )

    await mountSuspended(Harness)
    await vi.advanceTimersByTimeAsync(INPUT_HEIGHT_DEBOUNCE_MS)

    chatSdk.status = 'submitted'
    await useNuxtApp().callHook('chat:continue')
    await nextTick()
    layout.container!.dispatchEvent(new Event('pointerdown', {
      bubbles: true,
    }))
    scrollTos.length = 0
    moveMessagesEnd(250)
    await notifyContentResize()

    expect(scrollTos).toEqual([])
  })

  it('keeps the pin on a pointer press on the content in the container',
    async () => {
      const { Harness, chatSdk, scrollTos, layout, moveMessagesEnd } = (
        createContinuationHarness(400)
      )

      await mountSuspended(Harness)
      await vi.advanceTimersByTimeAsync(INPUT_HEIGHT_DEBOUNCE_MS)

      chatSdk.status = 'submitted'
      await useNuxtApp().callHook('chat:continue')
      await nextTick()
      layout.end!.dispatchEvent(new Event('pointerdown', { bubbles: true }))
      scrollTos.length = 0
      moveMessagesEnd(250)
      await notifyContentResize()

      expect(scrollTos).toEqual([{ top: 88, behavior: 'instant' }])
    })

  it.each(['ready', 'error'])('drops the stored pin when the chat status '
    + 'becomes %s', async (status) => {
    const { Harness, chatSdk, scrollTos, spacerHeights, moveMessagesEnd } = (
      createContinuationHarness(400)
    )

    await mountSuspended(Harness)
    await vi.advanceTimersByTimeAsync(INPUT_HEIGHT_DEBOUNCE_MS)

    chatSdk.status = 'submitted'
    await useNuxtApp().callHook('chat:continue')
    await nextTick()

    chatSdk.status = status
    await nextTick()

    const spacerCount = spacerHeights.length

    scrollTos.length = 0
    moveMessagesEnd(250)
    await notifyContentResize()

    expect(spacerHeights).toHaveLength(spacerCount)
    expect(scrollTos).toEqual([])
  })

  it('lets go of the pin when the user scrolls to the bottom during the '
    + 'continuation', async () => {
    const {
      Harness,
      chatSdk,
      scrollTos,
      spacerHeights,
      moveMessagesEnd,
    } = createContinuationHarness(400)

    await mountSuspended(Harness)
    await vi.advanceTimersByTimeAsync(INPUT_HEIGHT_DEBOUNCE_MS)

    chatSdk.status = 'submitted'
    await useNuxtApp().callHook('chat:continue')
    await nextTick()
    await useNuxtApp().callHook('chat:scroll-to-bottom')
    await nextTick()

    const spacerCount = spacerHeights.length

    scrollTos.length = 0
    moveMessagesEnd(250)
    await notifyContentResize()

    expect(spacerHeights).toHaveLength(spacerCount)
    expect(scrollTos).toEqual([])
  })

  it('does not touch the spacer on a content resize outside a '
    + 'continuation', async () => {
    const { Harness, scrollTos, spacerHeights, moveMessagesEnd } = (
      createContinuationHarness(400)
    )

    await mountSuspended(Harness)
    await vi.advanceTimersByTimeAsync(INPUT_HEIGHT_DEBOUNCE_MS)

    const spacerCount = spacerHeights.length

    scrollTos.length = 0
    moveMessagesEnd(250)
    await notifyContentResize()

    expect(spacerHeights).toHaveLength(spacerCount)
    expect(scrollTos).toEqual([])
  })

  it('stops following content resizes once the finished reply is placed',
    async () => {
      const {
        Harness,
        chatSdk,
        scrollTos,
        spacerHeights,
        tick,
        moveMessagesEnd,
      } = createContinuationHarness(400)

      await mountSuspended(Harness)
      await vi.advanceTimersByTimeAsync(INPUT_HEIGHT_DEBOUNCE_MS)

      chatSdk.status = 'submitted'
      await useNuxtApp().callHook('chat:continue')
      await nextTick()

      chatSdk.status = 'ready'
      tick.value += 1
      await nextTick()
      await vi.advanceTimersByTimeAsync(INPUT_HEIGHT_DEBOUNCE_MS)
      await nextTick()

      const spacerCount = spacerHeights.length

      scrollTos.length = 0
      moveMessagesEnd(250)
      await notifyContentResize()

      expect(spacerHeights).toHaveLength(spacerCount)
      expect(scrollTos).toEqual([])
    })

  it('pins the last user message when a reply continues, then places and '
    + 'reveals the paused reply like a finished send', async () => {
    const {
      Harness,
      chatSdk,
      scrollTos,
      scrollBys,
      tick,
      spacerHeights,
    } = createContinuationHarness()

    await mountSuspended(Harness)
    await vi.advanceTimersByTimeAsync(INPUT_HEIGHT_DEBOUNCE_MS)
    scrollTos.length = 0
    scrollBys.length = 0

    chatSdk.status = 'submitted'
    await useNuxtApp().callHook('chat:continue')
    await nextTick()

    expect(scrollTos).toEqual([{ top: 88, behavior: 'smooth' }])
    expect(spacerHeights.at(-1)).toBe(12)

    chatSdk.status = 'ready'
    tick.value += 1
    await nextTick()
    await vi.advanceTimersByTimeAsync(INPUT_HEIGHT_DEBOUNCE_MS)
    await nextTick()

    expect(scrollTos.slice(-2)).toEqual([
      { top: 88, behavior: 'instant' },
      { top: 212, behavior: 'smooth' },
    ])
    expect(scrollBys).toEqual([])
  })

  it('does not place a finished reply again without a continuation',
    async () => {
      const { Harness, chatSdk, scrollTos, tick } = createContinuationHarness()

      await mountSuspended(Harness)
      await useNuxtApp().callHook('chat:continue')
      chatSdk.status = 'ready'
      tick.value += 1
      await nextTick()
      await vi.advanceTimersByTimeAsync(INPUT_HEIGHT_DEBOUNCE_MS)

      const scrollCount = scrollTos.length

      tick.value += 1
      await nextTick()
      await vi.advanceTimersByTimeAsync(INPUT_HEIGHT_DEBOUNCE_MS)

      expect(scrollTos).toHaveLength(scrollCount)
    })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sizes the pin spacer as if the approval bubble had already left',
    async () => {
      const { Harness, chatSdk, spacerHeights, layout } = (
        createContinuationHarness(1100)
      )

      await mountSuspended(Harness)
      await vi.advanceTimersByTimeAsync(INPUT_HEIGHT_DEBOUNCE_MS)
      placeApprovalBubble(layout, 700)

      chatSdk.status = 'submitted'
      await useNuxtApp().callHook('chat:continue')
      await nextTick()

      expect(spacerHeights.at(-1)).toBe(200)
    })

  it('keeps the spacer and the scroll position when the bubble leaves, '
    + 'through a slow gap and when the text finally arrives', async () => {
    const {
      Harness,
      chatSdk,
      scrollTos,
      spacerHeights,
      layout,
      moveMessagesEnd,
    } = createContinuationHarness(1100)

    await mountSuspended(Harness)
    await vi.advanceTimersByTimeAsync(INPUT_HEIGHT_DEBOUNCE_MS)
    placeApprovalBubble(layout, 700)

    chatSdk.status = 'submitted'
    await useNuxtApp().callHook('chat:continue')
    await nextTick()

    const pinnedSpacer = spacerHeights.at(-1)
    const spacerCount = spacerHeights.length

    scrollTos.length = 0
    removeApprovalBubble(layout)
    moveMessagesEnd(1100 - 300 - BUBBLE_MARGIN_TOP)
    await notifyContentResize()

    expect(spacerHeights.at(-1)).toBe(pinnedSpacer)
    expect(spacerHeights).toHaveLength(spacerCount)
    expect(scrollTos).toEqual([])

    for (let second = 0; second < 3; second += 1) {
      await vi.advanceTimersByTimeAsync(1000)
      await notifyContentResize()
    }

    expect(spacerHeights).toHaveLength(spacerCount)
    expect(scrollTos).toEqual([])

    moveMessagesEnd(1100 - 300 - BUBBLE_MARGIN_TOP + 240)
    await notifyContentResize()

    expect(spacerHeights).toHaveLength(spacerCount)
    expect(scrollTos).toEqual([])
  })

  it('still returns to the pin when the bubble was shorter than measured '
    + 'and the page gets shorter than the pin needs', async () => {
    const {
      Harness,
      chatSdk,
      scrollTos,
      spacerHeights,
      layout,
      moveMessagesEnd,
    } = createContinuationHarness(1100)

    await mountSuspended(Harness)
    await vi.advanceTimersByTimeAsync(INPUT_HEIGHT_DEBOUNCE_MS)
    placeApprovalBubble(layout, 700)

    chatSdk.status = 'submitted'
    await useNuxtApp().callHook('chat:continue')
    await nextTick()

    scrollTos.length = 0
    removeApprovalBubble(layout)
    moveMessagesEnd(100)
    await notifyContentResize()

    expect(spacerHeights.at(-1)).toBe(788)
    expect(scrollTos).toEqual([{ top: 88, behavior: 'instant' }])
  })

  it('adds nothing to the pin spacer when no approval bubble is on the '
    + 'page', async () => {
    const { Harness, chatSdk, spacerHeights, layout } = (
      createContinuationHarness(1100)
    )

    await mountSuspended(Harness)
    await vi.advanceTimersByTimeAsync(INPUT_HEIGHT_DEBOUNCE_MS)
    removeApprovalBubble(layout)
    placeApprovalBubble(layout, 700)

    chatSdk.status = 'submitted'
    await useNuxtApp().callHook('chat:continue')
    await nextTick()

    expect(spacerHeights.at(-1)).toBe(12)
  })
})
