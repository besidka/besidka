import { createError } from 'evlog'
import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { extractChatMemory } from '~~/server/utils/memory/extract'
import { MEMORY_EXTRACTION_LIMITS } from '~~/server/utils/memory/extract-limits'
import { recordBlockedCounts } from '~~/server/utils/memory/compliance'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

/**
 * POST /memory/extract-now
 *
 * Runs one memory extraction pass for one of the caller's chats right away,
 * ignoring the idle window. Previews have no crons, so this is how extraction
 * is exercised there. Needs the same two flags as the sweep, is rate limited
 * to one run per minute per user, and answers with counts only.
 */
export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)

  assertNotCrossSiteRequest(event)

  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const body = await readValidatedBody(event, z.object({
    chatSlug: z.string().trim().min(1).max(100),
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
  const chat = await db.query.chats.findFirst({
    where: { slug: body.data.chatSlug, userId },
    columns: { id: true },
  })

  if (!chat) {
    throw createError({
      message: 'Chat not found',
      status: 404,
    })
  }

  const settings = await db.query.userSettings.findFirst({
    where: { userId },
    columns: { memoryEnabled: true, memoryExtractionEnabled: true },
  })

  if (settings?.memoryEnabled === false
    || settings?.memoryExtractionEnabled !== true) {
    throw createError({
      message: 'Memory extraction is turned off',
      status: 409,
      why: 'Extraction needs memory and automatic memory updates enabled.',
      fix: 'Turn on memory and automatic memory updates in settings.',
    })
  }

  const kv = useKV()
  const cooldownKey = `memory-extract-now:${userId}`
  const cooldownValue = await kv.get(cooldownKey)

  if (cooldownValue) {
    throw createError({
      message: 'Memory extraction already requested',
      status: 429,
      why: 'Extraction was requested less than a minute ago.',
      fix: 'Wait a minute, then try again.',
    })
  }

  const result = await extractChatMemory({
    chat,
    userId,
    db,
    logger,
    ignoreIdle: true,
  })

  if (result.status === 'extracted' || result.status === 'failed') {
    await kv.put(cooldownKey, '1', {
      expirationTtl: MEMORY_EXTRACTION_LIMITS.extractNowCooldownSeconds,
    })
  }

  recordBlockedCounts(result.blocked, logger, 'extraction')
  logger.set({
    attributes: {
      memoryExtraction: {
        chatsProcessed: result.status === 'leased' ? 0 : 1,
        messages: result.messages,
        userChars: result.userChars,
        ops: {
          proposed: result.proposed,
          applied: result.applied,
          dropped: result.dropped,
        },
        model: result.model,
        usage: result.usage,
        status: result.status,
        reason: result.reason ?? null,
      },
    },
  })

  return {
    status: result.status,
    reason: result.reason,
    created: result.applied.created,
    updated: result.applied.updated,
    deleted: result.applied.deleted,
    dropped: result.dropped,
    model: result.model?.modelId
      ? { source: result.model.source, modelId: result.model.modelId }
      : null,
  }
})
