const PROMPT_SHOWN_KEY = 'notification_prompt_shown'

// Issue #275 follow-up: never request Notification permission on page load —
// Chrome's own telemetry shows a cold prompt gets ~12% allow vs ~30%+ when
// shown after the user has already experienced the specific benefit. This
// fires only off the chat composable's 'chat:generation-ready-while-hidden'
// hook (a generation that finished while the user had switched away), and
// only once ever per browser — the contextual disclosure here doubles as the
// pre-prompt this app's compliance research found necessary: a bare native
// permission dialog isn't on its own informed consent for the resulting
// subscription (CNIL 2025 Mobile Applications Recommendation, EDPB
// Guidelines 05/2020) — see docs/cookie-consent.md is NOT extended for this,
// since a push subscription is not an ePrivacy Article 5(3) tracking
// mechanism; this dedicated disclosure step is the correct one instead.
export function useNotificationPrompt() {
  const prefStorage = usePreferenceStorage()
  const pushNotifications = usePushNotifications()
  const isVisible = shallowRef<boolean>(false)
  const nuxtApp = useNuxtApp()

  function hasBeenShown(): boolean {
    return prefStorage.getItem(PROMPT_SHOWN_KEY) === '1'
  }

  function maybeShow(): void {
    if (
      !pushNotifications.isSupported.value
      || pushNotifications.permission.value !== 'default'
      || hasBeenShown()
    ) {
      return
    }

    isVisible.value = true
    prefStorage.setItem(PROMPT_SHOWN_KEY, '1')
  }

  function dismiss(): void {
    isVisible.value = false
  }

  async function enable(): Promise<void> {
    await pushNotifications.subscribe()

    isVisible.value = false
  }

  nuxtApp.hook('chat:generation-ready-while-hidden', maybeShow)

  return {
    isVisible,
    dismiss,
    enable,
  }
}
