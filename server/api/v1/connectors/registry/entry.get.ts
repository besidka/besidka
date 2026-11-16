import { createError } from 'evlog'
import { defineEventHandler, getQuery } from 'nuxt/server'
import { z } from 'zod'
import { CONNECTOR_CATEGORIES } from '~~/config/connectors-directory'
import { REGISTRY_NAME_MAX_LENGTH } from '#shared/utils/connectors-policy'
import {
  findMcpRegistryEntry,
  loadAddedConnectorIds,
  toDirectoryItem,
} from '~~/server/utils/connectors/registry-search'
import { readCachedRegistryProbe } from '~~/server/utils/connectors/registry-probe'
import { requireRegistryAccess } from '~~/server/utils/connectors/route'

const MAX_ID_LENGTH = REGISTRY_NAME_MAX_LENGTH + 40

const querySchema = z.object({
  id: z.string().min(1).max(MAX_ID_LENGTH),
})

/**
 * One directory entry for the detail view: the card fields, the category
 * label, and the tool probe result when one is already cached (it never
 * contacts the server; `GET /registry/tools` does). An id that is not in
 * the directory answers 404.
 */
export default defineEventHandler(async (event) => {
  const userId = await requireRegistryAccess(event)
  const query = querySchema.safeParse(getQuery(event))

  if (!query.success) {
    throw createError({
      message: 'Invalid directory entry',
      status: 400,
      why: 'The id is missing or too long',
      fix: 'Pick an entry from the directory',
    })
  }

  const db = useDb()
  const kv = useKV()
  const entry = await findMcpRegistryEntry(db, kv, query.data.id)

  if (!entry) {
    throw createError({
      message: 'Connector not found',
      status: 404,
      why: 'The directory has no entry with this id',
      fix: 'Pick an entry from the directory',
    })
  }

  const item = toDirectoryItem(entry, await loadAddedConnectorIds(db, userId))
  const category = CONNECTOR_CATEGORIES.find((candidate) => {
    return candidate.id === entry.category
  })

  return {
    item,
    categoryLabel: category?.label ?? 'Other',
    probe: await readCachedRegistryProbe(kv, entry),
  }
})
