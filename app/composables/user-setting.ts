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
  const fallbackReasoningExpanded = useLocalStorage<boolean>(
    'settings_reasoning_expanded',
    false,
  )
  const {
    data: settingsResponse,
    error: settingsResponseError,
    pending: isLoadingSettings,
    execute: executeLoadUserSettings,
  } = useLazyAsyncData(
    'profile-settings',
    () => {
      return $fetch('/api/v1/profiles/settings')
    },
    {
      server: false,
      immediate: false,
      default: () => ({
        reasoningExpanded: fallbackReasoningExpanded.value,
      }),
    },
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

  async function loadUserSettings(userId: string) {
    activeUserId.value = userId
    const requestedUserId = userId

    if (
      loadedUserId.value === userId
      && serverReasoningExpanded.value !== null
    ) {
      return
    }

    if (isLoadingSettings.value) {
      return
    }

    try {
      await executeLoadUserSettings()

      if (
        activeUserId.value !== requestedUserId
        || settingsResponseError.value
        || !settingsResponse.value
      ) {
        loadedUserId.value = null
        serverReasoningExpanded.value = null

        return
      }

      const nextReasoningExpanded = Boolean(
        settingsResponse.value.reasoningExpanded,
      )

      loadedUserId.value = userId
      serverReasoningExpanded.value = nextReasoningExpanded
      fallbackReasoningExpanded.value = nextReasoningExpanded
    } catch {
      loadedUserId.value = null
      serverReasoningExpanded.value = null
    }
  }

  async function setReasoningExpanded(reasoningExpanded: boolean) {
    fallbackReasoningExpanded.value = reasoningExpanded

    if (
      activeUserId.value
      && loadedUserId.value === activeUserId.value
    ) {
      serverReasoningExpanded.value = reasoningExpanded
    }

    if (!activeUserId.value) {
      return
    }

    try {
      await $fetch('/api/v1/profiles/settings', {
        method: 'PATCH',
        body: {
          reasoningExpanded,
        },
      })

      loadedUserId.value = activeUserId.value
      serverReasoningExpanded.value = reasoningExpanded
      fallbackReasoningExpanded.value = reasoningExpanded
    } catch {
      return
    }
  }

  function resetUserSettings() {
    activeUserId.value = null
    loadedUserId.value = null
    serverReasoningExpanded.value = null
  }

  return {
    activeUserId,
    reasoningExpanded,
    isLoadingSettings,
    loadUserSettings,
    setReasoningExpanded,
    resetUserSettings,
  }
}
