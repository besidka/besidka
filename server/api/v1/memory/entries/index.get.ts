import { createError } from 'evlog'
import { defineEventHandler, getQuery } from 'nuxt/server'
import type { MemoryEntriesResponse } from '#shared/types/memory-api.d'
import {
  getMemoryEntryLimits,
  groupMemoryEntries,
  listMemoryEntries,
} from '~~/server/utils/memory/entries'
import type { MemoryScopeFilter } from '~~/server/utils/memory/entries'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const querySchema = z.object({
  scope: z.enum(['account', 'project', 'all']).optional(),
  projectId: z.string().trim().min(1).optional(),
})

export default defineEventHandler(async (event) => {
  const logger = useRequestLogger(event)
  const session = await useUserSession()

  if (!session) {
    return useUnauthorizedError()
  }

  const query = querySchema.safeParse(getQuery(event))

  if (query.error) {
    throw createError({
      message: 'Invalid query parameters',
      status: 400,
      why: query.error.message,
    })
  }

  const scope = query.data.scope ?? (query.data.projectId ? 'project' : 'account')

  if (scope === 'project' && !query.data.projectId) {
    throw createError({
      message: 'Invalid query parameters',
      status: 400,
      why: 'The project scope needs a projectId.',
      fix: 'Send projectId together with scope=project.',
    })
  }

  const userId = parseInt(session.user.id)
  const projectId = scope === 'project' ? (query.data.projectId ?? null) : null
  const scopeFilter: MemoryScopeFilter = projectId
    ? { kind: 'project', projectId }
    : { kind: scope === 'all' ? 'all' : 'account' }

  logger.set({ userId, attributes: { memoryEntries: { scope } } })

  const entries = await listMemoryEntries({
    db: useDb(),
    userId,
    scope: scopeFilter,
  })

  logger.set({
    attributes: { memoryEntries: { scope, total: entries.length } },
  })

  const response: MemoryEntriesResponse = {
    scope,
    projectId,
    total: entries.length,
    limits: getMemoryEntryLimits(),
    groups: groupMemoryEntries(entries),
  }

  return response
})
