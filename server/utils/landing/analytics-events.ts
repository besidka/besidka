import { useLogger } from 'evlog'
import type { H3Event } from 'h3'
import type { LandingEventName, LandingEventData } from '#shared/types/analytics.d'

const BOT_PATTERN
  = /bot|crawler|spider|scraper|curl|wget|python|java(?!script)|headless|phantom/i

const DEVICE_PATTERNS = {
  mobile: /mobile|android|iphone|ipad|ipod/i,
  tablet: /tablet|ipad/i,
}

function getDeviceClass(userAgent: string): string {
  if (DEVICE_PATTERNS.tablet.test(userAgent)) {
    return 'tablet'
  }

  if (DEVICE_PATTERNS.mobile.test(userAgent)) {
    return 'mobile'
  }

  return 'desktop'
}

function truncate(value: string | undefined, maxLength: number): string {
  if (!value) {
    return ''
  }

  return value.slice(0, maxLength)
}

export function trackLandingEvent(
  name: LandingEventName,
  data: LandingEventData | undefined,
  h3Event: H3Event,
): void {
  try {
    const analytics = useAnalytics()

    if (!analytics) {
      return
    }

    const userAgent = getHeader(h3Event, 'user-agent') ?? ''

    if (BOT_PATTERN.test(userAgent)) {
      return
    }

    const path = h3Event.path ?? '/'
    const target = truncate(data?.target, 100)
    const country = (
      (h3Event.context.cf as Record<string, unknown> | undefined)?.country
      ?? getHeader(h3Event, 'cf-ipcountry')
      ?? ''
    ) as string
    const deviceClass = getDeviceClass(userAgent)
    const value = data?.value ?? 0

    analytics.writeDataPoint({
      blobs: [name, path, target, country, deviceClass],
      doubles: [value],
      indexes: [name],
    })
  } catch (exception) {
    const logger = useLogger(h3Event)

    logger.set({
      analytics: {
        error: exception instanceof Error
          ? exception.message
          : String(exception),
        event: name,
      },
    })
  }
}
