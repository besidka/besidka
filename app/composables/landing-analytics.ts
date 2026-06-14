import type {
  ClientLandingEventName,
  LandingEventData,
} from '#shared/types/analytics.d'

interface PendingLandingEvent {
  event: ClientLandingEventName
  target?: string
  value?: number
}

// Events emitted before the visitor has granted analytics consent are held
// here — in memory only, never persisted and never sent — then replayed by
// flushPendingLandingAnalytics() once analytics consent is granted, or dropped
// by clearPendingLandingAnalytics() if analytics is denied. Module-scoped so
// the queue is shared across every useLandingAnalytics() call site.
const MAX_PENDING_EVENTS = 50
const pendingEvents: PendingLandingEvent[] = []

function sendLandingEvent(payload: PendingLandingEvent): void {
  $fetch('/api/v1/events', {
    method: 'POST',
    body: payload,
  }).catch(() => {})
}

export function flushPendingLandingAnalytics(): void {
  const queued = pendingEvents.splice(0)

  for (const payload of queued) {
    sendLandingEvent(payload)
  }
}

export function clearPendingLandingAnalytics(): void {
  pendingEvents.length = 0
}

export function useLandingAnalytics() {
  const { isAllowed } = useCookieConsent()

  function track(
    event: ClientLandingEventName,
    data?: LandingEventData,
  ): void {
    if (import.meta.server) {
      return
    }

    const payload: PendingLandingEvent = {
      event,
      target: data?.target,
      value: data?.value,
    }

    if (isAllowed('analytics')) {
      sendLandingEvent(payload)

      return
    }

    if (pendingEvents.length >= MAX_PENDING_EVENTS) {
      pendingEvents.shift()
    }

    pendingEvents.push(payload)
  }

  return { track }
}
