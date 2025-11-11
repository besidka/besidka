import type { Ref, ShallowRef } from 'vue'
import type { UIMessage } from 'ai'

type MessageData = {
  id: UIMessage['id']
  height: number
  offsetTop: number
}

export interface ChatScrollOptions {
  scrollContainerRef: Ref<HTMLElement | null>
  messagesDomRefs: Readonly<ShallowRef<HTMLDivElement[] | null>>
  messagesEndRef: Ref<HTMLElement | null>
  chatSdk: ReturnType<typeof useChat>['chatSdk']
}

const INITIAL_SPACER_PADDING: number = 12
const MESSAGES_GRID_CONTAINER_GAP_BETWEEN_MESSAGES: number = 12
const MESSAGE_3_LINES_HEIGHT: number = 100
const DEFAULT_DELAY_TO_MEASURE_RENDERED_DOM_ELEMENTS: number = 100

export function useChatScroll(
  options: ChatScrollOptions,
) {
  const {
    scrollContainerRef,
    messagesDomRefs,
    messagesEndRef,
    chatSdk,
  } = options

  const nuxtApp = useNuxtApp()
  const { safeAreaTop, safeAreaBottom } = useDeviceSafeArea()

  const userMessageData = shallowRef<MessageData | null>(null)
  const assistantMessageData = shallowRef<MessageData | null>(null)
  const spacerHeight = shallowRef<number>(INITIAL_SPACER_PADDING)
  const inputHeight = shallowRef<number>(0)

  const waitingForDimensions = shallowRef<boolean>(false)

  const capturedUserMessages = new Set<string>()
  const capturedAssistantMessages = new Set<string>()
  const assistantDebounceTimer = shallowRef<NodeJS.Timeout | null>(null)
  let lastAssistantMessageId: string | null = null

  onUpdated(() => {
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

          if (!['submitted', 'streaming'].includes(chatSdk.status)) {
            return
          }

          pushUserMessageToTop()

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
  })

  async function adjustSpacerAfterResponse() {
    if (chatSdk.messages.length <= 1) {
      return
    }

    const container = scrollContainerRef.value
    const messagesEnd = messagesEndRef.value
    const userMessage = userMessageData.value
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

    spacerHeight.value = 0

    await nextTick()

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
      extraSpacerForTallUserMessage = userMessageHeight - MESSAGE_3_LINES_HEIGHT
        // unknown value in this formula to make it work properly
        + 16
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

    spacerHeight.value = resultSpacer

    nuxtApp.callHook('chat-spacer:changed', resultSpacer)

    await nextTick()

    container.scrollTo({
      top: userMessage.offsetTop
        + extraSpacerForTallUserMessage
        - extraSpaceForScroll,
      behavior: 'instant',
    })
  }

  async function pushUserMessageToTop() {
    if (chatSdk.messages.length <= 1) {
      return
    }

    const container = scrollContainerRef.value
    const messagesEnd = messagesEndRef.value

    if (!container || !userMessageData.value || !messagesEnd) {
      return
    }

    let resultSpacer: number = 0

    const containerHeight = container.clientHeight
    const contentHeight = messagesEnd.offsetTop
    const {
      offsetTop: userMessageOffsetTop,
      height: messageHeight,
    } = userMessageData.value

    resultSpacer = userMessageOffsetTop - contentHeight + containerHeight
      - INITIAL_SPACER_PADDING

    if (
      chatSdk.messages.length > 2
      && messageHeight > MESSAGE_3_LINES_HEIGHT
    ) {
      resultSpacer += messageHeight + 16 - MESSAGE_3_LINES_HEIGHT
    }

    spacerHeight.value = resultSpacer

    nuxtApp.callHook('chat-spacer:changed', resultSpacer)

    await nextTick()

    messagesEndRef?.value?.scrollIntoView()
  }

  nuxtApp.hook('chat:submit', () => {
    waitingForDimensions.value = true
  })

  nuxtApp.hook('chat:scroll-to-bottom', () => {
    messagesEndRef?.value?.scrollIntoView({ behavior: 'smooth' })
  })

  /**
   * @description
   * Adjust spacer height on initial page load
   * when chat input height is known on client side.
   * Do it only once when inputHeight is not set yet.
   * Because the textarea could be resized on typing,
   * depends on the length of the input.
   */
  nuxtApp.hook('chat-input:height', async (height: number) => {
    if (inputHeight.value !== height) {
      inputHeight.value = height - safeAreaBottom.value
    }

    if (!scrollContainerRef.value) {
      return
    }

    /**
     * @description
     * Actually here had to be
     * + INITIAL_SPACER_PADDING - MESSAGES_GRID_CONTAINER_GAP_BETWEEN_MESSAGES
     * But while they are equal to each other we can skip them
     */
    const resultSpacer: number = height - safeAreaBottom.value

    spacerHeight.value = resultSpacer

    nuxtApp.callHook('chat-spacer:changed', resultSpacer)

    await nextTick()

    scrollContainerRef.value.scrollTo({
      top: scrollContainerRef.value.scrollHeight,
      behavior: 'instant',
    })
  })

  nuxtApp.hook('chat:regenerate', pushUserMessageToTop)

  return {
    spacerHeight,
    pushUserMessageToTop,
    waitingForDimensions,
  }
}
