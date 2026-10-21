import { z } from 'zod'
import { createError } from 'evlog'
import { trackLandingEvent } from '~~/server/utils/landing/analytics-events'
import {
  CLIENT_ALLOWED_EVENTS,
  buildClientEventAttributes,
  clientPathSchema,
  clientTriggerSchema,
  completionPercentSchema,
  validateClientEventTarget,
  validateClientEventTrigger,
  validateVideoWatchFields,
  videoSecondsSchema,
  videoWatchEndReasonSchema,
} from '~~/server/utils/landing/client-events'
import type { ClientLandingEventName } from '#shared/types/analytics.d'
import type { UtmParams } from '#shared/utils/utm'
import { hasUtmParams, sanitizeUtmValue } from '#shared/utils/utm'
import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const VIDEO_SECONDS_PRECISION = 10

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

const bodySchema = z.object({
  event: z.string().max(64),
  path: clientPathSchema.optional(),
  target: z.string().max(200).optional(),
  value: z.number().finite().min(0).max(1e9).optional(),
  trigger: clientTriggerSchema.optional(),
  watchedSeconds: videoSecondsSchema.optional(),
  durationSeconds: videoSecondsSchema.optional(),
  completionPercent: completionPercentSchema.optional(),
  endReason: videoWatchEndReasonSchema.optional(),
  utm: utmBodySchema.optional(),
})

function resolveEventValue(
  name: ClientLandingEventName,
  data: z.infer<typeof bodySchema>,
): number | undefined {
  if (name === 'video_watch' && data.watchedSeconds !== undefined) {
    return Math.round(data.watchedSeconds * VIDEO_SECONDS_PRECISION)
      / VIDEO_SECONDS_PRECISION
  }

  return data.value
}

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

  const { event: name, path, target } = body.data
  const eventName = name as ClientLandingEventName
  const utm = sanitizeUtmBody(body.data.utm)

  if (!CLIENT_ALLOWED_EVENTS.has(eventName)) {
    throw createError({
      message: 'Unknown event',
      status: 400,
      why: `Event "${name}" is not in the client-allowed list`,
    })
  }

  const invalidReason = validateClientEventTarget(eventName, target)
    ?? validateClientEventTrigger(eventName, body.data.trigger)
    ?? validateVideoWatchFields(eventName, body.data)

  if (invalidReason) {
    throw createError({
      message: 'Invalid event',
      status: 400,
      why: invalidReason,
    })
  }

  const value = resolveEventValue(eventName, body.data)
  const attributes = buildClientEventAttributes(eventName, body.data)

  logger.set({ analytics: { event: name } })

  if (Object.keys(attributes).length) {
    logger.set({ attributes: { analytics: attributes } })
  }

  if (hasUtmParams(utm)) {
    logger.set({ attributes: { utm } })
  }

  trackLandingEvent(
    eventName,
    { path, target, value, utm },
    event,
  )

  return { ok: true }
})
