import { createError } from 'evlog'
import { defineEventHandler, getQuery } from 'nuxt/server'
import { z } from 'zod'
import {
  REGISTRY_SEARCH_MAX_CURSOR,
  REGISTRY_SEARCH_QUERY_MAX_LENGTH,
  REGISTRY_SEARCH_QUERY_MIN_LENGTH,
} from '#shared/utils/connectors-policy'
import { isDirectoryCategoryId } from '#shared/utils/connectors-directory'
import {
  DIRECTORY_VIEWS,
  searchMcpRegistry,
} from '~~/server/utils/connectors/registry-search'
import { requireRegistryAccess } from '~~/server/utils/connectors/route'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const querySchema = z.object({
  q: z.string().trim()
    .max(REGISTRY_SEARCH_QUERY_MAX_LENGTH)
    .refine((value) => {
      return value.length === 0
        || value.length >= REGISTRY_SEARCH_QUERY_MIN_LENGTH
    })
    .optional(),
  cursor: z.coerce.number().int().min(0).max(REGISTRY_SEARCH_MAX_CURSOR)
    .optional(),
  category: z.string().refine(isDirectoryCategoryId).optional(),
  view: z.enum(DIRECTORY_VIEWS).optional(),
})

/**
 * Browse and search over the directory built from the local copy of the
 * official MCP Registry: signed-in users with the `connectors.registry`
 * flag, 60 requests a minute. No `q` lists entries (`view=top|new`, or one
 * `category`), a `q` of 2 to 64 characters searches them (inside `category`
 * when given). It never calls the registry; the hourly sync (or the admin's
 * Sync now) fills the table and the cached directory index.
 */
export default defineEventHandler(async (event) => {
  const userId = await requireRegistryAccess(event)
  const query = querySchema.safeParse(getQuery(event))

  if (!query.success) {
    throw createError({
      message: 'Invalid search',
      status: 400,
      why: `The search needs ${REGISTRY_SEARCH_QUERY_MIN_LENGTH} to `
        + `${REGISTRY_SEARCH_QUERY_MAX_LENGTH} characters or no text, and `
        + 'the category and view must be known',
      fix: 'Check the search text, the category and the cursor',
    })
  }

  const category = query.data.category

  const result = await searchMcpRegistry(useDb(), useKV(), {
    query: query.data.q ?? '',
    cursor: query.data.cursor ?? 0,
    category: isDirectoryCategoryId(category) ? category : null,
    view: query.data.view ?? 'all',
    userId,
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
