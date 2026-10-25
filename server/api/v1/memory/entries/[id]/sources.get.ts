import { createError } from 'evlog'
import { defineEventHandler } from 'nuxt/server'
import type {
  MemoryEntrySourcesResponse,
} from '#shared/types/memory-api.d'
import { getMemoryEntry } from '~~/server/utils/memory/entries'
import {
  resolveMemoryEntrySourceChats,
} from '~~/server/utils/memory/entry-sources'
import { getDecodedRouterParams } from '~~/server/utils/http/get-decoded-router-params'
import { applyResponseHeaders } from '~~/server/utils/http/apply-response-headers'
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
  const db = useDb()

  logger.set({
    userId,
    attributes: { memoryEntries: { entryId: params.data.id } },
  })

  const entry = await getMemoryEntry({
    db,
    userId,
    id: params.data.id,
  })

  if (!entry) {
    throw createError({
      message: 'Memory entry not found',
      status: 404,
    })
  }

  const chats = await resolveMemoryEntrySourceChats({
    db,
    userId,
    sourceChatIds: entry.sourceChatIds,
  })

  applyResponseHeaders(event, { 'Cache-Control': 'no-store' })

  const response: MemoryEntrySourcesResponse = { chats }

  return response
})
