import { createError } from 'evlog'
import { defineEventHandler, readValidatedBody, setResponseStatus } from 'nuxt/server'
import type { MemoryEntryResponse } from '#shared/types/memory-api.d'
import { memoryEntryInputSchema } from '#shared/utils/memory-schemas'
import { createMemoryEntry } from '~~/server/utils/memory/entries'
import { resolveMemoryJevChecker } from '~~/server/utils/memory/jev-check'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'
import { enforceMemoryRateLimit } from '~~/server/utils/memory/rate-limit'
import { requireLegalConsent } from '~~/server/utils/legal/consent'

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

  const body = await readValidatedBody(event, memoryEntryInputSchema.safeParse)

  if (body.error) {
    throw createError({
      message: 'Invalid request body',
      status: 400,
      why: body.error.message,
    })
  }

  const userId = parseInt(session.user.id)

  await requireLegalConsent(userId)

  logger.set({
    userId,
    attributes: {
      memoryEntries: {
        action: 'create',
        category: body.data.category,
        scope: body.data.projectId ? 'project' : 'account',
      },
    },
  })

  const db = useDb()
  const entry = await createMemoryEntry(
    {
      db,
      userId,
      logger,
      jev: await resolveMemoryJevChecker({ db, userId, logger }),
    },
    {
      input: body.data,
      origin: 'user',
      complianceOrigin: 'memory-api',
    },
  )

  logger.set({ attributes: { memoryEntries: { entryId: entry.id } } })

  setResponseStatus(event, 201)

  const response: MemoryEntryResponse = { entry }

  return response
})
