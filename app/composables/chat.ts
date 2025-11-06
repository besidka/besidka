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
    // TODO: investigate why step-start and reasoning parts are here
    // even when disabled in server/api/v1/chats/[slug]/index.post.ts
    // console.log(
    //   JSON.parse(JSON.stringify(lastMessage.value?.parts)),
    // )
    return status.value === 'submitted'
      || (
        status.value === 'streaming'
        && lastMessage.value?.role === 'assistant'
        && !lastMessage.value.parts?.some(part => part.type === 'text')
      )
  })

  const displayStop = computed<boolean>(() => {
    return ['submitted', 'streaming'].includes(status.value)
      && !isStopped.value
  })

  const displayRegenerate = computed<boolean>(() => {
    return isStopped.value || status.value === 'error'
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

  return {
    messages,
    messagesLength,
    input,
    submit,
    stop,
    isStopped,
    regenerate,
    tools,
    status,
    isLoading,
    displayRegenerate,
    displayStop,
  }
}
