export function usePushToggle() {
  const pushNotifications = usePushNotifications()
  const notificationPrompt = useNotificationPrompt()

  const pending = shallowRef<boolean>(false)

  const isSupported = computed<boolean>(() => {
    return pushNotifications.isSupported.value
  })

  const isEnabled = computed<boolean>(() => {
    return pushNotifications.permission.value === 'granted'
      && pushNotifications.isSubscribed.value
  })

  const isBlocked = computed<boolean>(() => {
    return pushNotifications.permission.value === 'denied'
  })

  async function toggle() {
    if (pending.value) {
      return
    }

    pending.value = true

    try {
      if (isEnabled.value) {
        await notificationPrompt.disable()
      } else {
        await notificationPrompt.requestEnable()
      }
    } finally {
      pending.value = false
    }
  }

  return {
    isSupported,
    isEnabled,
    isBlocked,
    pending,
    toggle,
  }
}
