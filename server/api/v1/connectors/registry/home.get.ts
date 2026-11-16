import { defineEventHandler } from 'nuxt/server'
import { loadMcpRegistryHome } from '~~/server/utils/connectors/registry-search'
import { requireRegistryAccess } from '~~/server/utils/connectors/route'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

/**
 * The Discover home of the connector directory: Top connectors (the curated
 * list in `config/connectors-directory.ts`), New connectors, then each
 * derived category with its count and first six cards. Same gate and bucket
 * as the directory search.
 */
export default defineEventHandler(async (event) => {
  const userId = await requireRegistryAccess(event)
  const home = await loadMcpRegistryHome(useDb(), useKV(), userId)

  useRequestLogger(event).set({
    attributes: {
      connectors: {
        registryHome: {
          total: home.total,
          categories: home.categories.length,
        },
      },
    },
  })

  return home
})
