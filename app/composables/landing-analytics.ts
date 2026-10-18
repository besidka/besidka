import type {
  ClientLandingEventName,
  LandingEventData,
} from '#shared/types/analytics.d'

export function useLandingAnalytics() {
  const { utm: firstTouchUtm } = useUtmAttribution()

  function readLandingUtm(event: ClientLandingEventName) {
    if (event !== 'landing_page_view') {
      return undefined
    }

    const utm = hasUtmParams(firstTouchUtm.value)
      ? firstTouchUtm.value
      : sanitizeUtmParams(new URLSearchParams(window.location.search))

    if (!hasUtmParams(utm)) {
      return undefined
    }

    return utm
  }

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
        path: window.location.pathname,
        target: data?.target,
        value: data?.value,
        utm: readLandingUtm(event),
      },
    }).catch(() => {})
  }

  return { track }
}
