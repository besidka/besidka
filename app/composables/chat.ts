import type {
  UIMessage,
  TextUIPart,
  SourceUrlUIPart,
  ReasoningUIPart,
} from 'ai'
import type { Chat, Tools } from '#shared/types/chats.d'
import type { FileMetadata } from '#shared/types/files.d'
import { DefaultChatTransport } from 'ai'
import { Chat as ChatSdk } from '@ai-sdk/vue'

export interface ProcessedMessage {
  message: UIMessage
  reasoningParts: ReasoningUIPart[]
  textParts: TextUIPart[]
  sourceUrlParts: SourceUrlUIPart[]
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

  const isReasoningEnabled = shallowRef<boolean>(
    chat.messages[chat.messages.length - 1]?.reasoning || false,
  )

  const chatSdk = new ChatSdk({
    id: chat.id,
    messages: chat.messages,
    transport: new DefaultChatTransport({
      api: `/api/v1/chats/${chat.slug}`,
      prepareSendMessagesRequest({ messages }) {
        const lastMessage = messages[messages.length - 1]

        return {
          body: {
            model: userModel.value,
            tools: tools.value,
            messages: [lastMessage],
            reasoning: isReasoningEnabled.value,
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
      const { message } = typeof error.message === 'string'
        && error.message[0] === '{'
        ? JSON.parse(error.message)
        : error

      useErrorMessage(message)
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
      chat?.messages.length === 1
      || chat?.messages.at(-1)?.role === 'user'
    ) {
      chatSdk.regenerate()
    }
  })

  useSetChatTitle(chat.title)

  const nuxtApp = useNuxtApp()

  async function submit() {
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
      id: crypto.randomUUID(),
      role: 'user',
      parts,
      createdAt: new Date(),
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
    isReasoningEnabled,
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
