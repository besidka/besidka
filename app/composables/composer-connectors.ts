import { parseError } from 'evlog'
import type { MaybeRefOrGetter } from 'vue'
import { CONNECTORS_PER_SEND } from '#shared/utils/connectors-policy'
import type { ConnectorToolMode } from '#shared/utils/connectors-policy'

export const CONNECTORS_LIBRARY_KEY = 'connectors-library'
export const NEW_CHAT_CONNECTORS_KEY = 'new'

export interface ComposerConnectorItem {
  id: string
  slug: string
  title: string
  host: string
  status: 'ready' | 'drifted'
  toolMode: ConnectorToolMode
  presetId: string | null
  isIconAvailable: boolean
}

export type ConnectorEnableBlock = 'review' | 'connect'

export interface ComposerDisabledConnectorItem extends ComposerConnectorItem {
  block: ConnectorEnableBlock | null
}

export interface ChatConnectorSelectionState {
  chatKey: string
  ids: string[]
  offIds: string[]
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

function isManualMode(toolMode: ConnectorToolMode): boolean {
  return toolMode === 'manual'
}

function isSelectableConnector(connector: {
  enabled: boolean
  status: string
}): boolean {
  return connector.enabled
    && (connector.status === 'ready' || connector.status === 'drifted')
}

function isConnectedConnector(connector: { status: string }): boolean {
  return connector.status === 'ready' || connector.status === 'drifted'
}

/**
 * Why a connected connector that is off cannot be turned on from the chat
 * picker, mirroring `assertCanEnable` in the connector `PATCH` route: a
 * changed or never reviewed tool list needs the review on the Connectors
 * page, and a consent that is not current needs the Connect dialog. Null
 * means the picker may turn it on.
 */
export function getConnectorEnableBlock(connector: {
  status: string
  consent: { state: string }
  tools: { isBaselined: boolean }
}): ConnectorEnableBlock | null {
  if (connector.status === 'drifted' || !connector.tools.isBaselined) {
    return 'review'
  }

  if (connector.status !== 'ready' || connector.consent.state !== 'current') {
    return 'connect'
  }

  return null
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
    () => ({
      chatKey: NEW_CHAT_CONNECTORS_KEY,
      ids: [],
      offIds: [],
      isKnown: true,
    }),
  )

  function handOff(chatSlug: string) {
    if (
      selection.value.chatKey !== NEW_CHAT_CONNECTORS_KEY
      || (selection.value.ids.length === 0
        && selection.value.offIds.length === 0)
    ) {
      return
    }

    selection.value = {
      chatKey: chatSlug,
      ids: selection.value.ids,
      offIds: selection.value.offIds,
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
          toolMode: connector.toolMode,
          presetId: connector.presetId,
          isIconAvailable: hasConnectorIcon(connector),
        }
      })
      .sort((left, right) => left.title.localeCompare(right.title))
  })

  const disabledItems = computed<ComposerDisabledConnectorItem[]>(() => {
    return library.connectors.value
      .filter((connector) => {
        return !connector.enabled && isConnectedConnector(connector)
      })
      .map((connector) => {
        return {
          id: connector.id,
          slug: connector.slug,
          title: connector.title,
          host: connector.host,
          status: connector.status as ComposerConnectorItem['status'],
          toolMode: connector.toolMode,
          presetId: connector.presetId,
          isIconAvailable: hasConnectorIcon(connector),
          block: getConnectorEnableBlock(connector),
        }
      })
      .sort((left, right) => left.title.localeCompare(right.title))
  })

  const isVisible = computed<boolean>(() => library.isActive.value)

  const storedIds = computed<string[]>(() => {
    return selection.value.chatKey === chatKey.value
      ? selection.value.ids
      : []
  })

  const offIds = computed<string[]>(() => {
    return selection.value.chatKey === chatKey.value
      ? selection.value.offIds
      : []
  })

  const manualItemIds = computed<Set<string>>(() => {
    return new Set(
      items.value
        .filter(item => isManualMode(item.toolMode))
        .map(item => item.id),
    )
  })

  const selectedIds = computed<string[]>(() => {
    return storedIds.value.filter(id => manualItemIds.value.has(id))
  })

  const availableIds = computed<string[]>(() => {
    return items.value
      .filter((item) => {
        return isManualMode(item.toolMode)
          ? storedIds.value.includes(item.id)
          : !offIds.value.includes(item.id)
      })
      .map(item => item.id)
  })

  const selectedCount = computed<number>(() => {
    return selectedIds.value.length
  })

  const alwaysOnAvailableCount = computed<number>(() => {
    return items.value.filter((item) => {
      return item.toolMode === 'always-on'
        && !offIds.value.includes(item.id)
    }).length
  })

  const manualCapacity = computed<number>(() => {
    return Math.max(0, CONNECTORS_PER_SEND - alwaysOnAvailableCount.value)
  })

  const isAtLimit = computed<boolean>(() => {
    return selectedCount.value >= manualCapacity.value
  })

  watch(chatKey, (key) => {
    if (selection.value.chatKey === key) {
      return
    }

    selection.value = {
      chatKey: key,
      ids: [],
      offIds: [],
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
          offIds: (response.offConnectorIds ?? [])
            .filter(id => selectableIds.has(id)),
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
    [
      library.isLoaded,
      items,
      () => selection.value.ids,
      () => selection.value.offIds,
    ],
    ([isLoaded, currentItems, currentIds, currentOffIds]) => {
      if (!isLoaded || selection.value.chatKey !== chatKey.value) {
        return
      }

      const knownIds = new Set(currentItems.map(item => item.id))
      const keptIds = currentIds.filter(id => knownIds.has(id))
      const keptOffIds = currentOffIds.filter(id => knownIds.has(id))

      if (
        keptIds.length !== currentIds.length
        || keptOffIds.length !== currentOffIds.length
      ) {
        selection.value = {
          ...selection.value,
          ids: keptIds,
          offIds: keptOffIds,
        }
      }
    },
    { immediate: true },
  )

  async function setSelection(nextIds: string[], nextOffIds: string[]) {
    const key = chatKey.value
    const slug = toValue(chatSlug)
    const previous = selection.value

    selection.value = {
      chatKey: key,
      ids: nextIds,
      offIds: nextOffIds,
      isKnown: true,
    }

    if (!slug) {
      return
    }

    isSaving.value = true

    try {
      const response = await $fetch(`/api/v1/chats/${slug}/connectors`, {
        method: 'PUT',
        body: { connectorIds: nextIds, offConnectorIds: nextOffIds },
      })

      if (selection.value.chatKey === key) {
        selection.value = {
          chatKey: key,
          ids: response.connectorIds,
          offIds: response.offConnectorIds ?? [],
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

    const item = items.value.find(candidate => candidate.id === connectorId)

    if (item && !isManualMode(item.toolMode)) {
      await setSelection(
        storedIds.value,
        offIds.value.includes(connectorId)
          ? offIds.value.filter(id => id !== connectorId)
          : [...offIds.value, connectorId],
      )

      return
    }

    const isSelected = selectedIds.value.includes(connectorId)

    if (!isSelected && isAtLimit.value) {
      return
    }

    await setSelection(
      isSelected
        ? selectedIds.value.filter(id => id !== connectorId)
        : [...selectedIds.value, connectorId],
      offIds.value,
    )
  }

  /**
   * Turns on a connector that was off in the Connectors page ("Use in
   * chats"), under the same rules as the detail panel (the route enforces
   * them). It is awaited into the library before the chat choice changes,
   * because a manual connector is then selected for this chat too (when
   * there is room) and the selection of an id the list does not know yet
   * would be pruned.
   */
  async function enable(connectorId: string) {
    if (isSaving.value) {
      return
    }

    const item = disabledItems.value.find((candidate) => {
      return candidate.id === connectorId
    })

    if (!item || item.block) {
      return
    }

    isSaving.value = true

    try {
      await $fetch(`/api/v1/connectors/${connectorId}`, {
        method: 'PATCH',
        body: { enabled: true },
      })
      await library.refresh()
    } catch (exception) {
      const parsedException = parseError(exception)

      useErrorMessage(
        parsedException.message || 'Could not turn on the connector',
        parsedException.why,
      )
      await library.refresh()

      return
    } finally {
      isSaving.value = false
    }

    if (isManualMode(item.toolMode) && !isAtLimit.value) {
      await toggle(connectorId)
    }
  }

  async function setAll(nextIds: string[]) {
    if (isSaving.value) {
      return
    }

    await setSelection(
      nextIds
        .filter(id => manualItemIds.value.has(id))
        .slice(0, manualCapacity.value),
      offIds.value,
    )
  }

  async function clear() {
    if (isSaving.value || selectedIds.value.length === 0) {
      return
    }

    await setSelection([], offIds.value)
  }

  const isSelectionKnown = computed<boolean>(() => {
    return selection.value.chatKey === chatKey.value
      && selection.value.isKnown
  })

  return {
    items,
    disabledItems,
    isVisible,
    isLoaded: library.isLoaded,
    isSelectionKnown,
    selectedIds,
    availableIds,
    offIds,
    selectedCount,
    manualCapacity,
    isAtLimit,
    isSaving,
    toggle,
    enable,
    setAll,
    clear,
    refresh: library.refresh,
  }
}

/**
 * Display titles and ids for connector tool steps, by slug, read from the
 * cached list without fetching it (on the chat page the composer loads it
 * through `useComposerConnectors`, the shared chat page calls
 * `useConnectorLibrary` once; never each step or message). A deleted
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
