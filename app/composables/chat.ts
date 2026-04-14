import type {
  UIMessage,
  TextUIPart,
  SourceUrlUIPart,
  ReasoningUIPart,
} from 'ai'
import type { ChatErrorPayload } from '#shared/types/chat-errors.d'
import type { Chat, Tools } from '#shared/types/chats.d'
import type { FileMetadata } from '#shared/types/files.d'
import type { ReasoningLevel } from '#shared/types/reasoning.d'
import { parseError } from 'evlog'
import { DefaultChatTransport } from 'ai'
import { Chat as ChatSdk } from '@ai-sdk/vue'
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

export function normalizeChatClientError(
  error: unknown,
  options: NormalizeChatClientErrorOptions = {},
): ChatErrorPayload {
  if (error instanceof Error && error.message.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(error.message) as ChatErrorPayload

      if (parsed?.message) {
        return parsed
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

export function useChat(chat: MaybeRefOrGetter<Chat>) {
  const { userModel } = useUserModel()
  const isStopped = shallowRef<boolean>(false)
  const input = useLocalStorage<string>('chat_input', '')
  const files = ref<FileMetadata[]>([])
  const pendingError = shallowRef<ChatErrorPayload | null>(null)
  const transportRequestId = shallowRef<string>()
  const reportedClientErrorIds = new Set<string>()

  chat = toValue(chat)

  const tools = shallowRef<Tools>(
    chat.messages[chat.messages.length - 1]?.tools || [],
  )
  const savedReasoningLevel = useLocalStorage<ReasoningLevel>(
    'settings_reasoning_level',
    'off',
  )
  const reasoning = shallowRef<ReasoningLevel>(
    normalizeReasoningLevel(savedReasoningLevel.value),
  )
  const { api, shouldAutoRegenerate } = useChatTest(chat, reasoning)

  const chatSdk = new ChatSdk({
    id: chat.id,
    messages: chat.messages,
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
      const parsedError = pendingError.value

      pendingError.value = null
      transportRequestId.value = undefined

      if (parsedError) {
        if (shouldSurfaceChatError(messages, parsedError)) {
          chatSdk.messages = showChatError(
            messages,
            parsedError,
          ) as typeof chatSdk.messages
        } else {
          chatSdk.clearError()
        }
      }

      if (isAbort || isDisconnect) {
        isStopped.value = true
        return
      }

      if (isError) {
        isStopped.value = parsedError
          ? shouldSurfaceChatError(messages, parsedError)
          : true
      }
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

  const lastMessage = computed<UIMessage | undefined>(() => {
    return chatSdk.messages.at(-1)
  })

  const isLoading = computed<boolean>(() => {
    if (chatSdk.status === 'submitted') {
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

  onMounted(() => {
    if (
      (chat?.messages.length === 1 || chat?.messages.at(-1)?.role === 'user')
      && shouldAutoRegenerate.value
    ) {
      chatSdk.regenerate()
    }
  })

  useSetChatTitle(chat.title)

  const nuxtApp = useNuxtApp()

  async function submit() {
    isStopped.value = false

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

    chatSdk.messages.push({
      id: ulid(),
      role: 'user',
      parts,
      createdAt: new Date(),
      reasoning: reasoning.value,
    } as any)

    chatSdk.regenerate()
  }

  function stop() {
    chatSdk.stop()
    nuxtApp.callHook('chat:stop')
  }

  function regenerate() {
    isStopped.value = false
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
    messages: chatSdk.messages,
    messagesLength: chatSdk.messages.length,
    input,
    submit,
    stop,
    isStopped,
    regenerate,
    tools,
    reasoning,
    getMessageReasoning,
    status: chatSdk.status,
    isLoading,
    displayRegenerate,
    displayStop,
    isLastUserMessage,
    isLastAssistantMessage,
    shouldDisplayMessage,
    files,
  }
}
