import type {
  GatewayId,
  GatewayFavoriteModels,
} from '#shared/types/gateways.d'
import type { ReasoningLevel } from '#shared/types/reasoning.d'
import { parseReasoningLevel } from '#shared/utils/reasoning'
import { parseError } from 'evlog'

function toGatewayFavoriteModels(parsed: unknown): GatewayFavoriteModels {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {}
  }

  const favorites: GatewayFavoriteModels = {}

  for (const [gatewayId, modelIds] of Object.entries(parsed)) {
    if (!Array.isArray(modelIds)) {
      continue
    }

    favorites[gatewayId as GatewayId] = modelIds.filter((modelId) => {
      return typeof modelId === 'string'
    })
  }

  return favorites
}

export function useUserSetting() {
  const activeUserId = useState<string | null>(
    'user-settings:active-user-id',
    () => null,
  )
  const loadedUserId = useState<string | null>(
    'user-settings:loaded-user-id',
    () => null,
  )
  const serverStepsExpanded = useState<boolean | null>(
    'user-settings:steps-expanded',
    () => null,
  )
  const serverStepsAutoHide = useState<boolean | null>(
    'user-settings:steps-auto-hide',
    () => null,
  )
  const serverDefaultReasoningLevel = useState<ReasoningLevel | null>(
    'user-settings:default-reasoning-level',
    () => null,
  )
  const serverAllowExternalLinks = useState<boolean | null>(
    'user-settings:allow-external-links',
    () => null,
  )
  const serverNotificationPromptState = useState<boolean | null>(
    'user-settings:notification-prompt-state',
    () => null,
  )
  const serverSidebarPinned = useState<boolean | null>(
    'user-settings:sidebar-pinned',
    () => null,
  )
  const serverFavoriteModels = useState<string[] | null>(
    'user-settings:favorite-models',
    () => null,
  )
  const serverFavoriteGatewayModels = useState<GatewayFavoriteModels | null>(
    'user-settings:favorite-gateway-models',
    () => null,
  )
  const serverDismissedLegalNoticeIds = useState<string[] | null>(
    'user-settings:dismissed-legal-notice-ids',
    () => null,
  )
  const isLoadingSettings = useState<boolean>(
    'user-settings:is-loading',
    () => false,
  )
  const isSavingSettings = useState<boolean>(
    'user-settings:is-saving',
    () => false,
  )
  const settingsError = useState<string | null>(
    'user-settings:error',
    () => null,
  )
  const lastSyncToken = useState<number>(
    'user-settings:sync-token',
    () => 0,
  )
  const lastDefaultReasoningLevelRequestToken = useState<number>(
    'user-settings:default-reasoning-level-request-token',
    () => 0,
  )
  const lastFavoriteModelsRequestToken = useState<number>(
    'user-settings:favorite-models-request-token',
    () => 0,
  )
  const lastFavoriteGatewayModelsRequestToken = useState<number>(
    'user-settings:favorite-gateway-models-request-token',
    () => 0,
  )
  const prefStorage = usePreferenceStorage()
  const fallbackStepsExpanded = customRef<boolean>((track, trigger) => ({
    get() {
      track()

      const raw = prefStorage.getItem('settings_reasoning_expanded')

      return raw !== null ? raw === 'true' : false
    },
    set(value) {
      prefStorage.setItem('settings_reasoning_expanded', String(value))
      trigger()
    },
  }))
  const fallbackStepsAutoHide = customRef<boolean>((track, trigger) => ({
    get() {
      track()

      const raw = prefStorage.getItem('settings_reasoning_auto_hide')

      return raw !== null ? raw === 'true' : true
    },
    set(value) {
      prefStorage.setItem('settings_reasoning_auto_hide', String(value))
      trigger()
    },
  }))
  const fallbackSidebarPinned = customRef<boolean>((track, trigger) => ({
    get() {
      track()

      const raw = prefStorage.getItem('settings_sidebar_pinned')

      return raw !== null ? raw === 'true' : false
    },
    set(value) {
      prefStorage.setItem('settings_sidebar_pinned', String(value))
      trigger()
    },
  }))
  const fallbackFavoriteModels = customRef<string[]>((track, trigger) => ({
    get() {
      track()

      const raw = prefStorage.getItem('settings_favorite_models')

      if (raw === null) {
        return []
      }

      try {
        const parsed = JSON.parse(raw)

        return Array.isArray(parsed) ? parsed as string[] : []
      } catch {
        return []
      }
    },
    set(value) {
      prefStorage.setItem('settings_favorite_models', JSON.stringify(value))
      trigger()
    },
  }))
  const fallbackFavoriteGatewayModels = customRef<GatewayFavoriteModels>(
    (track, trigger) => ({
      get() {
        track()

        const raw = prefStorage.getItem('settings_favorite_gateway_models')

        if (raw === null) {
          return {}
        }

        try {
          return toGatewayFavoriteModels(JSON.parse(raw))
        } catch {
          return {}
        }
      },
      set(value) {
        prefStorage.setItem(
          'settings_favorite_gateway_models',
          JSON.stringify(value),
        )
        trigger()
      },
    }),
  )

  const stepsExpanded = computed<boolean>(() => {
    if (
      !activeUserId.value
      || loadedUserId.value !== activeUserId.value
      || serverStepsExpanded.value === null
    ) {
      return fallbackStepsExpanded.value
    }

    return serverStepsExpanded.value
  })

  const stepsAutoHide = computed<boolean>(() => {
    if (
      !activeUserId.value
      || loadedUserId.value !== activeUserId.value
      || serverStepsAutoHide.value === null
    ) {
      return fallbackStepsAutoHide.value
    }

    return serverStepsAutoHide.value
  })

  const isSettingsLoaded = computed<boolean>(() => {
    return Boolean(activeUserId.value)
      && loadedUserId.value === activeUserId.value
  })

  const dismissedLegalNoticeIds = computed<string[]>(() => {
    if (!isSettingsLoaded.value) {
      return []
    }

    return serverDismissedLegalNoticeIds.value ?? []
  })

  const defaultReasoningLevel = computed<ReasoningLevel | null>(() => {
    if (!isSettingsLoaded.value) {
      return null
    }

    return serverDefaultReasoningLevel.value
  })

  const allowExternalLinks = computed<boolean>(() => {
    if (
      !activeUserId.value
      || loadedUserId.value !== activeUserId.value
    ) {
      return false
    }

    return serverAllowExternalLinks.value ?? false
  })

  // Genuine tri-state, unlike allowExternalLinks above: null means "not
  // loaded yet" to callers as much as it means "never asked", so this is
  // not collapsed to a boolean default here — the notification-prompt
  // composable needs to tell "unknown" apart from "explicitly declined".
  const notificationPromptState = computed<boolean | null>(() => {
    if (
      !activeUserId.value
      || loadedUserId.value !== activeUserId.value
    ) {
      return null
    }

    return serverNotificationPromptState.value
  })

  const sidebarPinned = computed<boolean>(() => {
    if (
      !activeUserId.value
      || loadedUserId.value !== activeUserId.value
      || serverSidebarPinned.value === null
    ) {
      return fallbackSidebarPinned.value
    }

    return serverSidebarPinned.value
  })

  const rawFavoriteModels = computed<string[]>(() => {
    if (
      !activeUserId.value
      || loadedUserId.value !== activeUserId.value
      || serverFavoriteModels.value === null
    ) {
      return fallbackFavoriteModels.value
    }

    return serverFavoriteModels.value
  })

  const catalogModelIds = computed<Set<string>>(() => {
    const { providers } = getProviders()

    return new Set(
      providers.flatMap((provider) => {
        return provider.models.map((model) => {
          return model.id
        })
      }),
    )
  })

  // Filtered against the live catalog so a favorited model that was later
  // removed or renamed upstream can't keep a phantom entry visible in the
  // picker UI. `rawFavoriteModels` (unfiltered) remains what gets read for
  // building the next PATCH payload, so a stale id is never silently
  // dropped from what's actually persisted.
  const favoriteModels = computed<string[]>(() => {
    return rawFavoriteModels.value.filter((modelId) => {
      return catalogModelIds.value.has(modelId)
    })
  })

  // Intentionally NOT filtered against a catalog, unlike favoriteModels
  // above: gateway catalogs are fetched at runtime, so any catalog-based
  // filter here would read as "empty" while a fetch is pending and wipe the
  // favorites it then persists. Callers scope these ids by only rendering
  // rows a loaded catalog actually returned.
  const favoriteGatewayModels = computed<GatewayFavoriteModels>(() => {
    if (
      !activeUserId.value
      || loadedUserId.value !== activeUserId.value
      || serverFavoriteGatewayModels.value === null
    ) {
      return fallbackFavoriteGatewayModels.value
    }

    return serverFavoriteGatewayModels.value
  })

  function getFavoriteGatewayModels(gatewayId: GatewayId): string[] {
    return favoriteGatewayModels.value[gatewayId] ?? []
  }

  async function migrateLegacyDefaultReasoningLevel(
    userId: string,
    syncToken: number,
    level: ReasoningLevel,
  ) {
    try {
      await $fetch('/api/v1/profiles/settings', {
        method: 'PATCH',
        body: {
          defaultReasoningLevel: level,
        },
      })
    } catch {
      if (
        activeUserId.value === userId
        && lastSyncToken.value === syncToken
      ) {
        serverDefaultReasoningLevel.value = null
      }

      return
    }

    prefStorage.removeItem('settings_reasoning_level')
  }

  async function syncForUser(userId: string) {
    activeUserId.value = userId
    settingsError.value = null

    if (
      loadedUserId.value === userId
      && serverStepsExpanded.value !== null
    ) {
      return
    }

    if (isLoadingSettings.value && activeUserId.value === userId) {
      return
    }

    const syncToken = lastSyncToken.value + 1
    lastSyncToken.value = syncToken
    isLoadingSettings.value = true

    try {
      const response = await $fetch('/api/v1/profiles/settings')

      if (
        activeUserId.value !== userId
        || lastSyncToken.value !== syncToken
      ) {
        return
      }

      const nextStepsExpanded = Boolean(
        response.reasoningExpanded,
      )
      const nextStepsAutoHide = Boolean(
        response.reasoningAutoHide ?? true,
      )

      loadedUserId.value = userId
      serverStepsExpanded.value = nextStepsExpanded
      fallbackStepsExpanded.value = nextStepsExpanded
      serverStepsAutoHide.value = nextStepsAutoHide
      fallbackStepsAutoHide.value = nextStepsAutoHide
      const savedDefaultReasoningLevel = parseReasoningLevel(
        response.defaultReasoningLevel,
      )
      const legacyDefaultReasoningLevel = savedDefaultReasoningLevel === null
        ? parseReasoningLevel(prefStorage.getItem('settings_reasoning_level'))
        : null

      serverDefaultReasoningLevel.value = savedDefaultReasoningLevel
        ?? legacyDefaultReasoningLevel
      serverAllowExternalLinks.value = response.allowExternalLinks ?? null
      serverNotificationPromptState.value
        = response.notificationPromptState ?? null

      const nextSidebarPinned = Boolean(response.sidebarPinned)
      serverSidebarPinned.value = nextSidebarPinned
      fallbackSidebarPinned.value = nextSidebarPinned

      const nextFavoriteModels = response.favoriteModels ?? []
      serverFavoriteModels.value = nextFavoriteModels
      fallbackFavoriteModels.value = nextFavoriteModels

      const nextFavoriteGatewayModels = toGatewayFavoriteModels(
        response.favoriteGatewayModels,
      )
      serverFavoriteGatewayModels.value = nextFavoriteGatewayModels
      fallbackFavoriteGatewayModels.value = nextFavoriteGatewayModels
      serverDismissedLegalNoticeIds.value
        = response.dismissedLegalNoticeIds ?? []

      if (legacyDefaultReasoningLevel !== null) {
        await migrateLegacyDefaultReasoningLevel(
          userId,
          syncToken,
          legacyDefaultReasoningLevel,
        )
      }
    } catch (exception) {
      if (
        activeUserId.value !== userId
        || lastSyncToken.value !== syncToken
      ) {
        return
      }

      loadedUserId.value = null
      serverStepsExpanded.value = null
      serverStepsAutoHide.value = null
      serverDefaultReasoningLevel.value = null
      serverAllowExternalLinks.value = null
      serverNotificationPromptState.value = null
      serverSidebarPinned.value = null
      serverFavoriteModels.value = null
      serverFavoriteGatewayModels.value = null
      serverDismissedLegalNoticeIds.value = null

      const parsedException = parseError(exception)

      settingsError.value = parsedException.message
        || 'Failed to load profile settings'
    } finally {
      if (lastSyncToken.value === syncToken) {
        isLoadingSettings.value = false
      }
    }
  }

  async function setStepsExpanded(
    stepsExpanded: boolean,
  ) {
    settingsError.value = null

    const previousFallbackStepsExpanded
      = fallbackStepsExpanded.value
    fallbackStepsExpanded.value = stepsExpanded

    if (!activeUserId.value) {
      requestPersistence()

      return
    }

    const currentUserId = activeUserId.value as string
    const previousServerStepsExpanded
      = serverStepsExpanded.value as boolean

    serverStepsExpanded.value = stepsExpanded
    isSavingSettings.value = true

    try {
      await $fetch('/api/v1/profiles/settings', {
        method: 'PATCH',
        body: {
          reasoningExpanded: stepsExpanded,
        },
      })

      if (activeUserId.value !== currentUserId) {
        return
      }

      loadedUserId.value = currentUserId
      serverStepsExpanded.value = stepsExpanded
      fallbackStepsExpanded.value = stepsExpanded
    } catch (exception) {
      if (activeUserId.value !== currentUserId) {
        return
      }

      serverStepsExpanded.value = previousServerStepsExpanded
      fallbackStepsExpanded.value = previousFallbackStepsExpanded

      const parsedException = parseError(exception)

      settingsError.value = parsedException.message
        || 'Failed to save profile settings'
    } finally {
      isSavingSettings.value = false
    }
  }

  async function setStepsAutoHide(value: boolean) {
    settingsError.value = null

    const previousFallbackStepsAutoHide
      = fallbackStepsAutoHide.value
    fallbackStepsAutoHide.value = value

    if (!activeUserId.value) {
      requestPersistence()

      return
    }

    const currentUserId = activeUserId.value as string
    const previousServerStepsAutoHide
      = serverStepsAutoHide.value as boolean

    serverStepsAutoHide.value = value
    isSavingSettings.value = true

    try {
      await $fetch('/api/v1/profiles/settings', {
        method: 'PATCH',
        body: {
          reasoningAutoHide: value,
        },
      })

      if (activeUserId.value !== currentUserId) {
        return
      }

      loadedUserId.value = currentUserId
      serverStepsAutoHide.value = value
      fallbackStepsAutoHide.value = value
    } catch (exception) {
      if (activeUserId.value !== currentUserId) {
        return
      }

      serverStepsAutoHide.value = previousServerStepsAutoHide
      fallbackStepsAutoHide.value = previousFallbackStepsAutoHide

      const parsedException = parseError(exception)

      settingsError.value = parsedException.message
        || 'Failed to save profile settings'
    } finally {
      isSavingSettings.value = false
    }
  }

  async function setDefaultReasoningLevel(level: ReasoningLevel | null) {
    settingsError.value = null

    if (!activeUserId.value) {
      return
    }

    const currentUserId = activeUserId.value as string
    const previousValue = serverDefaultReasoningLevel.value

    serverDefaultReasoningLevel.value = level
    isSavingSettings.value = true

    const requestToken = lastDefaultReasoningLevelRequestToken.value + 1
    lastDefaultReasoningLevelRequestToken.value = requestToken

    try {
      await $fetch('/api/v1/profiles/settings', {
        method: 'PATCH',
        body: {
          defaultReasoningLevel: level,
        },
      })

      if (
        activeUserId.value !== currentUserId
        || lastDefaultReasoningLevelRequestToken.value !== requestToken
      ) {
        return
      }

      loadedUserId.value = currentUserId
      serverDefaultReasoningLevel.value = level
    } catch (exception) {
      if (
        activeUserId.value !== currentUserId
        || lastDefaultReasoningLevelRequestToken.value !== requestToken
      ) {
        return
      }

      serverDefaultReasoningLevel.value = previousValue

      const parsedException = parseError(exception)

      settingsError.value = parsedException.message
        || 'Failed to save profile settings'

      useErrorMessage(
        parsedException.message || 'Failed to save default reasoning effort.',
        parsedException.why,
      )
    } finally {
      if (lastDefaultReasoningLevelRequestToken.value === requestToken) {
        isSavingSettings.value = false
      }
    }
  }

  async function setAllowExternalLinks(value: boolean) {
    settingsError.value = null

    if (!activeUserId.value) {
      return
    }

    const currentUserId = activeUserId.value as string
    const previousValue = serverAllowExternalLinks.value

    serverAllowExternalLinks.value = value
    isSavingSettings.value = true

    try {
      await $fetch('/api/v1/profiles/settings', {
        method: 'PATCH',
        body: {
          allowExternalLinks: value,
        },
      })

      if (activeUserId.value !== currentUserId) {
        return
      }

      loadedUserId.value = currentUserId
      serverAllowExternalLinks.value = value
    } catch (exception) {
      if (activeUserId.value !== currentUserId) {
        return
      }

      serverAllowExternalLinks.value = previousValue

      const parsedException = parseError(exception)

      settingsError.value = parsedException.message
        || 'Failed to save profile settings'
    } finally {
      isSavingSettings.value = false
    }
  }

  async function setNotificationPromptState(value: boolean) {
    settingsError.value = null

    if (!activeUserId.value) {
      return
    }

    const currentUserId = activeUserId.value as string
    const previousValue = serverNotificationPromptState.value

    serverNotificationPromptState.value = value
    isSavingSettings.value = true

    try {
      await $fetch('/api/v1/profiles/settings', {
        method: 'PATCH',
        body: {
          notificationPromptState: value,
        },
      })

      if (activeUserId.value !== currentUserId) {
        return
      }

      loadedUserId.value = currentUserId
      serverNotificationPromptState.value = value
    } catch (exception) {
      if (activeUserId.value !== currentUserId) {
        return
      }

      serverNotificationPromptState.value = previousValue

      const parsedException = parseError(exception)

      settingsError.value = parsedException.message
        || 'Failed to save profile settings'
    } finally {
      isSavingSettings.value = false
    }
  }

  async function setSidebarPinned(
    sidebarPinned: boolean,
  ) {
    settingsError.value = null

    const previousFallbackSidebarPinned
      = fallbackSidebarPinned.value
    fallbackSidebarPinned.value = sidebarPinned

    if (!activeUserId.value) {
      requestPersistence()

      return
    }

    const currentUserId = activeUserId.value as string
    const previousServerSidebarPinned
      = serverSidebarPinned.value as boolean

    serverSidebarPinned.value = sidebarPinned
    isSavingSettings.value = true

    try {
      await $fetch('/api/v1/profiles/settings', {
        method: 'PATCH',
        body: {
          sidebarPinned,
        },
      })

      if (activeUserId.value !== currentUserId) {
        return
      }

      loadedUserId.value = currentUserId
      serverSidebarPinned.value = sidebarPinned
      fallbackSidebarPinned.value = sidebarPinned
    } catch (exception) {
      if (activeUserId.value !== currentUserId) {
        return
      }

      serverSidebarPinned.value = previousServerSidebarPinned
      fallbackSidebarPinned.value = previousFallbackSidebarPinned

      const parsedException = parseError(exception)

      settingsError.value = parsedException.message
        || 'Failed to save profile settings'
    } finally {
      isSavingSettings.value = false
    }
  }

  async function setFavoriteModels(favoriteModels: string[]) {
    settingsError.value = null

    const previousFallbackFavoriteModels
      = fallbackFavoriteModels.value
    fallbackFavoriteModels.value = favoriteModels

    if (!activeUserId.value) {
      requestPersistence()

      return
    }

    const currentUserId = activeUserId.value as string
    const previousServerFavoriteModels
      = serverFavoriteModels.value as string[]

    serverFavoriteModels.value = favoriteModels
    isSavingSettings.value = true

    const requestToken = lastFavoriteModelsRequestToken.value + 1
    lastFavoriteModelsRequestToken.value = requestToken

    try {
      await $fetch('/api/v1/profiles/settings', {
        method: 'PATCH',
        body: {
          favoriteModels,
        },
      })

      if (
        activeUserId.value !== currentUserId
        || lastFavoriteModelsRequestToken.value !== requestToken
      ) {
        return
      }

      loadedUserId.value = currentUserId
      serverFavoriteModels.value = favoriteModels
      fallbackFavoriteModels.value = favoriteModels
    } catch (exception) {
      if (
        activeUserId.value !== currentUserId
        || lastFavoriteModelsRequestToken.value !== requestToken
      ) {
        return
      }

      serverFavoriteModels.value = previousServerFavoriteModels
      fallbackFavoriteModels.value = previousFallbackFavoriteModels

      const parsedException = parseError(exception)

      settingsError.value = parsedException.message
        || 'Failed to save profile settings'
    } finally {
      if (lastFavoriteModelsRequestToken.value === requestToken) {
        isSavingSettings.value = false
      }
    }
  }

  async function toggleFavoriteModel(modelId: string) {
    const current = rawFavoriteModels.value
    const next = current.includes(modelId)
      ? current.filter((id) => {
        return id !== modelId
      })
      : [...current, modelId]

    await setFavoriteModels(next)
  }

  async function setFavoriteGatewayModels(
    favoriteGatewayModels: GatewayFavoriteModels,
  ) {
    settingsError.value = null

    const previousFallbackFavoriteGatewayModels
      = fallbackFavoriteGatewayModels.value
    fallbackFavoriteGatewayModels.value = favoriteGatewayModels

    if (!activeUserId.value) {
      requestPersistence()

      return
    }

    const currentUserId = activeUserId.value as string
    const previousServerFavoriteGatewayModels
      = serverFavoriteGatewayModels.value as GatewayFavoriteModels

    serverFavoriteGatewayModels.value = favoriteGatewayModels
    isSavingSettings.value = true

    const requestToken = lastFavoriteGatewayModelsRequestToken.value + 1
    lastFavoriteGatewayModelsRequestToken.value = requestToken

    try {
      await $fetch('/api/v1/profiles/settings', {
        method: 'PATCH',
        body: {
          favoriteGatewayModels,
        },
      })

      if (
        activeUserId.value !== currentUserId
        || lastFavoriteGatewayModelsRequestToken.value !== requestToken
      ) {
        return
      }

      loadedUserId.value = currentUserId
      serverFavoriteGatewayModels.value = favoriteGatewayModels
      fallbackFavoriteGatewayModels.value = favoriteGatewayModels
    } catch (exception) {
      if (
        activeUserId.value !== currentUserId
        || lastFavoriteGatewayModelsRequestToken.value !== requestToken
      ) {
        return
      }

      serverFavoriteGatewayModels.value = previousServerFavoriteGatewayModels
      fallbackFavoriteGatewayModels.value
        = previousFallbackFavoriteGatewayModels

      const parsedException = parseError(exception)

      settingsError.value = parsedException.message
        || 'Failed to save profile settings'
    } finally {
      if (lastFavoriteGatewayModelsRequestToken.value === requestToken) {
        isSavingSettings.value = false
      }
    }
  }

  async function toggleFavoriteGatewayModel(
    gatewayId: GatewayId,
    modelId: string,
  ) {
    const current = favoriteGatewayModels.value
    const currentForGateway = current[gatewayId] ?? []
    const nextForGateway = currentForGateway.includes(modelId)
      ? currentForGateway.filter((id) => {
        return id !== modelId
      })
      : [...currentForGateway, modelId]

    await setFavoriteGatewayModels({
      ...current,
      [gatewayId]: nextForGateway,
    })
  }

  async function dismissLegalNotice(noticeId: string) {
    if (!activeUserId.value || !isSettingsLoaded.value) {
      return
    }

    const currentUserId = activeUserId.value as string
    const previousDismissedIds = serverDismissedLegalNoticeIds.value ?? []

    if (previousDismissedIds.includes(noticeId)) {
      return
    }

    serverDismissedLegalNoticeIds.value = [
      ...previousDismissedIds,
      noticeId,
    ]

    try {
      const response = await $fetch('/api/v1/profiles/settings', {
        method: 'PATCH',
        body: {
          dismissLegalNoticeIds: [noticeId],
        },
      })

      if (activeUserId.value !== currentUserId) {
        return
      }

      serverDismissedLegalNoticeIds.value
        = response.dismissedLegalNoticeIds ?? [noticeId]
    } catch {
      if (activeUserId.value !== currentUserId) {
        return
      }

      serverDismissedLegalNoticeIds.value = previousDismissedIds
    }
  }

  function clearUserContext() {
    activeUserId.value = null
    loadedUserId.value = null
    serverStepsExpanded.value = null
    serverStepsAutoHide.value = null
    serverDefaultReasoningLevel.value = null
    serverAllowExternalLinks.value = null
    serverNotificationPromptState.value = null
    serverSidebarPinned.value = null
    serverFavoriteModels.value = null
    serverFavoriteGatewayModels.value = null
    serverDismissedLegalNoticeIds.value = null
    settingsError.value = null
    isLoadingSettings.value = false
    isSavingSettings.value = false
  }

  return {
    activeUserId,
    stepsExpanded,
    stepsAutoHide,
    defaultReasoningLevel,
    isSettingsLoaded,
    allowExternalLinks,
    notificationPromptState,
    sidebarPinned,
    favoriteModels,
    favoriteGatewayModels,
    getFavoriteGatewayModels,
    isLoadingSettings,
    isSavingSettings,
    settingsError,
    syncForUser,
    setStepsExpanded,
    setStepsAutoHide,
    setDefaultReasoningLevel,
    setAllowExternalLinks,
    setNotificationPromptState,
    setSidebarPinned,
    setFavoriteModels,
    toggleFavoriteModel,
    setFavoriteGatewayModels,
    toggleFavoriteGatewayModel,
    dismissedLegalNoticeIds,
    dismissLegalNotice,
    clearUserContext,
  }
}
