import { z } from 'zod'
import { useLogger, createError } from 'evlog'
import { trackLandingEvent } from '~~/server/utils/landing/analytics-events'
import type { ClientLandingEventName } from '#shared/types/analytics.d'

const CLIENT_ALLOWED_EVENTS = new Set<ClientLandingEventName>([
  'landing_page_view',
  'cta_click',
  'header_cta_click',
  'footer_link_click',
  'video_play',
  'video_complete',
  'github_click',
])

const bodySchema = z.object({
  event: z.string().max(64),
  target: z.string().max(200).optional(),
  value: z.number().finite().min(0).max(1e9).optional(),
})

export default defineEventHandler(async (event) => {
  const logger = useLogger(event)

  const secFetchSite = getHeader(event, 'sec-fetch-site')

  if (secFetchSite !== 'same-origin') {
    throw createError({
      message: 'Forbidden',
      status: 403,
      why: `sec-fetch-site "${secFetchSite}" is not same-origin`,
    })
  }

  const body = await readValidatedBody(event, bodySchema.safeParse)

  if (body.error) {
    throw createError({
      message: 'Invalid request body',
      status: 400,
      why: body.error.message,
    })
  }

  const { event: name, target, value } = body.data

  if (!CLIENT_ALLOWED_EVENTS.has(name as ClientLandingEventName)) {
    throw createError({
      message: 'Unknown event',
      status: 400,
      why: `Event "${name}" is not in the client-allowed list`,
    })
  }

  // Defense-in-depth: getCookieConsent fails closed (missing/invalid/stale
  // cookie => denied). Skip silently to keep the fire-and-forget client quiet.
  if (!getCookieConsent(event).isAllowed('analytics')) {
    logger.set({ analytics: { event: name, consent: 'denied' } })

    return { ok: true }
  }

  logger.set({ analytics: { event: name, consent: 'granted' } })

  trackLandingEvent(
    name as ClientLandingEventName,
    { target, value },
    event,
  )

  return { ok: true }
})
