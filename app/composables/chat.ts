import type { UIMessage, ChatStatus } from 'ai'
import type { Chat, Tools } from '#shared/types/chats.d'
import { DefaultChatTransport } from 'ai'
import { Chat as ChatSdk } from '@ai-sdk/vue'

export function useChat(chat: MaybeRefOrGetter<Chat>) {
  const { userModel } = useUserModel()
  const { scrollInterval, scrollToBottom } = useChatScroll()
  const input = shallowRef<string>('')

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
    onError(error: any) {
      const { message } = typeof error.message === 'string'
        && error.message[0] === '{'
        ? JSON.parse(error.message)
        : error

      useErrorMessage(message)
    },
  })

  const messages = computed<UIMessage[]>(() => chatSdk.messages)
  const status = computed<ChatStatus>(() => chatSdk.status)

  onMounted(() => {
    if ((chat?.messages?.length || 0) > 1) {
      scrollToBottom()
    } else if (
      chat?.messages.length === 1
      || chat?.messages.pop()?.role === 'user'
    ) {
      chatSdk.regenerate()
    }
  })

  watch(status, (newStatus) => {
    scrollInterval.value && clearInterval(scrollInterval.value)

    scrollToBottom()

    if (newStatus !== 'streaming') {
      return
    }

    scrollInterval.value = setInterval(scrollToBottom, 1000)
  }, {
    immediate: false,
    flush: 'post',
  })

  useSetChatTitle(chat.title)

  function handleSubmit() {
    chatSdk.sendMessage({ text: input.value })
  }

  return {
    messages,
    input,
    handleSubmit,
    regenerate: chatSdk.regenerate,
    tools,
    status,
  }
}
