import type {
  UIMessage,
  TextUIPart,
  SourceUrlUIPart,
  ReasoningUIPart,
  ChatStatus,
} from 'ai'
import type { ChatErrorPayload } from '#shared/types/chat-errors.d'
import type { Chat, Tools } from '#shared/types/chats.d'
import type { FileMetadata } from '#shared/types/files.d'
import type { ReasoningLevel } from '#shared/types/reasoning.d'
import { parseError } from 'evlog'
import { DefaultChatTransport } from 'ai'
import { useChat as useChatSdk } from '@ai-sdk/vue'
import { ulid } from 'ulid'

export interface ProcessedMessage {
  message: UIMessage
  reasoningParts: ReasoningUIPart[]
  textParts: TextUIPart[]
  sourceUrlParts: SourceUrlUIPart[]
}

export interface ChatErrorTextPart extends TextUIPart {
  error: ChatErrorPayload
}

interface NormalizeChatClientErrorOptions {
  requestId?: string
}

interface ChatClientErrorReport {
  message: string
  code: ChatErrorPayload['code']
  requestId: string
  chatId: string
  modelId: string
  providerId?: string
  reason?: string
  status?: number
  transportRequestId?: string
}

function isTransportLoadErrorMessage(message: string | undefined): boolean {
  const normalizedMessage = message?.trim().toLowerCase() || ''

  if (!normalizedMessage) {
    return false
  }

  return normalizedMessage.includes('load error')
    || normalizedMessage.includes('failed to fetch')
    || normalizedMessage.includes('networkerror')
    || normalizedMessage.includes('network request failed')
    || normalizedMessage.includes('the response body is empty')
    || normalizedMessage.includes('load failed')
    || normalizedMessage.includes('fetch failed')
    || normalizedMessage.includes('terminated')
}

function isTransportLoadError(error: ChatErrorPayload): boolean {
  return error.message === 'The chat response failed to load.'
    || isTransportLoadErrorMessage(error.why)
    || isTransportLoadErrorMessage(error.message)
}

export interface TransportInterruptionFlags {
  isAbort: boolean
  isDisconnect: boolean
  isTestChat: boolean
}

// Issue #275: the AI SDK's own isDisconnect flag only fires for a TypeError
// whose message contains "fetch" or "network" — it never matches Safari's
// actual wording ("Load failed") for a connection killed by iOS suspending
// the page. isTransportLoadError() is this codebase's broader, already-
// proven recognizer for that whole error family (issue #263), so this checks
// both rather than trusting the SDK flag alone. A turn flagged this way
// should auto-recover silently (no error bubble, automatic resend) instead
// of surfacing as a user-facing failure. Scoped off for isAbort (the user
// deliberately stopped — never auto-resume that) and the dev test route
// (deliberately simulated errors must still render as errors there).
export function isAutoRecoverableTransportInterruption(
  error: ChatErrorPayload | null,
  flags: TransportInterruptionFlags,
): boolean {
  if (flags.isTestChat || flags.isAbort) {
    return false
  }

  return flags.isDisconnect || (error ? isTransportLoadError(error) : false)
}

// Decides whether a just-completed turn is worth the "you were away when
// this finished" contextual disclosure (issue #275 follow-up). Two distinct
// signals, not one sticky "was the tab ever hidden" flag: a plain
// visibility check alone would false-positive whenever the user backgrounds
// the tab and returns *before* generation finishes (they end up watching it
// complete live, not away when it lands) — hadInterruptionThisTurn instead
// tracks only whether the turn actually had to auto-recover from a
// connection interruption (iOS-suspension scenario), which by definition
// only resolves once the user is back regardless of what the page's live
// visibility state reads by that point.
export function shouldNotifyGenerationReadyWhileHidden(
  hadInterruptionThisTurn: boolean,
  visibilityState: DocumentVisibilityState,
): boolean {
  return hadInterruptionThisTurn || visibilityState === 'hidden'
}

function isChatErrorPayload(value: unknown): value is ChatErrorPayload {
  if (!value || typeof value !== 'object') {
    return false
  }

  const payload = value as Partial<ChatErrorPayload>

  return typeof payload.code === 'string'
    && typeof payload.message === 'string'
}

function normalizeGenericJsonErrorPayload(
  value: unknown,
  requestId: string | undefined,
): ChatErrorPayload | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const payload = value as {
    message?: unknown
    status?: unknown
    statusCode?: unknown
    statusMessage?: unknown
    why?: unknown
    fix?: unknown
  }
  const message = typeof payload.message === 'string'
    ? payload.message
    : typeof payload.statusMessage === 'string'
      ? payload.statusMessage
      : null

  if (!message) {
    return null
  }

  return {
    code: 'unknown',
    message,
    why: typeof payload.why === 'string'
      ? payload.why
      : undefined,
    fix: typeof payload.fix === 'string'
      ? payload.fix
      : undefined,
    status: typeof payload.status === 'number'
      ? payload.status
      : typeof payload.statusCode === 'number'
        ? payload.statusCode
        : undefined,
    requestId,
  }
}

export function normalizeChatClientError(
  error: unknown,
  options: NormalizeChatClientErrorOptions = {},
): ChatErrorPayload {
  if (error instanceof Error && error.message.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(error.message) as ChatErrorPayload

      if (isChatErrorPayload(parsed)) {
        return parsed
      }

      const genericPayload = normalizeGenericJsonErrorPayload(
        parsed,
        options.requestId,
      )

      if (genericPayload) {
        return genericPayload
      }
    } catch (exception) {
      void exception
    }
  }

  const parsedException = parseError(error)
  const requestId = options.requestId || ulid().toLowerCase()

  if (isTransportLoadErrorMessage(parsedException.message)) {
    return {
      code: 'unknown',
      message: 'The chat response failed to load.',
      why: 'The connection was interrupted before the response finished streaming.',
      fix: 'Retry the message. If it keeps failing, contact support with the request ID.',
      status: parsedException.status,
      requestId,
    }
  }

  return {
    code: 'unknown',
    message: parsedException.message || 'The chat request failed.',
    why: parsedException.why,
    fix: parsedException.fix,
    status: parsedException.status,
    requestId: options.requestId,
  }
}

export function shouldSurfaceEmptyAssistantResponse(
  messages: UIMessage[],
): boolean {
  const lastMessage = messages[messages.length - 1]

  if (!lastMessage) {
    return true
  }

  if (lastMessage.role === 'user') {
    return true
  }

  if (lastMessage.role !== 'assistant') {
    return false
  }

  return !hasMeaningfulAssistantParts(lastMessage)
}

// Issue #275: iOS suspends the page on screen-lock or app-switch with no
// grace period, killing the in-flight stream client-side while the server
// (per the tee+persist pipeline below) keeps generating regardless. On
// visibilitychange/focus, this decides whether the chat looks like it was
// cut off mid-turn and should auto-retrigger the existing disconnect-replay
// path (issue #263) instead of waiting for the user to notice and click
// Regenerate.
export function shouldRecoverInterruptedGeneration(
  status: ChatStatus,
  messages: UIMessage[],
): boolean {
  if (status === 'streaming' || status === 'submitted') {
    return false
  }

  return shouldSurfaceEmptyAssistantResponse(messages)
}

export function buildChatErrorLines(error: ChatErrorPayload): string[] {
  const lines = [error.message]

  if (error.why) {
    lines.push(error.why)
  }

  if (error.fix) {
    lines.push(error.fix)
  }

  if (error.providerRequestId) {
    lines.push(`Provider request ID: ${error.providerRequestId}`)
  } else if (error.requestId) {
    lines.push(`Request ID: ${error.requestId}`)
  }

  return lines
}

export function buildChatErrorMessage(error: ChatErrorPayload): string {
  return buildChatErrorLines(error).join('\n\n')
}

function isRateLimitError(error: ChatErrorPayload): boolean {
  if (error.code === 'provider-rate-limit') {
    return true
  }

  const text = `${error.message || ''}\n${error.why || ''}`.toLowerCase()

  return text.includes('rate limit')
    || text.includes('tokens per min')
    || text.includes('too many requests')
    || text.includes('try again in')
}

export function isChatErrorTextPart(
  part: UIMessage['parts'][number] | undefined,
): part is ChatErrorTextPart {
  if (!part || part.type !== 'text') {
    return false
  }

  const record = part as Record<string, unknown>

  return Boolean(
    record.error
    && typeof record.error === 'object'
    && typeof (record.error as ChatErrorPayload).message === 'string',
  )
}

export function hasVisibleAssistantContent(message: UIMessage | undefined) {
  if (!message || message.role !== 'assistant') {
    return false
  }

  return message.parts?.some((part) => {
    if (
      part.type !== 'text'
      && part.type !== 'reasoning'
    ) {
      return false
    }

    return Boolean(part.text?.trim().length)
  }) || false
}

export function hasMeaningfulAssistantParts(message: UIMessage | undefined) {
  if (!message || message.role !== 'assistant') {
    return false
  }

  if (!message.parts?.length) {
    return false
  }

  return message.parts.some((part) => {
    if (
      part.type === 'text'
      || part.type === 'reasoning'
    ) {
      return Boolean(part.text?.trim().length)
    }

    return true
  })
}

export function applyChatErrorToMessages(
  messages: UIMessage[],
  error: ChatErrorPayload,
): UIMessage[] {
  const nextMessages = [...messages]
  const errorText = buildChatErrorMessage(error)
  const lastMessage = nextMessages[nextMessages.length - 1]
  const errorPart = {
    type: 'text',
    text: errorText,
    error,
  } as unknown as TextUIPart
  const errorMessage: UIMessage = {
    id: ulid(),
    role: 'assistant',
    parts: [errorPart],
    createdAt: new Date(),
  } as UIMessage

  if (lastMessage?.role === 'assistant') {
    nextMessages[nextMessages.length - 1] = {
      ...lastMessage,
      parts: hasMeaningfulAssistantParts(lastMessage)
        ? [...lastMessage.parts, ...errorMessage.parts]
        : errorMessage.parts,
    } as UIMessage

    return nextMessages
  }

  nextMessages.push(errorMessage)

  return nextMessages
}

export function shouldSurfaceChatError(
  messages: UIMessage[],
  error: ChatErrorPayload,
): boolean {
  const lastMessage = messages[messages.length - 1]

  if (
    isRateLimitError(error)
    && hasVisibleAssistantContent(lastMessage)
  ) {
    return false
  }

  return true
}

function showChatError(
  messages: UIMessage[],
  error: ChatErrorPayload,
): UIMessage[] {
  useErrorMessage(
    error.message,
    error.why
    || error.fix
    || error.providerRequestId
    || error.requestId,
  )

  return applyChatErrorToMessages(messages, error)
}

function reportChatClientError(payload: ChatClientErrorReport) {
  if (!import.meta.client) {
    return
  }

  const body = JSON.stringify(payload)

  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([body], {
        type: 'application/json',
      })

      navigator.sendBeacon('/api/v1/chats/client-errors', blob)

      return
    }
  } catch (exception) {
    void exception
  }

  globalThis.fetch('/api/v1/chats/client-errors', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body,
    keepalive: true,
  }).catch((exception) => {
    void exception
  })
}

// Bounds how long the client keeps polling a "still generating" turn (issue
// #275) before giving up and falling back to the manual Regenerate button.
// 150 attempts * 4s = 10 min, comfortably covering the 2-3 min generations
// from the bug report with margin, and roughly matching the server's KV ttl
// on the in-flight generation flag (server/api/v1/chats/[slug]/index.post.ts)
// — once that expires a retry just starts a fresh generation instead, which
// is an acceptable fallback.
const MAX_GENERATION_RETRY_ATTEMPTS = 150
const GENERATION_RETRY_DELAY_MS = 4_000

export function useChat(chat: MaybeRefOrGetter<Chat>) {
  const { userModel } = useUserModel()
  const isStopped = shallowRef<boolean>(false)
  const prefStorage = usePreferenceStorage()
  const input = customRef<string>((track, trigger) => ({
    get() {
      track()

      return prefStorage.getItem('chat_input') ?? ''
    },
    set(value) {
      prefStorage.setItem('chat_input', value)
      trigger()
    },
  }))
  const files = ref<FileMetadata[]>([])
  const pendingError = shallowRef<ChatErrorPayload | null>(null)
  const transportRequestId = shallowRef<string>()
  const reportedClientErrorIds = new Set<string>()

  chat = toValue(chat)

  const tools = shallowRef<Tools>(
    chat.messages[chat.messages.length - 1]?.tools || [],
  )
  const savedReasoningLevel = customRef<ReasoningLevel>((track, trigger) => ({
    get() {
      track()

      return (prefStorage.getItem('settings_reasoning_level') as ReasoningLevel)
        ?? 'off'
    },
    set(value) {
      prefStorage.setItem('settings_reasoning_level', value)
      trigger()
    },
  }))
  const reasoning = shallowRef<ReasoningLevel>(
    normalizeReasoningLevel(savedReasoningLevel.value),
  )
  const { api, shouldAutoRegenerate, isTestChat } = useChatTest(chat, reasoning)
  const wakeLock = useWakeLock()
  // True for the whole span of an auto-recovery attempt, including the idle
  // gaps between individual "still generating" polls — chatSdk.status alone
  // settles back to a terminal value between each poll, which would
  // otherwise make the UI flash back to "nothing happening" every cycle.
  const isAwaitingGeneration = shallowRef<boolean>(false)
  let isPendingGenerationRetry = false
  let pendingRetryAttempts = 0
  let pendingRetryTimeoutId: ReturnType<typeof setTimeout> | undefined
  let hadInterruptionThisTurn = false

  const {
    messages: sdkMessages,
    status: sdkStatus,
    error: sdkError,
    regenerate: sdkRegenerate,
    stop: sdkStop,
    clearError: sdkClearError,
  } = useChatSdk<UIMessage>({
    id: chat.id,
    messages: chat.messages as unknown as UIMessage[],
    transport: new DefaultChatTransport({
      api: api.value,
      async fetch(input, init) {
        transportRequestId.value = undefined

        const response = await globalThis.fetch(input, init)

        transportRequestId.value = response.headers.get('cf-ray')
          || response.headers.get('x-request-id')
          || undefined

        return response
      },
      prepareSendMessagesRequest({ messages }) {
        const lastMessage = messages[messages.length - 1]

        return {
          body: {
            model: userModel.value,
            tools: tools.value,
            messages: [lastMessage],
            reasoning: reasoning.value,
          },
        }
      },
    }),
    onFinish({ isAbort, isDisconnect, isError, messages }) {
      const requestId = transportRequestId.value
      const wasPendingGenerationRetry = isPendingGenerationRetry
      let parsedError = pendingError.value

      isPendingGenerationRetry = false

      if (!parsedError && isError) {
        parsedError = normalizeChatClientError(
          sdkError.value || new Error('Load Error'),
          { requestId },
        )
      }

      const wasTransportInterruption = isAutoRecoverableTransportInterruption(
        parsedError,
        { isAbort, isDisconnect, isTestChat: isTestChat.value },
      )

      if (
        !parsedError
        && !isAbort
        && !wasTransportInterruption
        && !wasPendingGenerationRetry
        && shouldSurfaceEmptyAssistantResponse(messages)
      ) {
        parsedError = normalizeChatClientError(
          new Error('Load Error'),
          { requestId },
        )
      }

      pendingError.value = null
      transportRequestId.value = undefined

      // The AI SDK never calls onError on the abort path (it returns before
      // reaching that call), so parsedError && isAbort can't co-occur here in
      // practice — the !isAbort guard is defensive, not load-bearing.
      if (parsedError && !isAbort && !wasTransportInterruption) {
        if (shouldSurfaceChatError(messages, parsedError)) {
          sdkMessages.value = showChatError(
            messages,
            parsedError,
          ) as typeof sdkMessages.value
        } else {
          sdkClearError()
        }
      } else if (parsedError) {
        sdkClearError()
      }

      if (
        wasPendingGenerationRetry
        && !isAbort
        && !wasTransportInterruption
      ) {
        scheduleGenerationRetry()
        return
      }

      if (isAbort) {
        wakeLock.release()
        isAwaitingGeneration.value = false
        hadInterruptionThisTurn = false
        isStopped.value = true
        return
      }

      if (wasTransportInterruption) {
        hadInterruptionThisTurn = true
        recoverFromTransportInterruption()
        return
      }

      wakeLock.release()
      isAwaitingGeneration.value = false

      if (isError) {
        isStopped.value = parsedError
          ? shouldSurfaceChatError(messages, parsedError)
          : true
      } else if (shouldNotifyGenerationReadyWhileHidden(
        hadInterruptionThisTurn,
        document.visibilityState,
      )) {
        nuxtApp.callHook('chat:generation-ready-while-hidden')
      }

      hadInterruptionThisTurn = false
    },
    onError(error: any) {
      const parsedError = normalizeChatClientError(error, {
        requestId: transportRequestId.value,
      })

      pendingError.value = parsedError

      if (
        parsedError.requestId
        && !reportedClientErrorIds.has(parsedError.requestId)
        && isTransportLoadError(parsedError)
      ) {
        reportedClientErrorIds.add(parsedError.requestId)

        const { provider } = getModel(userModel.value)

        reportChatClientError({
          code: parsedError.code,
          message: error instanceof Error
            ? error.message
            : parsedError.message,
          reason: parsedError.why,
          requestId: parsedError.requestId,
          transportRequestId: transportRequestId.value,
          chatId: chat.id,
          modelId: userModel.value,
          providerId: provider?.id,
          status: parsedError.status,
        })
      }
    },
    onData(dataPart) {
      if (dataPart.type === 'data-generation-pending') {
        isPendingGenerationRetry = true
        return
      }

      if (dataPart.type !== 'data-missing-files') {
        return
      }

      const { count, filenames } = dataPart.data as {
        count: number
        filenames: string[]
      }

      if (count === 1 && filenames[0]) {
        useWarningMessage(`File "${filenames[0]}" is no longer available`)
      } else {
        useWarningMessage(
          `${count} attached ${count === 1 ? 'file is' : 'files are'} no longer available`,
        )
      }
    },
  })

  const chatSdk = {
    get messages() {
      return sdkMessages.value
    },
    set messages(value: UIMessage[]) {
      sdkMessages.value = value
    },
    get status() {
      return sdkStatus.value
    },
    get error() {
      return sdkError.value
    },
    regenerate: sdkRegenerate,
    stop: sdkStop,
    clearError: sdkClearError,
  }

  const lastMessage = computed<UIMessage | undefined>(() => {
    return chatSdk.messages.at(-1)
  })

  const isLoading = computed<boolean>(() => {
    if (isAwaitingGeneration.value) {
      return true
    } else if (chatSdk.status === 'submitted') {
      return true
    } else if (chatSdk.status !== 'streaming') {
      return false
    } else if (lastMessage.value?.role !== 'assistant') {
      return false
    } else if (!lastMessage.value.parts?.length) {
      return true
    }

    const result: boolean = true

    for (const part of lastMessage.value.parts) {
      if (!['reasoning', 'text'].includes(part.type)) {
        continue
      }

      const p = part as TextUIPart | ReasoningUIPart

      if (p.text?.length) {
        return false
      }
    }

    return result
  })

  const displayStop = computed<boolean>(() => {
    return ['submitted', 'streaming'].includes(chatSdk.status)
      && !isStopped.value
  })

  const displayRegenerate = computed<boolean>(() => {
    return isStopped.value || chatSdk.status === 'error'
  })

  function clearScheduledGenerationRetry(): void {
    if (pendingRetryTimeoutId === undefined) {
      return
    }

    clearTimeout(pendingRetryTimeoutId)
    pendingRetryTimeoutId = undefined
  }

  // Shared by scheduleGenerationRetry() and recoverFromTransportInterruption()
  // so a network flaky enough to make every recovery attempt disconnect (not
  // just every "still generating" poll) is still bounded by the same cap,
  // instead of looping forever through the immediate-retry path.
  function attemptGenerationRecovery(options: { immediate: boolean }): void {
    isAwaitingGeneration.value = true

    if (pendingRetryAttempts >= MAX_GENERATION_RETRY_ATTEMPTS) {
      isAwaitingGeneration.value = false
      isStopped.value = true
      wakeLock.release()

      return
    }

    pendingRetryAttempts += 1
    clearScheduledGenerationRetry()

    if (!options.immediate) {
      pendingRetryTimeoutId = setTimeout(() => {
        chatSdk.regenerate()
      }, GENERATION_RETRY_DELAY_MS)

      return
    }

    isStopped.value = false
    wakeLock.acquire()
    chatSdk.regenerate()
  }

  function scheduleGenerationRetry(): void {
    attemptGenerationRecovery({ immediate: false })
  }

  // Called once onFinish has already confirmed (via wasTransportInterruption)
  // that this exact turn was cut off — so unlike recoverIfInterrupted() below,
  // this does not re-check shouldRecoverInterruptedGeneration's message-shape
  // heuristic: a turn with substantial partial reasoning/text already visible
  // still needs the resend, since that heuristic only exists to *infer*
  // interruption from message shape when there is no direct signal.
  function recoverFromTransportInterruption(): void {
    attemptGenerationRecovery({ immediate: true })
  }

  function recoverIfInterrupted(): void {
    if (isTestChat.value) {
      return
    }

    if (!shouldRecoverInterruptedGeneration(chatSdk.status, chatSdk.messages)) {
      return
    }

    clearScheduledGenerationRetry()
    isAwaitingGeneration.value = true
    isStopped.value = false
    wakeLock.acquire()
    chatSdk.regenerate()
  }

  function handleVisibilityChange(): void {
    if (document.visibilityState === 'visible') {
      recoverIfInterrupted()
    }
  }

  onMounted(() => {
    if (
      (chat?.messages.length === 1 || chat?.messages.at(-1)?.role === 'user')
      && shouldAutoRegenerate.value
    ) {
      // A reply-less last message on a freshly loaded chat (issue #275) means
      // the previous attempt never persisted before this load — could still
      // be generating server-side, so this may resolve into the same
      // "still generating" poll loop as a live recovery, not just a replay.
      isAwaitingGeneration.value = true
      chatSdk.regenerate()
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', recoverIfInterrupted)
  })

  onUnmounted(() => {
    document.removeEventListener('visibilitychange', handleVisibilityChange)
    window.removeEventListener('focus', recoverIfInterrupted)
    clearScheduledGenerationRetry()
    wakeLock.release()
  })

  useSetChatTitle(chat.title)

  const nuxtApp = useNuxtApp()

  async function submit() {
    isStopped.value = false
    isAwaitingGeneration.value = false
    hadInterruptionThisTurn = false
    pendingRetryAttempts = 0
    clearScheduledGenerationRetry()
    wakeLock.acquire()

    const parts: any[] = []

    if (input.value.trim()) {
      parts.push({
        type: 'text',
        text: input.value,
      })
    }

    if (files.value.length > 0) {
      const fileParts = await convertFilesToUIParts(files.value)

      parts.push(...fileParts)
    }

    chatSdk.messages = [
      ...chatSdk.messages,
      {
        id: ulid(),
        role: 'user',
        parts,
        createdAt: new Date(),
        reasoning: reasoning.value,
      } as unknown as UIMessage,
    ]

    chatSdk.regenerate()
  }

  function stop() {
    clearScheduledGenerationRetry()
    isAwaitingGeneration.value = false
    hadInterruptionThisTurn = false
    wakeLock.release()
    chatSdk.stop()
    nuxtApp.callHook('chat:stop')
  }

  function regenerate() {
    isStopped.value = false
    isAwaitingGeneration.value = false
    hadInterruptionThisTurn = false
    pendingRetryAttempts = 0
    clearScheduledGenerationRetry()
    wakeLock.acquire()
    chatSdk.regenerate()
    nuxtApp.callHook('chat:regenerate')
  }

  function isLastUserMessage(index: number): boolean {
    const message = chatSdk.messages[index]

    if (!message || message.role !== 'user') return false

    const lastMessage = chatSdk.messages[chatSdk.messages.length - 1]

    return index === chatSdk.messages.length - 1
      || (
        index === chatSdk.messages.length - 2
        && lastMessage?.role === 'assistant'
      )
  }

  function isLastAssistantMessage(index: number): boolean {
    const message = chatSdk.messages[index]

    if (!message || message.role !== 'assistant') return false

    return index === chatSdk.messages.length - 1
  }

  function shouldDisplayMessage(id: UIMessage['id']): boolean {
    const message = chatSdk.messages.find(
      candidate => candidate.id === id,
    )

    if (!message) {
      return false
    } else if (message.role === 'user') {
      return true
    }

    return message.parts?.some((part) => {
      return (part.type === 'reasoning' && part.text?.length)
        || (part.type === 'text' && part.text?.length)
    }) || false
  }

  function getMessageReasoning(
    message: UIMessage,
    index: number,
  ): ReasoningLevel {
    const persistedReasoning = normalizeReasoningLevel(
      (message as UIMessage & {
        reasoning?: unknown
      }).reasoning,
    )

    if (persistedReasoning !== 'off') {
      return persistedReasoning
    }

    if (message.role !== 'assistant') {
      return persistedReasoning
    }

    for (let messageIndex = index - 1; messageIndex >= 0; messageIndex -= 1) {
      const candidate = chatSdk.messages[messageIndex]

      if (candidate?.role !== 'user') {
        continue
      }

      return normalizeReasoningLevel(
        (candidate as UIMessage & {
          reasoning?: unknown
        }).reasoning,
      )
    }

    return 'off'
  }

  watch(reasoning, (level) => {
    savedReasoningLevel.value = level
  }, {
    immediate: true,
    flush: 'post',
  })

  return {
    chatSdk,
    input,
    submit,
    stop,
    isStopped,
    regenerate,
    tools,
    reasoning,
    getMessageReasoning,
    isLoading,
    displayRegenerate,
    displayStop,
    isLastUserMessage,
    isLastAssistantMessage,
    shouldDisplayMessage,
    files,
  }
}
