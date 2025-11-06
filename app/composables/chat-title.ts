import type { Chat } from '#shared/types/chats.d'

export async function useSetChatTitle(title?: Chat['title']) {
  const route = useRoute()
  const { userModel } = useUserModel()

  const {
    data: chatTitle,
    error: chatTitleError,
  } = await useLazyFetch(
    `/api/v1/chats/${route.params.slug}/title`,
    {
      method: 'patch',
      key: `chat-title-${route.params.slug}`,
      cache: 'force-cache',
      immediate: !title,
      body: {
        model: userModel.value,
      },
      default: () => title || null,
    },
  )

  watch(chatTitleError, () => {
    if (!chatTitleError.value) {
      return
    }

    throw createError({
      statusCode: chatTitleError.value.status || 500,
      statusMessage:
      chatTitleError.value.statusMessage
      || 'An error occurred while fetching the chat',
      data: chatTitleError.value,
    })
  }, {
    flush: 'post',
    immediate: false,
    once: true,
  })

  watch(chatTitle, (value) => {
    if (!value) {
      return
    }

    useSeoMeta({
      title: value,
    })
  }, {
    flush: 'post',
    immediate: false,
    once: true,
  })
}
