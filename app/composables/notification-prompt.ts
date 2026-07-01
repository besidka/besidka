// Issue #275 follow-up: the contextual disclosure banner below doubles as
// the pre-prompt this app's compliance research found necessary — a bare
// native permission dialog isn't on its own informed consent for the
// resulting subscription (CNIL 2025 Mobile Applications Recommendation,
// EDPB Guidelines 05/2020) — see docs/cookie-consent.md is NOT extended for
// this, since a push subscription is not an ePrivacy Article 5(3) tracking
// mechanism; this dedicated disclosure step is the correct one instead.
// Whichever path shows it, the OS Notification.requestPermission() dialog
// is only ever reached from this banner's Enable button (pushNotifications.
// subscribe(), called from enable() below) — never directly, so a proactive
// ask never regresses that requirement.
//
// notificationPromptState (server + DB, via useUserSetting()) replaces the
// original localStorage-only "shown once" latch: null means never asked,
// true means enabled, false means declined/dismissed. Two independent
// triggers write and read it:
//   - maybeShowProactively(): a one-time ask for a user who has never been
//     asked (state === null), meant to be called from a page like
//     /chats/new. Chrome's own telemetry shows a cold permission prompt
//     converts far worse than one shown after the user has experienced the
//     product, so this intentionally is NOT wired to first app load.
//   - maybeShowAfterMissedNotification(): fired from chat.ts's
//     'chat:generation-ready-while-hidden' hook — a generation finished
//     while the user was away with no way to notify them. Re-asks only a
//     user who previously declined (state === false), which is exactly the
//     "you just missed one, want to enable it now?" moment.
export function useNotificationPrompt() {
  const pushNotifications = usePushNotifications()
  const userSetting = useUserSetting()
  // useState, not shallowRef: NotificationPrompt.client.vue (mounted once in
  // app.vue) and any page proactively triggering maybeShowProactively() must
  // share the exact same visibility flag, not each get their own local one
  // from a separate useNotificationPrompt() call.
  const isVisible = useState<boolean>(
    'notification-prompt:is-visible',
    () => false,
  )
  const hasRegisteredMissedNotificationHook = useState<boolean>(
    'notification-prompt:hook-registered',
    () => false,
  )
  const nuxtApp = useNuxtApp()

  function canShow(): boolean {
    return pushNotifications.isSupported.value
      && pushNotifications.permission.value === 'default'
  }

  function maybeShowProactively(): void {
    if (!canShow()) {
      return
    }

    // watch() with immediate:true invokes this callback synchronously,
    // before watch() itself returns — declaring and assigning in one
    // statement (the const this would otherwise be) leaves
    // stopWatchingSettingsLoad in its temporal dead zone during that first,
    // immediate call, throwing on the very reference below. Splitting the
    // declaration out first ends the TDZ before watch() runs, so the
    // immediate call safely reads undefined via the optional chain instead.
    let stopWatchingSettingsLoad: (() => void) | undefined

    // eslint-disable-next-line prefer-const -- see comment above
    stopWatchingSettingsLoad = watch(
      () => ({
        isLoading: userSetting.isLoadingSettings.value,
        userId: userSetting.activeUserId.value,
        state: userSetting.notificationPromptState.value,
      }),
      (settings) => {
        if (settings.isLoading || !settings.userId) {
          return
        }

        stopWatchingSettingsLoad?.()

        if (settings.state !== null) {
          return
        }

        isVisible.value = true
      },
      {
        immediate: true,
      },
    )
  }

  function maybeShowAfterMissedNotification(): void {
    if (!canShow()) {
      return
    }

    const state = userSetting.notificationPromptState.value

    if (state !== null && state !== false) {
      return
    }

    isVisible.value = true
  }

  function dismiss(): void {
    isVisible.value = false
    userSetting.setNotificationPromptState(false)
  }

  async function enable(): Promise<void> {
    const subscribed = await pushNotifications.subscribe()

    if (!subscribed) {
      return
    }

    isVisible.value = false
    userSetting.setNotificationPromptState(true)
  }

  if (!hasRegisteredMissedNotificationHook.value) {
    hasRegisteredMissedNotificationHook.value = true
    nuxtApp.hook(
      'chat:generation-ready-while-hidden',
      maybeShowAfterMissedNotification,
    )
  }

  return {
    isVisible,
    dismiss,
    enable,
    maybeShowProactively,
  }
}
