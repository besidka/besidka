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
const CLIENT_ALLOWED_PATHS = ['/', '/privacy', '/terms'] as const

const bodySchema = z.object({
  event: z.string().max(64),
  path: z.enum(CLIENT_ALLOWED_PATHS).optional(),
  target: z.string().max(200).optional(),
  value: z.number().finite().min(0).max(1e9).optional(),
})

export default defineEventHandler(async (event) => {
  const logger = useLogger(event)

  const secFetchSite = getHeader(event, 'sec-fetch-site')

  if (secFetchSite !== 'same-origin' && secFetchSite !== 'same-site') {
    throw createError({
      message: 'Forbidden',
      status: 403,
      why: `sec-fetch-site "${secFetchSite}" is not same-origin or same-site`,
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

  const { event: name, path, target, value } = body.data

  if (!CLIENT_ALLOWED_EVENTS.has(name as ClientLandingEventName)) {
    throw createError({
      message: 'Unknown event',
      status: 400,
      why: `Event "${name}" is not in the client-allowed list`,
    })
  }

  logger.set({ analytics: { event: name } })

  trackLandingEvent(
    name as ClientLandingEventName,
    { path, target, value },
    event,
  )

  return { ok: true }
})
