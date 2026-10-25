import { createError } from 'evlog'
import { and, eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import {
  defineEventHandler,
  getRequestURL,
  readValidatedBody,
  setResponseStatus,
} from 'nuxt/server'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'
import {
  MAX_PUSH_AUTH_KEY_LENGTH,
  MAX_PUSH_ENDPOINT_LENGTH,
  MAX_PUSH_P256DH_KEY_LENGTH,
  trimPushSubscriptionsToLimit,
} from '~~/server/utils/push'

export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)

  assertNotCrossSiteRequest(event)

  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const userId = parseInt(session.user.id)

  const body = await readValidatedBody(event, z.object({
    endpoint: z.string().url().max(MAX_PUSH_ENDPOINT_LENGTH),
    keys: z.object({
      p256dh: z.string().nonempty().max(MAX_PUSH_P256DH_KEY_LENGTH),
      auth: z.string().nonempty().max(MAX_PUSH_AUTH_KEY_LENGTH),
    }),
    previousEndpoint: z.string().url().max(MAX_PUSH_ENDPOINT_LENGTH).optional(),
  }).safeParse)

  if (body.error) {
    throw createError({
      message: 'Invalid push subscription body',
      status: 400,
      why: body.error.message,
    })
  }

  const { endpoint, keys, previousEndpoint } = body.data

  if (!isAllowedPushServiceEndpoint(endpoint)) {
    throw createError({
      message: 'Unrecognized push subscription endpoint',
      status: 400,
      why: 'The endpoint host is not a known push service.',
    })
  }

  const db = useDb()

  // Server-derived, never client input — see server/utils/push.ts for why
  // (Preview D1 is shared by every preview deployment, so the origin the
  // user is actually on right now is the only reliable signal for scoping
  // notification delivery to the deployment they subscribed on).
  let origin: string | undefined

  try {
    origin = getRequestURL(event).origin
  } catch (exception) {
    void exception
    origin = undefined
  }

  const lastSeenAt = new Date()

  const existing = await db.query.pushSubscriptions.findFirst({
    where: { endpoint },
  })
  let writtenSubscriptionId: number

  if (existing) {
    writtenSubscriptionId = existing.id

    // A push subscription is device/browser-scoped, not permanently
    // user-scoped — a second user signing into the same browser is expected
    // to take over it. Logged (not blocked) so a takeover on a shared device
    // is observable rather than silently invisible to the previous owner.
    if (existing.userId !== userId) {
      logger.set({
        push: {
          operation: 'reassign',
          fromUserId: existing.userId,
          toUserId: userId,
        },
      })
    } else {
      logger.set({
        push: {
          operation: 'resubscribe',
          userId,
        },
      })
    }

    await db.update(schema.pushSubscriptions)
      .set({
        userId,
        p256dhKey: keys.p256dh,
        authKey: keys.auth,
        origin,
        lastSeenAt,
      })
      .where(eq(schema.pushSubscriptions.id, existing.id))
  } else {
    logger.set({
      push: {
        operation: 'subscribe',
        userId,
      },
    })

    const [insertedSubscription] = await db.insert(schema.pushSubscriptions)
      .values({
        userId,
        endpoint,
        p256dhKey: keys.p256dh,
        authKey: keys.auth,
        origin,
        lastSeenAt,
      })
      .returning({ id: schema.pushSubscriptions.id })

    writtenSubscriptionId = insertedSubscription!.id
  }

  if (previousEndpoint && previousEndpoint !== endpoint) {
    const removedRows = await db.delete(schema.pushSubscriptions)
      .where(and(
        eq(schema.pushSubscriptions.endpoint, previousEndpoint),
        eq(schema.pushSubscriptions.userId, userId),
      ))
      .returning({ id: schema.pushSubscriptions.id })

    logger.set({
      attributes: {
        push: {
          previousEndpointRemoved: removedRows.length > 0,
        },
      },
    })
  }

  await trimPushSubscriptionsToLimit(db, userId, writtenSubscriptionId)

  setResponseStatus(event, 204)

  return null
})
