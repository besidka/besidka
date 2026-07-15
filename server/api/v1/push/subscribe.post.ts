import { useLogger, createError } from 'evlog'
import { eq } from 'drizzle-orm'
import { getRequestURL } from 'h3'
import * as schema from '~~/server/db/schema'

export default defineEventHandler(async (event) => {
  const logger = useLogger(event)
  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const userId = parseInt(session.user.id)

  const body = await readValidatedBody(event, z.object({
    endpoint: z.string().url(),
    keys: z.object({
      p256dh: z.string().nonempty(),
      auth: z.string().nonempty(),
    }),
  }).safeParse)

  if (body.error) {
    throw createError({
      message: 'Invalid push subscription body',
      status: 400,
      why: body.error.message,
    })
  }

  const { endpoint, keys } = body.data

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

  const existing = await db.query.pushSubscriptions.findFirst({
    where: { endpoint },
  })

  if (existing) {
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
      })
      .where(eq(schema.pushSubscriptions.id, existing.id))
  } else {
    logger.set({
      push: {
        operation: 'subscribe',
        userId,
      },
    })

    await db.insert(schema.pushSubscriptions).values({
      userId,
      endpoint,
      p256dhKey: keys.p256dh,
      authKey: keys.auth,
      origin,
    })
  }

  setResponseStatus(event, 204)

  return null
})
