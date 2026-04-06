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

export function normalizeChatClientError(error: unknown): ChatErrorPayload {
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

  return {
    code: 'unknown',
    message: parsedException.message || 'The chat request failed.',
    why: parsedException.why,
    fix: parsedException.fix,
    status: parsedException.status,
  }
}

export function buildChatErrorMessage(error: ChatErrorPayload): string {
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

  return lines.join('\n\n')
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

export function applyChatErrorToMessages(
  messages: UIMessage[],
  error: ChatErrorPayload,
): UIMessage[] {
  const nextMessages = [...messages]
  const errorText = buildChatErrorMessage(error)
  const lastMessage = nextMessages[nextMessages.length - 1]
  const errorMessage: UIMessage = {
    id: ulid(),
    role: 'assistant',
    parts: [
      {
        type: 'text',
        text: errorText,
      },
    ],
    createdAt: new Date(),
  } as UIMessage

  if (!hasVisibleAssistantContent(lastMessage)) {
    if (lastMessage?.role === 'assistant') {
      nextMessages[nextMessages.length - 1] = {
        ...lastMessage,
        parts: errorMessage.parts,
      } as UIMessage

      return nextMessages
    }
  }

  nextMessages.push(errorMessage)

  return nextMessages
}

export function useChat(chat: MaybeRefOrGetter<Chat>) {
  const { userModel } = useUserModel()
  const isStopped = shallowRef<boolean>(false)
  const input = useLocalStorage<string>('chat_input', '')
  const files = ref<FileMetadata[]>([])

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
    onFinish({ isAbort, isDisconnect, isError }) {
      if (isAbort || isDisconnect || isError) {
        isStopped.value = true
      }
    },
    onError(error: any) {
      const parsedError = normalizeChatClientError(error)

      chatSdk.messages = applyChatErrorToMessages(
        chatSdk.messages,
        parsedError,
      ) as typeof chatSdk.messages

      useErrorMessage(
        parsedError.message,
        parsedError.why
        || parsedError.fix
        || parsedError.providerRequestId
        || parsedError.requestId,
      )
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
