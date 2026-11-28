import type { Ref, ShallowRef } from 'vue'
import type { UIMessage } from 'ai'

type MessageData = {
  id: UIMessage['id']
  height: number
  offsetTop: number
}

export interface ChatScrollSpacerOptions {
  scrollContainerRef: Ref<HTMLElement | null>
  messagesDomRefs: Readonly<ShallowRef<HTMLDivElement[] | null>>
  messagesEndRef: Ref<HTMLElement | null>
  chatSdk: ReturnType<typeof useChat>['chatSdk']
}

const INITIAL_SPACER_HEIGHT: number = 500
export const INITIAL_SPACER_PADDING: number = 12
const MESSAGES_GRID_CONTAINER_GAP_BETWEEN_MESSAGES: number = 12
const MESSAGE_3_LINES_HEIGHT: number = 100
const CONTINUATION_WHEEL_MOMENTUM_MS: number = 250
const CONTINUATION_PIN_MOVE_THRESHOLD: number = 2
const CONTINUATION_PIN_SETTLED_DISTANCE: number = 24
const SCROLL_KEYS: ReadonlySet<string> = new Set([
  'PageUp',
  'PageDown',
  'Home',
  'End',
  'ArrowUp',
  'ArrowDown',
  ' ',
])

// Could be 100 for small chats
// but rendering many DOM elements for long conversations could take more time,
// so 150 is safer value
//
// Just wait for response from http://localhost:3000/chats/test?scenario=long&regenerate&messages=21
// Scroll to down,
// if chat input overlaps AI message (it's on the bottom of the screen)
// then increase the value
const DEFAULT_DELAY_TO_MEASURE_RENDERED_DOM_ELEMENTS: number = 150

export function useChatScrollSpacer(
  options: ChatScrollSpacerOptions,
) {
  const {
    scrollContainerRef,
    messagesDomRefs,
    messagesEndRef,
    chatSdk,
  } = options

  const nuxtApp = useNuxtApp()
  const { safeAreaTop, safeAreaBottom } = useDeviceSafeArea()
  const { bottomInset, isKeyboardOpen } = useVisualViewportInset()

  const userMessageData = shallowRef<MessageData | null>(null)
  const assistantMessageData = shallowRef<MessageData | null>(null)
  const spacerHeight = shallowRef<number>(INITIAL_SPACER_HEIGHT)
  const inputHeight = shallowRef<number>(0)
  const reportedInputHeight = shallowRef<number>(0)

  const keyboardInset = computed<number>(() => {
    return isKeyboardOpen.value ? bottomInset.value : 0
  })

  const renderedSpacerHeight = computed<number>(() => {
    return spacerHeight.value + keyboardInset.value
  })

  const waitingForDimensions = shallowRef<boolean>(false)

  const capturedUserMessages = new Set<string>()
  const capturedAssistantMessages = new Set<string>()
  const assistantDebounceTimer = shallowRef<NodeJS.Timeout | null>(null)
  let lastAssistantMessageId: string | null = null
  const inputHeightTimer = shallowRef<NodeJS.Timeout | null>(null)
  const spacerComputedByPush = shallowRef<boolean>(false)
  const observedUserElement = shallowRef<HTMLElement | null>(null)
  const isInitialPageLoad = shallowRef<boolean>(true)
  let continuationScrollTarget: number | null = null
  let finalContinuationScrollTarget: number | null = null
  let hasUserTakenOverContinuationScroll: boolean = false
  let continuationPinnedAt: number = 0
  const route = useRoute('chats-slug')
  const messagesContentElement = computed<HTMLElement | null>(() => {
    return messagesEndRef.value?.parentElement ?? null
  })

  function getPushUserMessageBehaviorForLoad(): ScrollBehavior {
    if (!isInitialPageLoad.value) {
      return 'smooth'
    }

    isInitialPageLoad.value = false

    return 'instant'
  }

  function captureMessageDimensions() {
    if (!import.meta.client) {
      return
    }

    const last = messagesDomRefs.value?.at(-1)

    if (!last) {
      return
    }

    const role = last.dataset.role
    const messageId = last.dataset.messageId

    if (!role || !messageId) {
      return
    }

    switch (role) {
      case 'user':
        if (capturedUserMessages.has(messageId)) {
          return
        }

        setTimeout(() => {
          if (capturedUserMessages.has(messageId)) {
            return
          }

          capturedUserMessages.add(messageId)

          userMessageData.value = {
            id: messageId,
            height: last.offsetHeight,
            offsetTop: last.offsetTop,
          }
          observedUserElement.value = last

          if (!['submitted', 'streaming'].includes(chatSdk.status)) {
            pushUserMessageToTop('instant')

            return
          }

          pushUserMessageToTop(getPushUserMessageBehaviorForLoad())

          waitingForDimensions.value = false
        }, DEFAULT_DELAY_TO_MEASURE_RENDERED_DOM_ELEMENTS)

        break
      case 'assistant':
        if (capturedAssistantMessages.has(messageId)) {
          return
        }

        if (assistantDebounceTimer.value) {
          clearTimeout(assistantDebounceTimer.value)
        }

        if (lastAssistantMessageId !== messageId) {
          lastAssistantMessageId = messageId
        }

        assistantDebounceTimer.value = setTimeout(() => {
          assistantMessageData.value = {
            id: messageId,
            height: last.offsetHeight,
            offsetTop: last.offsetTop,
          }

          if (chatSdk.status === 'ready') {
            capturedAssistantMessages.add(messageId)

            adjustSpacerAfterResponse()
          }
        }, DEFAULT_DELAY_TO_MEASURE_RENDERED_DOM_ELEMENTS)

        break
      default:
        return
    }
  }

  onMounted(() => {
    captureMessageDimensions()

    setTimeout(() => {
      // If pushUserMessageToTop(getPushUserMessageBehaviorForLoad())
      // was not called in captureMessageDimensions for some reason,
      // we ensure that manual scroll will be instant on initial page load,
      // not smooth, to prevent wrong scroll position after loading the page.
      // but WILL be smooth manual push in case
      // pushUserMessageToTop(getPushUserMessageBehaviorForLoad())
      // was NOT called in captureMessageDimensions
      isInitialPageLoad.value = false
    }, 1000)
  })
  onUpdated(captureMessageDimensions)

  function rebroadcastSpacerChange(height: number) {
    nuxtApp.callHook('chat-spacer:changed', height)

    requestAnimationFrame(() => {
      nuxtApp.callHook('chat-spacer:changed', height)
    })
  }

  /**
   * The user message is measured once, a fixed delay after it rendered, and
   * a long one may still be laid out as a single short row by then on a slow
   * device. The final adjust runs after the whole reply, so it reads the
   * message again and the reply is placed for the real height.
   */
  function measureUserMessageAgain(): MessageData | null {
    const measured = userMessageData.value
    const userElement = getLastUserMessageElement()

    if (!measured || userElement?.dataset.messageId !== measured.id) {
      return measured
    }

    userMessageData.value = {
      id: measured.id,
      height: userElement.offsetHeight,
      offsetTop: userElement.offsetTop,
    }

    return userMessageData.value
  }

  /**
   * A long user message can still be a single short row when it is measured,
   * because its markdown renders asynchronously. While the reply is on its
   * way, the pin is computed again for the height it grows to, so the user
   * message is not moved for the first time when the reply ends.
   */
  function pinAgainWhenUserMessageResized() {
    const element = observedUserElement.value
    const measured = userMessageData.value

    if (
      !element
      || !measured
      || element.dataset.messageId !== measured.id
      || !['submitted', 'streaming'].includes(chatSdk.status)
      || Math.abs(element.offsetHeight - measured.height) < 1
    ) {
      return
    }

    userMessageData.value = {
      id: measured.id,
      height: element.offsetHeight,
      offsetTop: element.offsetTop,
    }

    pushUserMessageToTop('instant')
  }

  useResizeObserver(observedUserElement, pinAgainWhenUserMessageResized)

  async function adjustSpacerAfterResponse() {
    const pinnedScrollTarget = hasUserTakenOverContinuationScroll
      ? null
      : finalContinuationScrollTarget

    continuationScrollTarget = null
    finalContinuationScrollTarget = null

    if (chatSdk.messages.length <= 1) {
      return
    }

    const container = scrollContainerRef.value
    const messagesEnd = messagesEndRef.value
    const userMessage = measureUserMessageAgain()
    const assistantMessage = assistantMessageData.value

    if (
      !container
      || !messagesEnd
      || !chatSdk.messages.length
      || !userMessage
      || !assistantMessage
    ) {
      return
    }

    const containerHeight = container.clientHeight
    const scrollableSpace = containerHeight - inputHeight.value
    const userMessageHeight = userMessage.height
    const assistantMessageHeight = assistantMessage.height
    const conversationPairHeight = userMessageHeight + assistantMessageHeight
      + MESSAGES_GRID_CONTAINER_GAP_BETWEEN_MESSAGES

    /**
     * @description Default case
     * When the whole conversation pairs height is less
     * than the messages container height.
     * We set the spacer to push the user message
     */
    let resultSpacer: number
      = userMessage.offsetTop - safeAreaTop.value
        + containerHeight - messagesEnd.offsetTop
        - MESSAGES_GRID_CONTAINER_GAP_BETWEEN_MESSAGES

    let extraSpaceForScroll: number = 0

    /**
     * @description Special case
     * If the user message itself is taller than 3 lines,
     * we need to display only last 3 lines of it at the top,
     * so we add extra space for that.
     */
    let extraSpacerForTallUserMessage: number = 0

    if (userMessageHeight > MESSAGE_3_LINES_HEIGHT) {
      extraSpacerForTallUserMessage = userMessageHeight
        - MESSAGE_3_LINES_HEIGHT
        // unknown value in this formula to make it work properly
        + 4
    }

    if (conversationPairHeight > scrollableSpace) {
      if (userMessageHeight <= scrollableSpace) {
        /**
         * @description Excluding case
         * When the converstion pair (user + assistant message) is taller
         * than the available scrollable space (viewport - input).
         * We set the spacer to be equal to the input height.
         * Initial padding is not needed here
         * because it's compensated by gap between messages in the grid.
         * So, the calculation above is enough to cover different cases
         * Except this one.
         * Without scrolling we just need to keep initial padding
         * between the last message and the input area.
         *
         * But in case when the user message itself is taller than 3 lines,
         * we have to add extra space for that.
         */
        resultSpacer = inputHeight.value + extraSpacerForTallUserMessage
        extraSpaceForScroll = INITIAL_SPACER_PADDING
      }
    } else {
      resultSpacer += extraSpacerForTallUserMessage
    }

    if (pinnedScrollTarget !== null) {
      resultSpacer = Math.max(
        resultSpacer,
        getSpacerHeightToReachScrollTarget(
          pinnedScrollTarget,
          container,
          messagesEnd.offsetTop,
        ),
      )
    }

    spacerHeight.value = resultSpacer

    await nextTick()

    const plainScrollTarget = userMessage.offsetTop
      + extraSpacerForTallUserMessage
      - extraSpaceForScroll

    container.scrollTo({
      top: pinnedScrollTarget ?? plainScrollTarget,
      behavior: 'instant',
    })

    rebroadcastSpacerChange(resultSpacer)
    revealApprovalBubble()
  }

  /**
   * Brings the approval bubble under the paused reply into view, above the
   * composer, after the reply was placed like any finished turn. A reply
   * that pauses for an approval is taller than the viewport more often than
   * not, and the bubble is the only thing the user has to act on. The
   * bubble's top never moves above the container's top. An absolute
   * `scrollTo` keeps a second call during the smooth scroll from adding
   * its distance again, as a relative `scrollBy` would in Chromium.
   */
  function revealApprovalBubble() {
    const container = scrollContainerRef.value
    const bubble = container?.querySelector<HTMLElement>(
      '.js-tool-approval-bubble',
    )

    if (!container || !bubble) {
      return
    }

    const containerRect = container.getBoundingClientRect()
    const bubbleRect = bubble.getBoundingClientRect()
    const visibleBottom = containerRect.top + container.clientHeight
      - inputHeight.value
      - keyboardInset.value
      - INITIAL_SPACER_PADDING
    const overflow = bubbleRect.bottom - visibleBottom
    const roomAbove = bubbleRect.top - containerRect.top
      - INITIAL_SPACER_PADDING

    if (overflow <= 0 || roomAbove <= 0) {
      return
    }

    container.scrollTo({
      top: container.scrollTop + Math.min(overflow, roomAbove),
      behavior: 'smooth',
    })
  }

  function getLastUserMessageElement(): HTMLDivElement | null {
    return [...(messagesDomRefs.value ?? [])].reverse().find((element) => {
      return element.dataset.role === 'user'
    }) ?? null
  }

  /**
   * A request that continues the last reply (answered approvals, a resend
   * of those answers, an automatic tool round) has no new user message, so
   * nothing pinned it and the reply was already measured. It is placed like
   * a new send instead: the last user message is pinned to the top with
   * room for the reply to grow below it, and the reply is measured again
   * when it finishes, so `adjustSpacerAfterResponse()` gives it the final
   * layout of a plain send.
   */
  async function pinUserMessageForContinuation() {
    const container = scrollContainerRef.value
    const messagesEnd = messagesEndRef.value
    const userElement = getLastUserMessageElement()
    const lastElement = messagesDomRefs.value?.at(-1)

    if (lastElement?.dataset.role === 'assistant') {
      const messageId = lastElement.dataset.messageId

      if (messageId) {
        capturedAssistantMessages.delete(messageId)
      }
    }

    if (!container || !messagesEnd || !userElement?.dataset.messageId) {
      return
    }

    const userMessage: MessageData = {
      id: userElement.dataset.messageId,
      height: userElement.offsetHeight,
      offsetTop: userElement.offsetTop,
    }
    const extraForTallUserMessage = userMessage.height > MESSAGE_3_LINES_HEIGHT
      ? userMessage.height + 16 - MESSAGE_3_LINES_HEIGHT
      : 0
    const pinFormulaTarget = userMessage.offsetTop
      + extraForTallUserMessage
      - INITIAL_SPACER_PADDING
    const scrollTarget = Math.abs(container.scrollTop - pinFormulaTarget)
      <= CONTINUATION_PIN_SETTLED_DISTANCE
      ? container.scrollTop
      : pinFormulaTarget

    const hasLeavingApprovalBubble = getLeavingApprovalBubbleHeight(
      messagesEnd,
    ) > 0

    userMessageData.value = userMessage
    spacerComputedByPush.value = true
    continuationScrollTarget = scrollTarget
    finalContinuationScrollTarget = scrollTarget
    hasUserTakenOverContinuationScroll = false
    continuationPinnedAt = performance.now()
    spacerHeight.value = getSpacerHeightForScrollTarget(
      scrollTarget,
      container,
      messagesEnd,
    )

    await nextTick()

    const isPinMoveVisible = Math.abs(container.scrollTop - scrollTarget)
      > CONTINUATION_PIN_MOVE_THRESHOLD

    container.scrollTo({
      top: scrollTarget,
      behavior: hasLeavingApprovalBubble && isPinMoveVisible
        ? 'instant'
        : 'smooth',
    })

    rebroadcastSpacerChange(spacerHeight.value)
  }

  /**
   * The approval bubble message leaves the page as soon as its tool settles,
   * which moves `messagesEnd` up by that message's height plus its top
   * margin. The pin spacer is sized as if it had left already, so the page
   * keeps its height and `scrollTop` is never clamped, not even for the one
   * layout between the removal and the first resize notification.
   */
  function getLeavingApprovalBubbleHeight(messagesEnd: HTMLElement): number {
    const bubbleMessage = scrollContainerRef.value
      ?.querySelector<HTMLElement>('.js-tool-approval-bubble')
      ?.closest<HTMLElement>('.js-tool-approval-message')

    if (!bubbleMessage) {
      return 0
    }

    const marginTop = Number.parseFloat(
      getComputedStyle(bubbleMessage).marginTop,
    ) || 0

    return Math.max(
      messagesEnd.getBoundingClientRect().top
      - bubbleMessage.getBoundingClientRect().top
      + marginTop,
      0,
    )
  }

  function getSpacerHeightToReachScrollTarget(
    scrollTarget: number,
    container: HTMLElement,
    contentEnd: number,
  ): number {
    return scrollTarget - contentEnd + container.clientHeight
  }

  function getSpacerHeightForScrollTarget(
    scrollTarget: number,
    container: HTMLElement,
    messagesEnd: HTMLElement,
  ): number {
    return Math.max(
      getSpacerHeightToReachScrollTarget(
        scrollTarget,
        container,
        messagesEnd.offsetTop - getLeavingApprovalBubbleHeight(messagesEnd),
      ),
      inputHeight.value + INITIAL_SPACER_PADDING,
    )
  }

  /**
   * The continuation pin sizes the spacer from the layout at the moment the
   * request starts, when the approval bubble is still under the reply. The
   * bubble leaves as soon as the tool part settles, which moves
   * `messagesEnd` up and shrinks `scrollHeight`, so the browser clamps
   * `scrollTop` and the pinned user message slides down until the finished
   * reply is placed. A content resize while a continuation is pending
   * grows the spacer back to what the pin needs and returns to the pin
   * target, unless the user scrolled in the meantime.
   */
  async function keepContinuationPinned() {
    const scrollTarget = continuationScrollTarget
    const container = scrollContainerRef.value
    const messagesEnd = messagesEndRef.value

    if (scrollTarget === null || !container || !messagesEnd) {
      return
    }

    const neededSpacer = getSpacerHeightForScrollTarget(
      scrollTarget,
      container,
      messagesEnd,
    )

    if (neededSpacer <= spacerHeight.value) {
      return
    }

    spacerHeight.value = neededSpacer

    await nextTick()

    if (continuationScrollTarget === null) {
      return
    }

    if (!hasUserTakenOverContinuationScroll) {
      container.scrollTo({ top: scrollTarget, behavior: 'instant' })
    }

    rebroadcastSpacerChange(neededSpacer)
  }

  function releaseContinuationPin() {
    continuationScrollTarget = null
    finalContinuationScrollTarget = null
  }

  function markUserTakeoverOfContinuationScroll() {
    hasUserTakenOverContinuationScroll = true
  }

  function isEditableElement(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
      return false
    }

    return target.isContentEditable
      || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
  }

  /**
   * A wheel event within the momentum window of the pin is the tail of a
   * trackpad scroll that started before the pin, not a new user decision.
   */
  function onContinuationWheel(event: WheelEvent) {
    const elapsedSincePin = event.timeStamp - continuationPinnedAt

    if (elapsedSincePin < CONTINUATION_WHEEL_MOMENTUM_MS) {
      return
    }

    markUserTakeoverOfContinuationScroll()
  }

  function onContinuationKeydown(event: KeyboardEvent) {
    if (
      !SCROLL_KEYS.has(event.key)
      || isEditableElement(event.target)
    ) {
      return
    }

    markUserTakeoverOfContinuationScroll()
  }

  function onContinuationPointerdown(event: PointerEvent) {
    if (event.target !== scrollContainerRef.value) {
      return
    }

    markUserTakeoverOfContinuationScroll()
  }

  useResizeObserver(messagesContentElement, keepContinuationPinned)
  useEventListener(
    scrollContainerRef,
    'wheel',
    onContinuationWheel,
    { passive: true },
  )
  useEventListener(
    scrollContainerRef,
    'touchmove',
    markUserTakeoverOfContinuationScroll,
    { passive: true },
  )
  useEventListener(
    scrollContainerRef,
    'pointerdown',
    onContinuationPointerdown,
    { passive: true },
  )
  useEventListener('keydown', onContinuationKeydown, { passive: true })

  async function pushUserMessageToTop(behavior: ScrollBehavior = 'smooth') {
    releaseContinuationPin()

    const container = scrollContainerRef.value
    const messagesEnd = messagesEndRef.value

    if (!container || !userMessageData.value || !messagesEnd) {
      messagesEndRef?.value?.scrollIntoView({ behavior })

      return
    }

    const containerHeight = container.clientHeight
    const contentHeight = messagesEnd.offsetTop
    const {
      offsetTop: userMessageOffsetTop,
      height: messageHeight,
    } = userMessageData.value

    let resultSpacer: number
      = userMessageOffsetTop - contentHeight + containerHeight
        - INITIAL_SPACER_PADDING

    if (messageHeight > MESSAGE_3_LINES_HEIGHT) {
      resultSpacer += messageHeight + 16 - MESSAGE_3_LINES_HEIGHT
    }

    spacerComputedByPush.value = true
    spacerHeight.value = resultSpacer

    await nextTick()

    messagesEndRef?.value?.scrollIntoView({
      behavior,
    })

    rebroadcastSpacerChange(resultSpacer)
  }

  async function resetSpacer() {
    spacerHeight.value = inputHeight.value

    await nextTick()
  }

  // The clarify topic bubble and the research pending block are rendered as
  // siblings of the message list, not messages themselves, so
  // captureMessageDimensions() never measures them the way a regular user
  // message is measured. getResearchTurnAnchorTop() finds whichever of the
  // two research-turn entry points is currently rendered: the clarify topic
  // bubble (tagged with .js-research-turn-anchor, see [slug].vue) for the
  // clarify-question flow, or the last measured user message for the
  // startResearchJob-after-answers flow. Both share the same offsetParent as
  // messagesEndRef (Chat/Container.vue's single positioned root), so their
  // offsetTop values are directly comparable.
  function getResearchTurnAnchorTop(): number | null {
    const container = scrollContainerRef.value

    if (!container) {
      return null
    }

    const clarifyTopic = container.querySelector<HTMLElement>(
      '.js-research-turn-anchor',
    )

    if (clarifyTopic) {
      return clarifyTopic.offsetTop
    }

    const last = messagesDomRefs.value?.at(-1)

    if (last && last.dataset.role === 'user') {
      return last.offsetTop
    }

    return null
  }

  // Round-8 issue #6: mirrors pushUserMessageToTop()'s pin-to-top math so a
  // research turn in an existing chat behaves like a regular turn instead of
  // collapsing back to the bottom — reusing spacerComputedByPush means the
  // chat-input:height hook won't clobber this reserved height while either
  // entry point is showing. When the anchor can't be measured yet (nothing
  // rendered, or a turn taller than the viewport), this falls back to the
  // round-4 input-clearance floor so the fixed ChatInput never overlaps the
  // clarify form's, pending block's, or pending-image skeleton's buttons on
  // mobile. Also used to reserve space for the pending image-generation
  // skeleton up front (see [slug].vue), so the phantom-to-real skeleton swap
  // grows inside already-reserved space instead of needing a later re-pin.
  async function reservePinnedSpace(
    behavior: ScrollBehavior = 'smooth',
  ): Promise<void> {
    releaseContinuationPin()
    spacerComputedByPush.value = true

    const container = scrollContainerRef.value
    const messagesEnd = messagesEndRef.value
    const anchorTop = getResearchTurnAnchorTop()

    if (!container || !messagesEnd || anchorTop === null) {
      spacerHeight.value = inputHeight.value + INITIAL_SPACER_PADDING
    } else {
      const pinSpacer = anchorTop - messagesEnd.offsetTop
        + container.clientHeight - INITIAL_SPACER_PADDING

      spacerHeight.value = Math.max(
        pinSpacer,
        inputHeight.value + INITIAL_SPACER_PADDING,
        0,
      )
    }

    await nextTick()

    messagesEndRef?.value?.scrollIntoView({ behavior })

    rebroadcastSpacerChange(spacerHeight.value)
  }

  function shouldResetSpacerOnScrollToBottom(): boolean {
    const container = scrollContainerRef.value
    const userMessage = userMessageData.value
    const assistantMessage = assistantMessageData.value

    if (!container || !userMessage || !assistantMessage) {
      return true
    }

    const scrollableSpace: number = container.clientHeight - inputHeight.value
    const lastPairHeight: number = userMessage.height
      + assistantMessage.height
      + MESSAGES_GRID_CONTAINER_GAP_BETWEEN_MESSAGES

    return lastPairHeight > scrollableSpace
  }

  watch(() => chatSdk.status, (status) => {
    if (status === 'ready') {
      continuationScrollTarget = null
    }

    if (status === 'error') {
      releaseContinuationPin()
    }
  })

  watch(() => route.params.slug, () => {
    releaseContinuationPin()
  })

  nuxtApp.hook('chat:submit', () => {
    releaseContinuationPin()
    spacerComputedByPush.value = false
    waitingForDimensions.value = true
  })

  nuxtApp.hook('chat:scroll-to-bottom', async () => {
    releaseContinuationPin()

    if (shouldResetSpacerOnScrollToBottom()) {
      await resetSpacer()
    }

    messagesEndRef?.value?.scrollIntoView({ behavior: 'smooth' })

    rebroadcastSpacerChange(spacerHeight.value)
  })

  /**
   * @description
   * Adjust spacer height on initial page load
   * when chat input height is known on client side.
   * Do it only once when inputHeight is not set yet.
   * Because the textarea could be resized on typing,
   * depends on the length of the input.
   */
  nuxtApp.hook('chat-input:height', (height: number) => {
    reportedInputHeight.value = height
    inputHeight.value = getInputClearance(height)

    scheduleFitSpacerToInputHeight()
  })

  /**
   * While the keyboard covers the page the composer is lifted by its inset,
   * so the rendered spacer grows by the same amount in every spacer mode
   * (fitted to the input or pinned by a push) and the view is scrolled by
   * the growth to keep the same messages above the composer.
   */
  watch(keyboardInset, (inset, previousInset) => {
    if (reportedInputHeight.value) {
      inputHeight.value = getInputClearance(reportedInputHeight.value)
    }

    const growth = inset - previousInset

    if (growth > 0) {
      scrollContainerRef.value?.scrollBy({ top: growth, behavior: 'instant' })
    }

    rebroadcastSpacerChange(renderedSpacerHeight.value)
    scheduleFitSpacerToInputHeight()
  }, { flush: 'post' })

  /**
   * The closed composer hangs its safe-area padding below the screen edge,
   * so that part never covers a message. While the keyboard is open the
   * composer drops that padding; its lift is added by `keyboardInset`.
   */
  function getInputClearance(height: number): number {
    if (isKeyboardOpen.value) {
      return height
    }

    return height - safeAreaBottom.value
  }

  function scheduleFitSpacerToInputHeight() {
    if (!scrollContainerRef.value || spacerComputedByPush.value) {
      return
    }

    if (inputHeightTimer.value) {
      clearTimeout(inputHeightTimer.value)
    }

    inputHeightTimer.value = setTimeout(
      fitSpacerToInputHeight,
      DEFAULT_DELAY_TO_MEASURE_RENDERED_DOM_ELEMENTS,
    )
  }

  async function fitSpacerToInputHeight() {
    const lastMessage = chatSdk.messages.at(-1)

    if (userMessageData.value || lastMessage?.role === 'user') {
      return
    }

    spacerHeight.value = inputHeight.value

    await nextTick()

    scrollContainerRef.value?.scrollTo({
      top: scrollContainerRef.value?.scrollHeight ?? 0,
      behavior: 'instant',
    })

    rebroadcastSpacerChange(spacerHeight.value)
  }

  nuxtApp.hook('chat:regenerate', pushUserMessageToTop)
  nuxtApp.hook('chat:continue', pinUserMessageForContinuation)

  return {
    spacerHeight: renderedSpacerHeight,
    pushUserMessageToTop,
    waitingForDimensions,
    reservePinnedSpace,
  }
}
