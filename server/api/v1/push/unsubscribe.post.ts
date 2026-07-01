import { useLogger, createError } from 'evlog'
import { and, eq } from 'drizzle-orm'
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
  }).safeParse)

  if (body.error) {
    throw createError({
      message: 'Invalid unsubscribe body',
      status: 400,
      why: body.error.message,
    })
  }

  const db = useDb()

  logger.set({
    push: {
      operation: 'unsubscribe',
      userId,
    },
  })

  await db.delete(schema.pushSubscriptions)
    .where(and(
      eq(schema.pushSubscriptions.endpoint, body.data.endpoint),
      eq(schema.pushSubscriptions.userId, userId),
    ))

  setResponseStatus(event, 204)

  return null
})
