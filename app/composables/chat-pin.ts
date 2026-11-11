import { parseError } from 'evlog'
import type { ChatContextData } from '~/composables/chat-context'

interface PinnableChat {
  id: string
  slug: string
  pinnedAt: string | null
}

export function setChatContextPinned(slug: string, pinnedAt: string | null) {
  const nuxtApp = useNuxtApp()
  const data = nuxtApp._asyncData[`chat-context:owned:${slug}`]?.data as
    Ref<ChatContextData | null | undefined> | undefined

  if (!data || data.value?.kind !== 'owned') {
    return
  }

  data.value = {
    ...data.value,
    chat: { ...data.value.chat, pinnedAt },
  }
}

export function useChatPin() {
  const savingSlug = useState<string | null>(
    'chat-pin:saving-slug',
    () => null,
  )

  async function toggleChatPin(chat: PinnableChat): Promise<boolean> {
    if (savingSlug.value === chat.slug) {
      return false
    }

    savingSlug.value = chat.slug
    setChatContextPinned(
      chat.slug,
      chat.pinnedAt ? null : new Date().toISOString(),
    )

    try {
      const response = await $fetch('/api/v1/chats/history/pin', {
        method: 'POST',
        body: { chatId: chat.id },
      })

      setChatContextPinned(chat.slug, response.pinnedAt)
      setHistoryChatPinnedBySlug(chat.slug, response.pinnedAt)

      return true
    } catch (exception) {
      const parsedException = parseError(exception)

      setChatContextPinned(chat.slug, chat.pinnedAt)
      useErrorMessage(
        parsedException.message || 'Failed to toggle pin',
        parsedException.why,
      )

      return false
    } finally {
      if (savingSlug.value === chat.slug) {
        savingSlug.value = null
      }
    }
  }

  return { savingSlug, toggleChatPin }
}
