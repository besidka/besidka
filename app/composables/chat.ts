import type { UIMessage, ChatStatus } from 'ai'
import type { Chat, Tools } from '#shared/types/chats.d'
import { DefaultChatTransport } from 'ai'
import { Chat as ChatSdk } from '@ai-sdk/vue'

export interface ProcessedMessage {
  message: UIMessage
  textParts: Array<{
    part: Extract<UIMessage['parts'][number], { type: 'text' }>
    originalIndex: number
  }>
  hasSources: boolean
}

export function useChat(chat: MaybeRefOrGetter<Chat>) {
  const { userModel } = useUserModel()
  const isStopped = shallowRef<boolean>(false)
  const input = useCookie<string>('chat_input', {
    default: () => '',
  })

  chat = toValue(chat)

  const tools = shallowRef<Tools>(
    chat.messages[chat.messages.length - 1]?.tools || [],
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
          },
        }
      },
    }),
    onFinish() {
      isStopped.value = false
    },
    onError(error: any) {
      const { message } = typeof error.message === 'string'
        && error.message[0] === '{'
        ? JSON.parse(error.message)
        : error

      useErrorMessage(message)
    },
  })

  const rawMessages = computed<UIMessage[]>(() => chatSdk.messages)
  const status = computed<ChatStatus>(() => chatSdk.status)

  // Pre-process messages for rendering
  const messages = computed<ProcessedMessage[]>(() => {
    return rawMessages.value.map((message): ProcessedMessage => {
      const textParts = message.parts
        .map((part, index) => ({ part, originalIndex: index }))
        .filter(({ part }) => part.type === 'text')
        .map(({ part, originalIndex }) => ({
          part: part as Extract<typeof part, { type: 'text' }>,
          originalIndex,
        }))

      const hasSources = message.parts.some(
        part => part.type === 'source-url',
      )

      return {
        message,
        textParts,
        hasSources,
      }
    })
  })

  const messagesLength = computed<number>(() => rawMessages.value.length)
  const lastMessage = computed<UIMessage | undefined>(() => {
    return rawMessages.value.at(-1)
  })

  const isLoading = computed<boolean>(() => {
    return status.value === 'submitted'
      || (
        status.value === 'streaming'
        && lastMessage.value?.role === 'assistant'
        && !lastMessage.value?.parts?.length
      )
  })
  const displayRegenerate = computed<boolean>(() => {
    return isStopped.value
      || (
        !input.value
        && (
          lastMessage.value?.role === 'user'
          || (
            lastMessage.value?.role === 'assistant'
            && (
              !lastMessage.value?.parts?.length
              || (
                lastMessage.value?.parts?.length === 1
                && lastMessage.value?.parts[0]?.type === 'step-start'
              )
            )
          )
        )
      )
  })

  onMounted(() => {
    if (
      chat?.messages.length === 1
      || chat?.messages.pop()?.role === 'user'
    ) {
      chatSdk.regenerate()
    }
  })

  useSetChatTitle(chat.title)

  function submit() {
    chatSdk.sendMessage({ text: input.value })
  }

  function stop() {
    isStopped.value = true
    chatSdk.stop()
  }

  return {
    messages,
    messagesLength,
    input,
    submit,
    stop,
    isStopped,
    regenerate: chatSdk.regenerate,
    tools,
    status,
    isLoading,
    displayRegenerate,
  }
}
