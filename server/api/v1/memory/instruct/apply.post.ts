import { createError } from 'evlog'
import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import { memoryInstructApplyBodySchema } from '#shared/utils/memory-instruct'
import { applyMemoryInstruction } from '~~/server/utils/memory/instruct-apply'
import { enforceMemoryRateLimit } from '~~/server/utils/memory/rate-limit'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

/**
 * POST /memory/instruct/apply
 *
 * Applies the operations the user ticked in a memory instruction preview to
 * one scope (the account when `projectId` is absent, else that owned
 * project). No model is called: every operation is re-validated as ordinary
 * entry CRUD by `applyMemoryInstruction`, including the `updatedAt` the
 * preview showed, so a concurrent edit is never overwritten.
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
    memoryInstructApplyBodySchema.safeParse,
  )

  if (body.error) {
    throw createError({
      message: 'Invalid request body',
      status: 400,
      why: body.error.message,
    })
  }

  const userId = parseInt(session.user.id)
  const projectId = body.data.projectId ?? null
  const requested = { create: 0, update: 0, delete: 0 }

  for (const operation of body.data.operations) {
    requested[operation.kind] += 1
  }

  logger.set({
    userId,
    attributes: {
      memoryInstruct: {
        phase: 'apply',
        scope: projectId === null ? 'account' : 'project',
        requested,
      },
    },
  })

  await enforceMemoryRateLimit('instruct-apply', userId, event)

  const response = await applyMemoryInstruction({
    db: useDb(),
    userId,
    projectId,
    operations: body.data.operations,
    logger,
  })

  logger.set({
    attributes: {
      memoryInstruct: {
        applied: {
          create: response.created,
          update: response.updated,
          delete: response.deleted,
          skipped: response.skipped,
        },
      },
    },
  })

  return response
})
