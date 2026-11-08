import type {
  ChatContextResponse,
  SharedChatContextResponse,
} from '#shared/types/chat-context.d'

export type ChatContextData
  = | ({ kind: 'owned' } & ChatContextResponse)
    | ({ kind: 'shared' } & SharedChatContextResponse)

export const CHAT_CONTEXT_VIEW_KEY = 'chat-context'

/**
 * The chat context aggregate for the chat on the current route, shared by the
 * nav pill badge and the context panel through one async-data key. It loads
 * lazily on the client and does nothing on other pages. `data` is null until
 * the response belongs to the chat on the route: Nuxt seeds a new key with
 * the previous key's data, which would show chat A while chat B loads.
 * `refresh()` cancels an in-flight request, so a refresh after a change never
 * resolves with data fetched before it.
 */
export function useChatContext() {
  const { routeSlug, isOwnedChatPage, isSharedChatPage } = useChatRoute()

  const key = computed<string>(() => {
    if (isOwnedChatPage.value) {
      return `chat-context:owned:${routeSlug.value}`
    }

    if (isSharedChatPage.value) {
      return `chat-context:shared:${routeSlug.value}`
    }

    return 'chat-context:none'
  })

  const asyncData = useLazyAsyncData<ChatContextData | null>(
    key,
    async () => {
      const slug = routeSlug.value

      if (isOwnedChatPage.value) {
        const response = await $fetch(`/api/v1/chats/${slug}/context`)

        return { kind: 'owned', ...response } as ChatContextData
      }

      if (isSharedChatPage.value) {
        const response = await $fetch(`/api/v1/shared/${slug}/context`)

        return { kind: 'shared', ...response } as ChatContextData
      }

      return null
    },
    {
      server: false,
      dedupe: 'defer',
      default: () => null,
    },
  )

  const data = computed<ChatContextData | null>(() => {
    const value = asyncData.data.value

    return value && value.chat.slug === routeSlug.value ? value : null
  })

  const outputsCount = computed<number>(() => {
    return data.value?.counts.outputs ?? 0
  })

  function refresh() {
    return asyncData.refresh({ dedupe: 'cancel' })
  }

  return {
    ...asyncData,
    data,
    refresh,
    outputsCount,
  }
}
