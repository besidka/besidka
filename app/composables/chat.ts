import type { Chat, Tools } from '#shared/types/chats.d'
import { useChat as useChatSdk } from '@ai-sdk/vue'

export function useChat(chat: MaybeRefOrGetter<Chat>) {
  const { userModel } = useUserModel()
  const { scrollInterval, scrollToBottom } = useChatScroll()

  chat = toValue(chat)

  const tools = shallowRef<Tools>(
    chat.messages[chat.messages.length - 1]?.tools || [],
  )

  const {
    messages,
    input,
    handleSubmit,
    reload,
    stop: _stop,
    status,
  } = useChatSdk({
    id: chat.id,
    api: `/api/v1/chats/${chat.slug}`,
    initialMessages: chat.messages,
    experimental_prepareRequestBody({ messages }) {
      return {
        model: userModel.value,
        tools: tools.value,
        messages,
      }
    },
    onError(error) {
      const { message } = typeof error.message === 'string'
        && error.message[0] === '{'
        ? JSON.parse(error.message)
        : error

      useErrorMessage(message)
    },
  })

  onMounted(() => {
    if ((chat?.messages?.length || 0) > 1) {
      scrollToBottom()
    } else if (
      chat?.messages.length === 1
      || chat?.messages.pop()?.role === 'user'
    ) {
      reload()
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

  return {
    messages,
    input,
    handleSubmit,
    reload,
    tools,
    status,
  }
}
