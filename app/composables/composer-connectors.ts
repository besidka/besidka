import { parseError } from 'evlog'
import type { MaybeRefOrGetter } from 'vue'
import { CONNECTORS_PER_SEND } from '#shared/utils/connectors-policy'

export const CONNECTORS_LIBRARY_KEY = 'connectors-library'
export const NEW_CHAT_CONNECTORS_KEY = 'new'

export interface ComposerConnectorItem {
  id: string
  slug: string
  title: string
  host: string
  status: 'ready' | 'drifted'
  presetId: string | null
  isIconAvailable: boolean
}

export interface ChatConnectorSelectionState {
  chatKey: string
  ids: string[]
  isKnown: boolean
}

export interface TurnAllOnPlan {
  ids: string[]
  skippedCount: number
}

/**
 * The selection after "Turn all on": the connectors already on stay on, the
 * rest follow in list order until the per-send cap is reached. `skippedCount`
 * is how many stayed off because of the cap.
 */
export function planTurnAllOn(
  itemIds: readonly string[],
  selectedIds: readonly string[],
  cap: number = CONNECTORS_PER_SEND,
): TurnAllOnPlan {
  const known = new Set(itemIds)
  const ids = selectedIds.filter(id => known.has(id))

  for (const itemId of itemIds) {
    if (ids.length >= cap) {
      break
    }

    if (!ids.includes(itemId)) {
      ids.push(itemId)
    }
  }

  return { ids, skippedCount: itemIds.length - ids.length }
}

function isSelectableConnector(connector: {
  enabled: boolean
  status: string
}): boolean {
  return connector.enabled
    && (connector.status === 'ready' || connector.status === 'drifted')
}

/**
 * The per-chat connector choice shared by the composer and the send body.
 * `isKnown` is false until the stored choice was read (or handed over from
 * the new-chat page), so a send never overwrites a stored choice it has not
 * seen.
 */
export function useChatConnectorSelection() {
  const selection = useState<ChatConnectorSelectionState>(
    'connectors:selection',
    () => ({ chatKey: NEW_CHAT_CONNECTORS_KEY, ids: [], isKnown: true }),
  )

  function handOff(chatSlug: string) {
    if (
      selection.value.chatKey !== NEW_CHAT_CONNECTORS_KEY
      || selection.value.ids.length === 0
    ) {
      return
    }

    selection.value = {
      chatKey: chatSlug,
      ids: selection.value.ids,
      isKnown: true,
    }
  }

  return { selection, handOff }
}

/**
 * Every connector of the account, fetched lazily and only while the
 * `connectors` flag is on. A failed fetch leaves the list empty, never an
 * error in the composer.
 */
export function useConnectorLibrary() {
  const connectorsFeature = useFeature('connectors')
  const { data, execute } = useLazyFetch('/api/v1/connectors', {
    key: CONNECTORS_LIBRARY_KEY,
    immediate: false,
    server: false,
  })

  const connectors = computed(() => {
    return connectorsFeature.value.active ? data.value?.connectors ?? [] : []
  })

  const isLoaded = computed<boolean>(() => {
    return connectorsFeature.value.active && !!data.value
  })

  watch(() => connectorsFeature.value.active, async (isActive) => {
    if (isActive && !data.value) {
      await execute({ dedupe: 'defer' })
    }
  }, { immediate: true })

  return {
    connectors,
    isLoaded,
    isActive: computed<boolean>(() => connectorsFeature.value.active),
    refresh: execute,
  }
}

export function useComposerConnectors(
  chatSlug: MaybeRefOrGetter<string | null>,
) {
  const library = useConnectorLibrary()
  const { selection } = useChatConnectorSelection()
  const isSaving = shallowRef<boolean>(false)
  const loadingChatKey = shallowRef<string | null>(null)

  const chatKey = computed<string>(() => {
    return toValue(chatSlug) ?? NEW_CHAT_CONNECTORS_KEY
  })

  const items = computed<ComposerConnectorItem[]>(() => {
    return library.connectors.value
      .filter(isSelectableConnector)
      .map((connector) => {
        return {
          id: connector.id,
          slug: connector.slug,
          title: connector.title,
          host: connector.host,
          status: connector.status as ComposerConnectorItem['status'],
          presetId: connector.presetId,
          isIconAvailable: hasConnectorIcon(connector),
        }
      })
      .sort((left, right) => left.title.localeCompare(right.title))
  })

  const isVisible = computed<boolean>(() => library.isActive.value)

  const selectedIds = computed<string[]>(() => {
    return selection.value.chatKey === chatKey.value
      ? selection.value.ids
      : []
  })

  const selectedCount = computed<number>(() => {
    return selectedIds.value.length
  })

  const isAtLimit = computed<boolean>(() => {
    return selectedCount.value >= CONNECTORS_PER_SEND
  })

  watch(chatKey, (key) => {
    if (selection.value.chatKey === key) {
      return
    }

    selection.value = {
      chatKey: key,
      ids: [],
      isKnown: key === NEW_CHAT_CONNECTORS_KEY,
    }
  }, { immediate: true })

  watch(
    [library.isLoaded, () => items.value.length, chatKey, () => {
      return selection.value.isKnown
    }],
    async ([isLoaded, itemCount, key, isKnown]) => {
      if (
        !isLoaded
        || itemCount === 0
        || isKnown
        || key === NEW_CHAT_CONNECTORS_KEY
        || loadingChatKey.value === key
      ) {
        return
      }

      loadingChatKey.value = key

      try {
        const response = await $fetch(
          `/api/v1/chats/${key}/connectors`,
        )

        if (selection.value.chatKey !== key || selection.value.isKnown) {
          return
        }

        const selectableIds = new Set(items.value.map(item => item.id))

        selection.value = {
          chatKey: key,
          ids: response.connectorIds.filter(id => selectableIds.has(id)),
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

  watch(
    [library.isLoaded, items, () => selection.value.ids],
    ([isLoaded, currentItems, currentIds]) => {
      if (!isLoaded || selection.value.chatKey !== chatKey.value) {
        return
      }

      const knownIds = new Set(currentItems.map(item => item.id))
      const keptIds = currentIds.filter(id => knownIds.has(id))

      if (keptIds.length !== currentIds.length) {
        selection.value = { ...selection.value, ids: keptIds }
      }
    },
    { immediate: true },
  )

  async function setSelectedIds(nextIds: string[]) {
    const key = chatKey.value
    const slug = toValue(chatSlug)
    const previous = selection.value

    selection.value = { chatKey: key, ids: nextIds, isKnown: true }

    if (!slug) {
      return
    }

    isSaving.value = true

    try {
      const response = await $fetch(`/api/v1/chats/${slug}/connectors`, {
        method: 'PUT',
        body: { connectorIds: nextIds },
      })

      if (selection.value.chatKey === key) {
        selection.value = {
          chatKey: key,
          ids: response.connectorIds,
          isKnown: true,
        }
      }
    } catch (exception) {
      if (selection.value.chatKey === key) {
        selection.value = previous
      }

      const parsedException = parseError(exception)

      useErrorMessage(
        parsedException.message || 'Could not update connectors',
        parsedException.why,
      )
    } finally {
      isSaving.value = false
    }
  }

  async function toggle(connectorId: string) {
    if (isSaving.value) {
      return
    }

    const isSelected = selectedIds.value.includes(connectorId)

    if (!isSelected && isAtLimit.value) {
      return
    }

    await setSelectedIds(
      isSelected
        ? selectedIds.value.filter(id => id !== connectorId)
        : [...selectedIds.value, connectorId],
    )
  }

  async function setAll(nextIds: string[]) {
    if (isSaving.value) {
      return
    }

    const knownIds = new Set(items.value.map(item => item.id))

    await setSelectedIds(
      nextIds.filter(id => knownIds.has(id)).slice(0, CONNECTORS_PER_SEND),
    )
  }

  async function clear() {
    if (isSaving.value || selectedIds.value.length === 0) {
      return
    }

    await setSelectedIds([])
  }

  return {
    items,
    isVisible,
    isLoaded: library.isLoaded,
    selectedIds,
    selectedCount,
    isAtLimit,
    isSaving,
    toggle,
    setAll,
    clear,
    refresh: library.refresh,
  }
}

/**
 * Display titles and ids for connector tool steps, by slug, read from the
 * cached list without fetching it (the step component loads it). A deleted
 * connector has no entry, so callers fall back to the slug.
 */
export function useConnectorTitles() {
  const { data } = useNuxtData<{
    connectors: Array<{ id: string, slug: string, title: string }>
  }>(CONNECTORS_LIBRARY_KEY)

  const titlesBySlug = computed<Map<string, string>>(() => {
    return new Map((data.value?.connectors ?? []).map((connector) => {
      return [connector.slug, connector.title]
    }))
  })

  const connectorsBySlug = computed<
    Map<string, { id: string, title: string }>
  >(() => {
    return new Map((data.value?.connectors ?? []).map((connector) => {
      return [connector.slug, { id: connector.id, title: connector.title }]
    }))
  })

  return { titlesBySlug, connectorsBySlug }
}
