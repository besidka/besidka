import { parseError } from 'evlog'

export function useUserSetting() {
  const activeUserId = useState<string | null>(
    'user-settings:active-user-id',
    () => null,
  )
  const loadedUserId = useState<string | null>(
    'user-settings:loaded-user-id',
    () => null,
  )
  const serverReasoningExpanded = useState<boolean | null>(
    'user-settings:reasoning-expanded',
    () => null,
  )
  const serverReasoningAutoHide = useState<boolean | null>(
    'user-settings:reasoning-auto-hide',
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
  const lastFavoriteModelsRequestToken = useState<number>(
    'user-settings:favorite-models-request-token',
    () => 0,
  )
  const prefStorage = usePreferenceStorage()
  const fallbackReasoningExpanded = customRef<boolean>((track, trigger) => ({
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
  const fallbackReasoningAutoHide = customRef<boolean>((track, trigger) => ({
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

  const reasoningExpanded = computed<boolean>(() => {
    if (
      !activeUserId.value
      || loadedUserId.value !== activeUserId.value
      || serverReasoningExpanded.value === null
    ) {
      return fallbackReasoningExpanded.value
    }

    return serverReasoningExpanded.value
  })

  const reasoningAutoHide = computed<boolean>(() => {
    if (
      !activeUserId.value
      || loadedUserId.value !== activeUserId.value
      || serverReasoningAutoHide.value === null
    ) {
      return fallbackReasoningAutoHide.value
    }

    return serverReasoningAutoHide.value
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

  async function syncForUser(userId: string) {
    activeUserId.value = userId
    settingsError.value = null

    if (
      loadedUserId.value === userId
      && serverReasoningExpanded.value !== null
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

      const nextReasoningExpanded = Boolean(
        response.reasoningExpanded,
      )
      const nextReasoningAutoHide = Boolean(
        response.reasoningAutoHide ?? true,
      )

      loadedUserId.value = userId
      serverReasoningExpanded.value = nextReasoningExpanded
      fallbackReasoningExpanded.value = nextReasoningExpanded
      serverReasoningAutoHide.value = nextReasoningAutoHide
      fallbackReasoningAutoHide.value = nextReasoningAutoHide
      serverAllowExternalLinks.value = response.allowExternalLinks ?? null
      serverNotificationPromptState.value
        = response.notificationPromptState ?? null

      const nextSidebarPinned = Boolean(response.sidebarPinned)
      serverSidebarPinned.value = nextSidebarPinned
      fallbackSidebarPinned.value = nextSidebarPinned

      const nextFavoriteModels = response.favoriteModels ?? []
      serverFavoriteModels.value = nextFavoriteModels
      fallbackFavoriteModels.value = nextFavoriteModels
    } catch (exception) {
      if (
        activeUserId.value !== userId
        || lastSyncToken.value !== syncToken
      ) {
        return
      }

      loadedUserId.value = null
      serverReasoningExpanded.value = null
      serverReasoningAutoHide.value = null
      serverAllowExternalLinks.value = null
      serverNotificationPromptState.value = null
      serverSidebarPinned.value = null
      serverFavoriteModels.value = null

      const parsedException = parseError(exception)

      settingsError.value = parsedException.message
        || 'Failed to load profile settings'
    } finally {
      if (lastSyncToken.value === syncToken) {
        isLoadingSettings.value = false
      }
    }
  }

  async function setReasoningExpanded(
    reasoningExpanded: boolean,
  ) {
    settingsError.value = null

    const previousFallbackReasoningExpanded
      = fallbackReasoningExpanded.value
    fallbackReasoningExpanded.value = reasoningExpanded

    if (!activeUserId.value) {
      return
    }

    const currentUserId = activeUserId.value as string
    const previousServerReasoningExpanded
      = serverReasoningExpanded.value as boolean

    serverReasoningExpanded.value = reasoningExpanded
    isSavingSettings.value = true

    try {
      await $fetch('/api/v1/profiles/settings', {
        method: 'PATCH',
        body: {
          reasoningExpanded,
        },
      })

      if (activeUserId.value !== currentUserId) {
        return
      }

      loadedUserId.value = currentUserId
      serverReasoningExpanded.value = reasoningExpanded
      fallbackReasoningExpanded.value = reasoningExpanded
    } catch (exception) {
      if (activeUserId.value !== currentUserId) {
        return
      }

      serverReasoningExpanded.value = previousServerReasoningExpanded
      fallbackReasoningExpanded.value = previousFallbackReasoningExpanded

      const parsedException = parseError(exception)

      settingsError.value = parsedException.message
        || 'Failed to save profile settings'
    } finally {
      isSavingSettings.value = false
    }
  }

  async function setReasoningAutoHide(value: boolean) {
    settingsError.value = null

    const previousFallbackReasoningAutoHide
      = fallbackReasoningAutoHide.value
    fallbackReasoningAutoHide.value = value

    if (!activeUserId.value) {
      return
    }

    const currentUserId = activeUserId.value as string
    const previousServerReasoningAutoHide
      = serverReasoningAutoHide.value as boolean

    serverReasoningAutoHide.value = value
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
      serverReasoningAutoHide.value = value
      fallbackReasoningAutoHide.value = value
    } catch (exception) {
      if (activeUserId.value !== currentUserId) {
        return
      }

      serverReasoningAutoHide.value = previousServerReasoningAutoHide
      fallbackReasoningAutoHide.value = previousFallbackReasoningAutoHide

      const parsedException = parseError(exception)

      settingsError.value = parsedException.message
        || 'Failed to save profile settings'
    } finally {
      isSavingSettings.value = false
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

  function clearUserContext() {
    activeUserId.value = null
    loadedUserId.value = null
    serverReasoningExpanded.value = null
    serverReasoningAutoHide.value = null
    serverAllowExternalLinks.value = null
    serverNotificationPromptState.value = null
    serverSidebarPinned.value = null
    serverFavoriteModels.value = null
    settingsError.value = null
    isLoadingSettings.value = false
    isSavingSettings.value = false
  }

  return {
    activeUserId,
    reasoningExpanded,
    reasoningAutoHide,
    allowExternalLinks,
    notificationPromptState,
    sidebarPinned,
    favoriteModels,
    isLoadingSettings,
    isSavingSettings,
    settingsError,
    syncForUser,
    setReasoningExpanded,
    setReasoningAutoHide,
    setAllowExternalLinks,
    setNotificationPromptState,
    setSidebarPinned,
    setFavoriteModels,
    toggleFavoriteModel,
    clearUserContext,
  }
}
