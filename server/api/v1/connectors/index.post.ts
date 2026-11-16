import { createError } from 'evlog'
import { defineEventHandler, setResponseStatus } from 'nuxt/server'
import type { RequestEvent } from 'nuxt/server'
import { z } from 'zod'
import {
  CONNECTOR_TITLE_MAX_LENGTH,
  CONNECTOR_URL_MAX_LENGTH,
} from '#shared/utils/connectors-policy'
import {
  addConnector,
  findActiveRegistryEntry,
} from '~~/server/utils/connectors/add'
import { readConnectorBody } from '~~/server/utils/connectors/body'
import { discoverConnectorAuth } from '~~/server/utils/connectors/oauth-metadata'
import { connectorErrorCodeOf } from '~~/server/utils/connectors/errors'
import { requireConnectorAccess } from '~~/server/utils/connectors/route'
import { requireFeature } from '~~/server/utils/features/guards'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const REGISTRY_ENTRY_ID_MAX_LENGTH = 300

const bodySchema = z.object({
  url: z.string().min(1).max(CONNECTOR_URL_MAX_LENGTH).optional(),
  title: z.string().max(CONNECTOR_TITLE_MAX_LENGTH).optional(),
  presetId: z.string().min(1).max(32).optional(),
  registryId: z.string().min(1).max(REGISTRY_ENTRY_ID_MAX_LENGTH).optional(),
})

async function findDirectoryEntry(
  event: RequestEvent,
  db: ReturnType<typeof useDb>,
  registryId: string,
) {
  await requireFeature(event, 'connectors.registry')

  const entry = await findActiveRegistryEntry(db, registryId)

  if (!entry) {
    throw createError({
      message: 'Unknown directory entry',
      status: 400,
      why: 'No active entry of the MCP Registry copy has this id',
      fix: 'Search the directory again',
    })
  }

  return entry
}

/**
 * Adds a connector from the app (docs/connectors.md section 5.1): the URL is
 * checked syntactically, a preset's own URL (or a directory entry's, from the
 * local MCP Registry copy) replaces the input, the server gets the same
 * unauthenticated probe the Connect step sends, and only when it answers as
 * an MCP server does the row start, disabled, in `needs-auth`. A failed probe
 * stores nothing.
 */
export default defineEventHandler(async (event) => {
  const userId = await requireConnectorAccess(event)
  const body = await readConnectorBody(event, bodySchema)
  const db = useDb()
  const logger = useRequestLogger(event)
  const registryEntry = body.registryId && !body.presetId
    ? await findDirectoryEntry(event, db, body.registryId)
    : null
  const { connector, host } = await addConnector(db, {
    userId,
    url: body.url,
    title: body.title,
    presetId: body.presetId,
    source: registryEntry
      ? { via: 'registry', entry: registryEntry }
      : { via: 'app' },
    verifyServer: async (target) => {
      try {
        await discoverConnectorAuth(target.url, logger, {
          allowOAuth: target.allowOAuth,
        })
      } catch (exception) {
        logger.set({
          attributes: {
            connectors: {
              step: 'create',
              code: connectorErrorCodeOf(
                exception,
                'CONNECTOR_DISCOVERY_FAILED',
              ),
              stored: false,
            },
          },
        })

        throw exception
      }
    },
  })

  logger.set({
    attributes: {
      connectors: {
        id: connector.id,
        host,
        step: 'create',
      },
    },
  })

  setResponseStatus(event, 201)

  return { connector }
})
