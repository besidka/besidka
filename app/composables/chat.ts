import type {
  UIMessage,
  TextUIPart,
  SourceUrlUIPart,
  ReasoningUIPart,
} from 'ai'
import type { Chat, Tools } from '#shared/types/chats.d'
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
  const input = useLocalStorage<string>('chat_input', '', {
    shallow: true,
  })

  chat = toValue(chat)

  const tools = useLocalStorage<Tools>(
    'chat_tools',
    chat.messages[chat.messages.length - 1]?.tools || [],
    {
      shallow: true,
      listenToStorageChanges: false,
      mergeDefaults: (_, defaults) => defaults,
    },
  )

  const isReasoningEnabled = useLocalStorage<boolean>(
    'chat_reasoning',
    chat.messages[chat.messages.length - 1]?.reasoning || false,
    {
      shallow: true,
      listenToStorageChanges: false,
      mergeDefaults: (_, defaults) => defaults,
    },
  )

  const chatSdk = new ChatSdk({
    id: chat.id,
    messages: chat.messages,
    transport: new DefaultChatTransport({
      api: `/api/v1/chats/${chat.slug}`,
      prepareSendMessagesRequest({ messages }) {
        return {
          body: {
            model: userModel.value,
            tools: tools.value,
            messages,
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

  function submit() {
    const payload = { text: input.value }

    chatSdk.sendMessage(payload)
    nuxtApp.callHook('chat:submit', payload)
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
    const msg = chatSdk.messages[index]

    if (!msg || msg.role !== 'user') return false

    const lastMsg = chatSdk.messages[chatSdk.messages.length - 1]

    return index === chatSdk.messages.length - 1
      || (index === chatSdk.messages.length - 2 && lastMsg?.role === 'assistant')
  }

  function isLastAssistantMessage(index: number): boolean {
    const msg = chatSdk.messages[index]

    if (!msg || msg.role !== 'assistant') return false

    return index === chatSdk.messages.length - 1
  }

  function shouldDisplayMessage(id: UIMessage['id']): boolean {
    const message = chatSdk.messages.find(m => m.id === id)

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
  }
}
