import { parseError } from 'evlog'
import type { MaybeRefOrGetter } from 'vue'

export const NEW_CHAT_BESIDKA_TOOLS_KEY = 'new'

export interface BesidkaToolsSelectionState {
  chatKey: string
  enabled: boolean
  isKnown: boolean
}

/**
 * Whether Besidka tools can be offered in chats at all: the `besidka-tools`
 * Labs opt-in and tool approvals, without which the tools are never exposed.
 */
export function useBesidkaToolsAvailability() {
  const besidkaToolsFeature = useFeature('besidka-tools')
  const toolApprovalsFeature = useFeature('tool-approvals')

  return computed<boolean>(() => {
    return besidkaToolsFeature.value.active
      && toolApprovalsFeature.value.active
  })
}

/**
 * The per-chat Besidka choice shared by the picker and the send body. On by
 * default. `isKnown` is false until the stored choice was read (or handed
 * over from the new-chat page), so a send never overwrites a stored choice it
 * has not seen.
 */
export function useBesidkaToolsSelection() {
  const selection = useState<BesidkaToolsSelectionState>(
    'besidka-tools:selection',
    () => ({
      chatKey: NEW_CHAT_BESIDKA_TOOLS_KEY,
      enabled: true,
      isKnown: true,
    }),
  )

  function handOff(chatSlug: string) {
    if (selection.value.chatKey !== NEW_CHAT_BESIDKA_TOOLS_KEY) {
      return
    }

    selection.value = {
      chatKey: chatSlug,
      enabled: selection.value.enabled,
      isKnown: true,
    }
  }

  return { selection, handOff }
}

export function useComposerBesidkaTools(
  chatSlug: MaybeRefOrGetter<string | null>,
) {
  const isAvailable = useBesidkaToolsAvailability()
  const { selection } = useBesidkaToolsSelection()
  const isSaving = shallowRef<boolean>(false)
  const loadingChatKey = shallowRef<string | null>(null)

  const chatKey = computed<string>(() => {
    return toValue(chatSlug) ?? NEW_CHAT_BESIDKA_TOOLS_KEY
  })

  const isEnabled = computed<boolean>(() => {
    return selection.value.chatKey === chatKey.value
      ? selection.value.enabled
      : true
  })

  watch(chatKey, (key) => {
    if (selection.value.chatKey === key) {
      return
    }

    selection.value = {
      chatKey: key,
      enabled: true,
      isKnown: key === NEW_CHAT_BESIDKA_TOOLS_KEY,
    }
  }, { immediate: true })

  watch(
    [isAvailable, chatKey, () => selection.value.isKnown],
    async ([available, key, isKnown]) => {
      if (
        !available
        || isKnown
        || key === NEW_CHAT_BESIDKA_TOOLS_KEY
        || loadingChatKey.value === key
      ) {
        return
      }

      loadingChatKey.value = key

      try {
        const response = await $fetch(`/api/v1/chats/${key}/besidka-tools`)

        if (selection.value.chatKey !== key || selection.value.isKnown) {
          return
        }

        selection.value = {
          chatKey: key,
          enabled: response.enabled,
          isKnown: true,
        }
      } catch {
        return
      } finally {
        loadingChatKey.value = null
      }
    },
    { immediate: true },
  )

  async function toggle() {
    if (isSaving.value) {
      return
    }

    const key = chatKey.value
    const slug = toValue(chatSlug)
    const previous = selection.value
    const enabled = !isEnabled.value

    selection.value = { chatKey: key, enabled, isKnown: true }

    if (!slug) {
      return
    }

    isSaving.value = true

    try {
      const response = await $fetch(`/api/v1/chats/${slug}/besidka-tools`, {
        method: 'PUT',
        body: { enabled },
      })

      if (selection.value.chatKey === key) {
        selection.value = {
          chatKey: key,
          enabled: response.enabled,
          isKnown: true,
        }
      }
    } catch (exception) {
      if (selection.value.chatKey === key) {
        selection.value = previous
      }

      const parsedException = parseError(exception)

      useErrorMessage(
        parsedException.message || 'Could not update Besidka tools',
        parsedException.why,
      )
    } finally {
      isSaving.value = false
    }
  }

  return {
    isAvailable,
    isEnabled,
    isSaving,
    toggle,
  }
}
