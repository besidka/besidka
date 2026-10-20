import { z } from 'zod'
import { createError } from 'evlog'
import { trackLandingEvent } from '~~/server/utils/landing/analytics-events'
import type { ClientLandingEventName } from '#shared/types/analytics.d'
import type { UtmParams } from '#shared/utils/utm'
import { hasUtmParams, sanitizeUtmValue } from '#shared/utils/utm'
import { providerMeta } from '#shared/utils/provider-meta'
import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const CLIENT_ALLOWED_EVENTS = new Set<ClientLandingEventName>([
  'landing_page_view',
  'cta_click',
  'header_cta_click',
  'footer_link_click',
  'video_play',
  'video_complete',
  'github_click',
  'key_guide_open',
  'key_guide_video_play',
])
// Must track the public route slugs, or client events from them 400.
const CLIENT_ALLOWED_PATHS = [
  '/',
  '/privacy-policy',
  '/terms-of-use',
  '/cookie-policy',
  '/profile/keys',
] as const

const KEY_GUIDE_EVENTS = new Set<ClientLandingEventName>([
  'key_guide_open',
  'key_guide_video_play',
])

const UTM_BODY_VALUE_MAX_LENGTH = 256

const utmBodyValueSchema = z.string().max(UTM_BODY_VALUE_MAX_LENGTH).optional()

const utmBodySchema = z.object({
  source: utmBodyValueSchema,
  medium: utmBodyValueSchema,
  campaign: utmBodyValueSchema,
  content: utmBodyValueSchema,
})

function sanitizeUtmBody(
  utm: z.infer<typeof utmBodySchema> | undefined,
): UtmParams {
  const source = sanitizeUtmValue(utm?.source)
  const medium = sanitizeUtmValue(utm?.medium)
  const campaign = sanitizeUtmValue(utm?.campaign)
  const content = sanitizeUtmValue(utm?.content)

  return {
    ...(source && { source }),
    ...(medium && { medium }),
    ...(campaign && { campaign }),
    ...(content && { content }),
  }
}

function stripTrailingSlash(path: unknown): unknown {
  if (typeof path === 'string' && path.length > 1 && path.endsWith('/')) {
    return path.slice(0, -1)
  }

  return path
}

const bodySchema = z.object({
  event: z.string().max(64),
  path: z.preprocess(stripTrailingSlash, z.enum(CLIENT_ALLOWED_PATHS))
    .optional(),
  target: z.string().max(200).optional(),
  value: z.number().finite().min(0).max(1e9).optional(),
  utm: utmBodySchema.optional(),
})

export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)

  assertNotCrossSiteRequest(event)

  const body = await readValidatedBody(event, bodySchema.safeParse)

  if (body.error) {
    throw createError({
      message: 'Invalid request body',
      status: 400,
      why: body.error.message,
    })
  }

  const { event: name, path, target, value } = body.data
  const utm = sanitizeUtmBody(body.data.utm)

  if (!CLIENT_ALLOWED_EVENTS.has(name as ClientLandingEventName)) {
    throw createError({
      message: 'Unknown event',
      status: 400,
      why: `Event "${name}" is not in the client-allowed list`,
    })
  }

  if (
    KEY_GUIDE_EVENTS.has(name as ClientLandingEventName)
    && (!target || !Object.hasOwn(providerMeta, target))
  ) {
    throw createError({
      message: 'Invalid event target',
      status: 400,
      why: `Event "${name}" needs a known provider id as its target`,
    })
  }

  logger.set({ analytics: { event: name } })

  if (hasUtmParams(utm)) {
    logger.set({ attributes: { utm } })
  }

  trackLandingEvent(
    name as ClientLandingEventName,
    { path, target, value, utm },
    event,
  )

  return { ok: true }
})
