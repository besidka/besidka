import { createError } from 'evlog'
import { defineEventHandler, getQuery } from 'nuxt/server'
import { z } from 'zod'
import {
  REGISTRY_NAME_MAX_LENGTH,
  REGISTRY_PROBES_PER_MINUTE,
} from '#shared/utils/connectors-policy'
import { probeRegistryEntry } from '~~/server/utils/connectors/registry-probe'
import { findMcpRegistryEntry } from '~~/server/utils/connectors/registry-search'
import { requireRegistryAccess } from '~~/server/utils/connectors/route'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const MAX_ID_LENGTH = REGISTRY_NAME_MAX_LENGTH + 40

const querySchema = z.object({
  id: z.string().min(1).max(MAX_ID_LENGTH),
})

/**
 * The auth kind and public tools of one directory entry, for its detail
 * view. It takes only a directory id and probes the address stored for it,
 * without credentials, at most once a day per entry for all users; 20
 * requests a minute per user. An id that is not in the directory is 404.
 */
export default defineEventHandler(async (event) => {
  await requireRegistryAccess(event, {
    prefix: 'connectors-registry-probe-rate-limit',
    max: REGISTRY_PROBES_PER_MINUTE,
  })

  const query = querySchema.safeParse(getQuery(event))

  if (!query.success) {
    throw createError({
      message: 'Invalid directory entry',
      status: 400,
      why: 'The id is missing or too long',
      fix: 'Pick an entry from the directory',
    })
  }

  const kv = useKV()
  const entry = await findMcpRegistryEntry(useDb(), kv, query.data.id)

  if (!entry) {
    throw createError({
      message: 'Connector not found',
      status: 404,
      why: 'The directory has no entry with this id',
      fix: 'Pick an entry from the directory',
    })
  }

  const logger = useRequestLogger(event)
  const probe = await probeRegistryEntry(kv, entry, { logger })

  logger.set({
    attributes: {
      connectors: {
        registryProbe: {
          state: probe.state,
          authKind: probe.authKind,
          tools: probe.tools.length,
        },
      },
    },
  })

  return probe
})
