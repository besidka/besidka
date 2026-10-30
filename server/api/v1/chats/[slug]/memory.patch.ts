import { createError } from 'evlog'
import { setChatMemoryExclusion } from '~~/server/utils/chats/lifecycle'
import {
  defineEventHandler,
  readValidatedBody,
} from 'nuxt/server'
import { getDecodedRouterParams } from '~~/server/utils/http/get-decoded-router-params'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'
import { enforceMemoryRateLimit } from '~~/server/utils/memory/rate-limit'

/**
 * PATCH /chats/:slug/memory
 *
 * Sets whether the chat is excluded from memory. The flag is written first,
 * so no new extraction picks the chat, and turning it on then removes the
 * chat from memory provenance like a chat deletion does; a failed cascade
 * fails the request and is safe to retry. The activity time is not touched,
 * so toggling never makes a chat due for extraction.
 */
export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)

  assertNotCrossSiteRequest(event)

  const params = z.object({
    slug: z.ulid(),
  }).safeParse(getDecodedRouterParams(event))

  if (params.error) {
    throw createError({
      message: 'Invalid request parameters',
      status: 400,
      why: params.error.message,
    })
  }

  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  await enforceMemoryRateLimit('write', parseInt(session.user.id), event)

  const body = await readValidatedBody(event, z.object({
    excluded: z.boolean(),
  }).safeParse)

  if (body.error) {
    throw createError({
      message: 'Invalid request body',
      status: 400,
      why: body.error.message,
    })
  }

  const db = useDb()
  const userId = parseInt(session.user.id)
  const isExcluded = body.data.excluded

  logger.set({
    userId,
    chatSlug: params.data.slug,
    attributes: {
      memoryChatExclusion: { excluded: isExcluded },
    },
  })

  await setChatMemoryExclusion(
    db,
    userId,
    params.data.slug,
    isExcluded,
    logger,
  )

  return { memoryExcluded: isExcluded }
})
