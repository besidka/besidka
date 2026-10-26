import { createError } from 'evlog'
import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import type { MemoryInstructPreviewOperation } from '#shared/types/memory-instruct.d'
import {
  MEMORY_INSTRUCT_LIMITS,
  memoryInstructPreviewBodySchema,
} from '#shared/utils/memory-instruct'
import { assertOwnedProject } from '~~/server/utils/memory/entries'
import { previewMemoryInstruction } from '~~/server/utils/memory/instruct'
import { enforceMemoryRateLimit } from '~~/server/utils/memory/rate-limit'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

function countOperations(operations: MemoryInstructPreviewOperation[]) {
  const counts = { create: 0, update: 0, delete: 0, rejected: 0 }

  for (const operation of operations) {
    if (operation.status === 'rejected') {
      counts.rejected += 1

      continue
    }

    counts[operation.kind] += 1
  }

  return counts
}

/**
 * POST /memory/instruct/preview
 *
 * Previews how the user's free-text instruction ("I moved to Kraków, forget
 * the coffee thing") would change one memory scope: the account when
 * `projectId` is absent, else that owned project. It makes one model call on
 * the user's own key (the same model and gateway rules as import) and writes
 * nothing; the operations come back for the user to tick and send to
 * `/memory/instruct/apply`. Memory must be on. The text is never stored,
 * logged or echoed: the logs carry counts, kinds and the model id only.
 */
export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)

  assertNotCrossSiteRequest(event)

  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const body = await readValidatedBody(
    event,
    memoryInstructPreviewBodySchema.safeParse,
  )

  if (body.error) {
    throw createError({
      message: 'Invalid request body',
      status: 400,
      why: 'The text is required and must not exceed '
        + `${MEMORY_INSTRUCT_LIMITS.maxTextChars} characters.`,
    })
  }

  const db = useDb()
  const userId = parseInt(session.user.id)
  const projectId = body.data.projectId ?? null

  logger.set({
    userId,
    attributes: {
      memoryInstruct: {
        phase: 'preview',
        scope: projectId === null ? 'account' : 'project',
        chars: body.data.text.length,
      },
    },
  })

  if (projectId !== null) {
    await assertOwnedProject(db, userId, projectId)
  }

  const settings = await db.query.userSettings.findFirst({
    where: { userId },
    columns: { memoryEnabled: true },
  })

  if (settings?.memoryEnabled === false) {
    throw createError({
      message: 'Memory is turned off',
      status: 409,
      why: 'Changing memory from text needs memory enabled.',
      fix: 'Turn on memory in settings.',
    })
  }

  await enforceMemoryRateLimit('instruct-preview', userId, event)

  const result = await previewMemoryInstruction({
    db,
    userId,
    projectId,
    text: body.data.text,
    logger,
  })

  if (result.status === 'no-text') {
    logger.set({
      attributes: { memoryInstruct: { status: 'no-text' } },
    })

    throw createError({
      message: 'Nothing to remember',
      status: 400,
      why: 'The text had no content that can be stored.',
      fix: 'Write what Besidka should remember, change or forget.',
    })
  }

  if (result.status === 'no-model') {
    logger.set({
      attributes: { memoryInstruct: { status: 'no-model' } },
    })

    throw createError({
      message: 'No model available for memory',
      status: 409,
      why: 'No saved API key matches a model that can read your text.',
      fix: 'Add an API key for a provider in settings, then try again.',
    })
  }

  if (result.status === 'failed') {
    logger.set({
      attributes: {
        memoryInstruct: {
          status: 'failed',
          reason: result.reason,
          model: result.model.modelId,
        },
      },
    })

    throw createError({
      message: 'Memory preview failed',
      status: 502,
      why: `The model call stopped with ${result.reason}.`,
      fix: 'Try again in a minute.',
    })
  }

  logger.set({
    attributes: {
      memoryInstruct: {
        status: 'ready',
        model: result.response.model.modelId,
        ops: countOperations(result.response.operations),
        usage: result.usage,
      },
    },
  })

  return result.response
})
