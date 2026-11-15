import { createError } from 'evlog'
import { defineEventHandler, getQuery } from 'nuxt/server'
import { z } from 'zod'
import {
  REGISTRY_SEARCH_QUERY_MAX_LENGTH,
  REGISTRY_SEARCH_QUERY_MIN_LENGTH,
  REGISTRY_SEARCHES_PER_MINUTE,
} from '#shared/utils/connectors-policy'
import {
  enforceConnectorRateLimit,
  requireConnectorAccess,
} from '~~/server/utils/connectors/route'
import { searchMcpRegistry } from '~~/server/utils/connectors/registry-search'
import { requireFeature } from '~~/server/utils/features/guards'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const MAX_CURSOR = 1000

const querySchema = z.object({
  q: z.string().trim()
    .min(REGISTRY_SEARCH_QUERY_MIN_LENGTH)
    .max(REGISTRY_SEARCH_QUERY_MAX_LENGTH),
  cursor: z.coerce.number().int().min(0).max(MAX_CURSOR).optional(),
})

/**
 * Search over the local copy of the official MCP Registry: signed-in users
 * with the `connectors.registry` flag, 30 searches a minute. It never calls
 * the registry; the hourly sync fills the table.
 */
export default defineEventHandler(async (event) => {
  const userId = await requireConnectorAccess(event, {
    write: false,
    rateLimit: false,
  })

  await requireFeature(event, 'connectors.registry')
  await enforceConnectorRateLimit(event, userId, {
    prefix: 'connectors-registry-rate-limit',
    max: REGISTRY_SEARCHES_PER_MINUTE,
  })

  const query = querySchema.safeParse(getQuery(event))

  if (!query.success) {
    throw createError({
      message: 'Invalid search',
      status: 400,
      why: `The search needs ${REGISTRY_SEARCH_QUERY_MIN_LENGTH} to `
        + `${REGISTRY_SEARCH_QUERY_MAX_LENGTH} characters`,
      fix: 'Check the search text and the cursor',
    })
  }

  const result = await searchMcpRegistry(useDb(), {
    query: query.data.q,
    cursor: query.data.cursor ?? 0,
  })

  useRequestLogger(event).set({
    attributes: {
      connectors: {
        registrySearch: { results: result.items.length },
      },
    },
  })

  return result
})
