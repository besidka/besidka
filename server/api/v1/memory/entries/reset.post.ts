import { createError } from 'evlog'
import { defineEventHandler, readValidatedBody } from 'nuxt/server'
import type { MemoryResetResponse } from '#shared/types/memory-api.d'
import { clearBackfillWindow } from '~~/server/utils/memory/backfill'
import { resetMemoryEntries } from '~~/server/utils/memory/entries'
import type { MemoryScopeFilter } from '~~/server/utils/memory/entries'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'
import { enforceMemoryRateLimit } from '~~/server/utils/memory/rate-limit'

const resetBodySchema = z.object({
  scope: z.enum(['account', 'project', 'all']),
  projectId: z.string().trim().min(1).optional(),
}).refine(value => value.scope !== 'project' || !!value.projectId, {
  message: 'The project scope needs a projectId',
  path: ['projectId'],
})

export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)

  assertNotCrossSiteRequest(event)
  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  await enforceMemoryRateLimit(
    'write',
    parseInt(session.user.id),
    event,
  )

  const body = await readValidatedBody(event, resetBodySchema.safeParse)

  if (body.error) {
    throw createError({
      message: 'Invalid request body',
      status: 400,
      why: body.error.message,
    })
  }

  const userId = parseInt(session.user.id)
  const { scope, projectId } = body.data
  const scopeFilter: MemoryScopeFilter = scope === 'project' && projectId
    ? { kind: 'project', projectId }
    : { kind: scope === 'all' ? 'all' : 'account' }

  logger.set({
    userId,
    attributes: { memoryEntries: { action: 'reset', scope } },
  })

  const db = useDb()

  if (scope !== 'project') {
    await clearBackfillWindow({ userId, db })
  }

  const deleted = await resetMemoryEntries({
    db,
    userId,
    scope: scopeFilter,
  })

  logger.set({
    attributes: { memoryEntries: { action: 'reset', scope, deleted } },
  })

  const response: MemoryResetResponse = { deleted }

  return response
})
