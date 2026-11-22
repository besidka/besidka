import { createError } from 'evlog'
import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { TOOL_APPROVAL_SUBJECT_ID_PATTERN } from '#shared/utils/tool-approval-policy'
import { createAuthRateLimitStorage } from '~~/server/utils/auth-rate-limit'
import { generationInProgressKvKey } from '~~/server/utils/chats/generation-in-progress'
import { stopGenerationLease } from '~~/server/utils/chats/generation-lease'
import { getDecodedRouterParams } from '~~/server/utils/http/get-decoded-router-params'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'

const STOPS_PER_MINUTE = 30
const STOP_RATE_WINDOW_SECONDS = 60

/**
 * POST /chats/:slug/stop
 *
 * Ends the generation of one message of the user's own chat when they press
 * Stop: the run that holds the message's generation lease is marked stopped
 * (it ends within seconds and stores what it streamed as a stopped reply)
 * and the lease is deleted, so Retry starts at once instead of waiting for a
 * lease the dead or stopped run no longer renews. `messageId` is the key of
 * the lease: the user message of a send, or the assistant message of an
 * approval or round continuation. The answer names the stopped run; the
 * client sends it back with its retry, so the retry takes over even when its
 * KV read has not seen the stop yet. The client sends the stop with
 * `keepalive` and waits at most 2 s for it. 30 stops a minute per user; a
 * KV failure of the counter lets the stop through, because it only ends the
 * user's own run.
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

  const userId = parseInt(session.user.id)
  const body = await readValidatedBody(event, z.object({
    messageId: z.string().regex(TOOL_APPROVAL_SUBJECT_ID_PATTERN),
  }).strict().safeParse)

  if (body.error) {
    throw createError({
      message: 'Invalid request body',
      status: 400,
      why: body.error.message,
    })
  }

  const kv = useKV()

  try {
    const limit = await createAuthRateLimitStorage(kv, 'chat-stop')
      .consume(String(userId), {
        window: STOP_RATE_WINDOW_SECONDS,
        max: STOPS_PER_MINUTE,
      })

    if (!limit.allowed) {
      throw createError({
        message: 'Too many stops',
        status: 429,
        why: `An account can stop at most ${STOPS_PER_MINUTE} replies a minute`,
        fix: 'Wait a moment and try again',
      })
    }
  } catch (exception) {
    if ((exception as { status?: number }).status === 429) {
      throw exception
    }

    logger.set({
      attributes: {
        generationStop: { rateLimitError: exceptionMessage(exception) },
      },
    })
  }

  const chat = await useDb().query.chats.findFirst({
    where: { slug: params.data.slug, userId },
    columns: { id: true },
  })

  if (!chat) {
    throw createError({
      message: 'Chat not found.',
      status: 404,
    })
  }

  const result = await stopGenerationLease(
    kv,
    generationInProgressKvKey(chat.id, body.data.messageId),
  )

  logger.set({
    userId,
    chatId: chat.id,
    attributes: {
      generationStop: {
        hadLease: result.hadLease,
        ...(result.runId ? { runId: result.runId } : {}),
      },
    },
  })

  return { stopped: result.hadLease, runId: result.runId }
})
