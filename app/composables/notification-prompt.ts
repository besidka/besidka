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
//     asked (state === null), called from the chat layout's onMounted so it
//     fires on both /chats/new and /chats/[slug] without duplicating the
//     call per page. Chrome's own telemetry shows a cold permission prompt
//     converts far worse than one shown after the user has experienced the
//     product, so this intentionally is NOT wired to first app load (the
//     banner itself also only renders within that layout — see chat.vue —
//     so it never shows on the home page or elsewhere).
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
  const hasReconciledSubscription = useState<boolean>(
    'notification-prompt:reconciled',
    () => false,
  )
  const nuxtApp = useNuxtApp()

  function canShow(): boolean {
    return pushNotifications.isSupported.value
      && pushNotifications.permission.value === 'default'
  }

  // A browser where Notification.permission is already 'granted' (via Chrome
  // site settings, or a fresh desktop PWA install) but has no PushManager
  // subscription yet can never reach the banner above — canShow() requires
  // permission === 'default' — so that browser would stay unsubscribed
  // forever unless it's reconciled silently here instead.
  async function reconcileGrantedSubscription(): Promise<void> {
    try {
      await pushNotifications.refreshState()

      if (pushNotifications.permission.value !== 'granted') {
        return
      }

      if (pushNotifications.isSubscribed.value) {
        return
      }

      await pushNotifications.subscribe()
    } catch (exception) {
      void exception
    }
  }

  function maybeShowProactively(): void {
    // Unlike canShow() above, this only gates on support — permission
    // 'granted' must still reach the watcher below so a browser stuck
    // granted-but-unsubscribed (see reconcileGrantedSubscription()) gets
    // reconciled; the permission === 'default' requirement for actually
    // showing the banner is preserved further down instead.
    if (!pushNotifications.isSupported.value) {
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

        if (settings.state === true && !hasReconciledSubscription.value) {
          hasReconciledSubscription.value = true
          reconcileGrantedSubscription()
        }

        if (
          settings.state === null
          && pushNotifications.permission.value !== 'default'
        ) {
          return
        }

        // notificationPromptState is account-level, but the browser
        // permission and push subscription are per-install: a fresh PWA
        // install starts back at permission 'default' with no subscription,
        // so a user who already opted in on another install must be
        // re-prompted here — otherwise the new install can never subscribe.
        const enabledOnAnotherInstall = settings.state === true
          && pushNotifications.permission.value === 'default'

        if (settings.state !== null && !enabledOnAnotherInstall) {
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

  async function disable(): Promise<void> {
    await pushNotifications.unsubscribe()
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

  // Entry point for the settings-menu toggle button (not the banner). When
  // permission is already 'granted', requestPermission() resolves instantly
  // with no dialog, so delegating to enable() safely (re)subscribes this
  // device. When permission is still 'default', calling subscribe() here
  // would fire the OS dialog with zero prior disclosure — a compliance
  // regression — so this shows the same disclosed banner instead.
  async function requestEnable(): Promise<void> {
    if (pushNotifications.permission.value !== 'granted') {
      isVisible.value = true

      return
    }

    await enable()
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
    disable,
    enable,
    requestEnable,
    maybeShowProactively,
  }
}
