import { createError } from 'evlog'
import { defineEventHandler } from 'nuxt/server'
import type { MemoryEntryDeleteResponse } from '#shared/types/memory-api.d'
import { deleteMemoryEntry } from '~~/server/utils/memory/entries'
import { getDecodedRouterParams } from '~~/server/utils/http/get-decoded-router-params'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)

  const params = z.object({
    id: z.string().nonempty(),
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

  logger.set({
    userId,
    attributes: {
      memoryEntries: { action: 'delete', entryId: params.data.id },
    },
  })

  const deleted = await deleteMemoryEntry({
    db: useDb(),
    userId,
    id: params.data.id,
  })

  if (!deleted) {
    throw createError({
      message: 'Memory entry not found',
      status: 404,
    })
  }

  const response: MemoryEntryDeleteResponse = { success: true }

  return response
})
