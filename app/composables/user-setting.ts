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
  const serverAllowExternalLinks = useState<boolean | null>(
    'user-settings:allow-external-links',
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
  const fallbackReasoningExpanded = useLocalStorage<boolean>(
    'settings_reasoning_expanded',
    false,
  )

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

  const allowExternalLinks = computed<boolean>(() => {
    if (
      !activeUserId.value
      || loadedUserId.value !== activeUserId.value
    ) {
      return false
    }

    return serverAllowExternalLinks.value ?? false
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

      loadedUserId.value = userId
      serverReasoningExpanded.value = nextReasoningExpanded
      fallbackReasoningExpanded.value = nextReasoningExpanded
      serverAllowExternalLinks.value = response.allowExternalLinks ?? null
    } catch (exception) {
      if (
        activeUserId.value !== userId
        || lastSyncToken.value !== syncToken
      ) {
        return
      }

      loadedUserId.value = null
      serverReasoningExpanded.value = null
      serverAllowExternalLinks.value = null

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

  function clearUserContext() {
    activeUserId.value = null
    loadedUserId.value = null
    serverReasoningExpanded.value = null
    serverAllowExternalLinks.value = null
    settingsError.value = null
    isLoadingSettings.value = false
    isSavingSettings.value = false
  }

  return {
    activeUserId,
    reasoningExpanded,
    allowExternalLinks,
    isLoadingSettings,
    isSavingSettings,
    settingsError,
    syncForUser,
    setReasoningExpanded,
    setAllowExternalLinks,
    clearUserContext,
  }
}
