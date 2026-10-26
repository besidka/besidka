import { defineEventHandler } from 'nuxt/server'
import type { MemoryResetResponse } from '#shared/types/memory-api.d'
import { deleteExtractedMemoryEntries } from '~~/server/utils/memory/entries'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'
import { enforceMemoryRateLimit } from '~~/server/utils/memory/rate-limit'

/**
 * POST /memory/entries/delete-extracted
 *
 * The "Delete them" answer when the user turns "Generate memory from chats"
 * off: removes only the caller's entries whose origin is `extraction`, in
 * every scope. Entries the user wrote, edited or imported are kept.
 */
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

  const userId = parseInt(session.user.id)
  const deleted = await deleteExtractedMemoryEntries({ db: useDb(), userId })

  logger.set({
    userId,
    attributes: {
      memoryEntries: { action: 'delete-extracted', deleted },
    },
  })

  const response: MemoryResetResponse = { deleted }

  return response
})
