import { createError } from 'evlog'
import { and, eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import {
  defineEventHandler,
  readValidatedBody,
  setResponseStatus,
} from 'nuxt/server'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'
import { MAX_PUSH_ENDPOINT_LENGTH } from '~~/server/utils/push'

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
