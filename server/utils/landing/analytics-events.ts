import { getRequestHeader } from 'nuxt/server'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'
import type { RequestEvent } from 'nuxt/server'
import type { LandingEventName, LandingEventData } from '#shared/types/analytics.d'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'

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
  h3Event: RequestEvent,
): void {
  try {
    const analytics = useAnalytics()

    if (!analytics) {
      return
    }

    const userAgent = getRequestHeader(h3Event, 'user-agent') ?? ''

    if (BOT_PATTERN.test(userAgent)) {
      return
    }

    const path = data?.path ?? h3Event.url.pathname
    const target = truncate(data?.target, 100)
    const country = (
      (h3Event.context.cf as Record<string, unknown> | undefined)?.country
      ?? getRequestHeader(h3Event, 'cf-ipcountry')
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
    const logger = useRequestLogger(h3Event)

    logger.set({
      analytics: {
        event: name,
      },
      attributes: {
        analytics: {
          error: exceptionMessage(exception),
        },
      },
    })
  }
}
