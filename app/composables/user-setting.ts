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

  function clearUserContext() {
    activeUserId.value = null
    loadedUserId.value = null
    serverReasoningExpanded.value = null
    serverReasoningAutoHide.value = null
    serverAllowExternalLinks.value = null
    serverNotificationPromptState.value = null
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
    isLoadingSettings,
    isSavingSettings,
    settingsError,
    syncForUser,
    setReasoningExpanded,
    setReasoningAutoHide,
    setAllowExternalLinks,
    setNotificationPromptState,
    clearUserContext,
  }
}
