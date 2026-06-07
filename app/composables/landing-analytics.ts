import type {
  ClientLandingEventName,
  LandingEventData,
} from '#shared/types/analytics.d'

export function useLandingAnalytics() {
  function track(
    event: ClientLandingEventName,
    data?: LandingEventData,
  ): void {
    if (import.meta.server) {
      return
    }

    $fetch('/api/v1/events', {
      method: 'POST',
      body: {
        event,
        target: data?.target,
        value: data?.value,
      },
    }).catch(() => {})
  }

  return { track }
}
