import { createError } from 'evlog'
import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { extractMemoryFromText } from '~~/server/utils/memory/extract'
import { MEMORY_EXTRACTION_LIMITS } from '~~/server/utils/memory/extract-limits'
import { recordBlockedCounts } from '~~/server/utils/memory/compliance'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const NO_MODEL_REASON = 'no-model'

/**
 * POST /memory/import
 *
 * Turns text the user pasted from another assistant into profile memory
 * entries (origin `import`). It is an explicit user action, so it needs memory
 * turned on but not the automatic extraction opt-in. The text is redacted of
 * never-store data before it reaches the model, goes through the same
 * compliance gate as chat extraction, and is never stored, logged or echoed:
 * the answer and the logs carry counts only. The text is used exactly as
 * submitted (not trimmed), so when `truncated` is true the client can
 * resubmit `text.slice(consumedChars)`. The one-minute per-user cooldown is
 * taken before the first model call so parallel requests cannot slip through;
 * it is released again when no model was called or the import was truncated,
 * so the continuation is not blocked (the per-user lease prevents overlap).
 */
export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)

  assertNotCrossSiteRequest(event)

  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const body = await readValidatedBody(event, z.object({
    text: z.string()
      .max(MEMORY_EXTRACTION_LIMITS.importMaxChars)
      .refine(text => text.trim() !== ''),
  }).safeParse)

  if (body.error) {
    throw createError({
      message: 'Invalid request body',
      status: 400,
      why: 'The text is required and must not exceed '
        + `${MEMORY_EXTRACTION_LIMITS.importMaxChars} characters.`,
    })
  }

  const db = useDb()
  const userId = parseInt(session.user.id)
  const settings = await db.query.userSettings.findFirst({
    where: { userId },
    columns: { memoryEnabled: true },
  })

  if (settings?.memoryEnabled === false) {
    throw createError({
      message: 'Memory is turned off',
      status: 409,
      why: 'Importing needs memory enabled.',
      fix: 'Turn on memory in settings.',
    })
  }

  const kv = useKV()
  const cooldownKey = `memory-import:${userId}`
  const cooldownValue = await kv.get(cooldownKey)

  if (cooldownValue) {
    throw createError({
      message: 'Memory import already requested',
      status: 429,
      why: 'An import was requested less than a minute ago.',
      fix: 'Wait a minute, then try again.',
    })
  }

  const { text } = body.data

  await kv.put(cooldownKey, '1', {
    expirationTtl: MEMORY_EXTRACTION_LIMITS.importCooldownSeconds,
  })

  const result = await extractMemoryFromText({
    userId,
    text,
    scope: 'profile',
    origin: 'import',
    db,
    logger,
  })

  if (result.status !== 'leased' && (!result.modelCalled || result.truncated)) {
    await kv.delete(cooldownKey)
  }

  recordBlockedCounts(result.blocked, logger, 'import')
  logger.set({
    attributes: {
      memoryImport: {
        chars: text.length,
        chunks: result.chunks,
        truncated: result.truncated,
        consumedChars: result.consumedChars,
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

  if (result.status === 'leased') {
    throw createError({
      message: 'Memory import already running',
      status: 409,
      why: 'Another import for this account is still in progress.',
      fix: 'Wait for it to finish, then try again.',
    })
  }

  if (result.status === 'skipped' && result.reason === 'disabled') {
    throw createError({
      message: 'Memory is turned off',
      status: 409,
      why: 'Importing needs memory enabled.',
      fix: 'Turn on memory in settings.',
    })
  }

  if (result.status === 'skipped') {
    throw createError({
      message: 'Nothing to import',
      status: 400,
      why: 'The text had no content that can be stored.',
      fix: 'Paste the list your other assistant wrote.',
    })
  }

  if (result.status === 'failed' && result.reason === NO_MODEL_REASON) {
    throw createError({
      message: 'No model available for memory import',
      status: 409,
      why: 'No saved API key matches a model that can read your text.',
      fix: 'Add an API key for a provider in settings, then try again.',
    })
  }

  if (result.status === 'failed') {
    throw createError({
      message: 'Memory import failed',
      status: 502,
      why: `The import stopped with ${result.reason ?? 'an error'}.`,
      fix: 'Try again in a minute.',
    })
  }

  return {
    created: result.applied.created,
    updated: result.applied.updated,
    appended: result.applied.appended,
    dropped: result.dropped,
    blocked: result.blocked,
    chunks: result.chunks,
    truncated: result.truncated,
    consumedChars: result.consumedChars,
    model: result.model?.modelId
      ? { source: result.model.source, modelId: result.model.modelId }
      : null,
  }
})
