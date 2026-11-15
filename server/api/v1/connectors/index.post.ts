import { defineEventHandler, setResponseStatus } from 'nuxt/server'
import { z } from 'zod'
import {
  CONNECTOR_TITLE_MAX_LENGTH,
  CONNECTOR_URL_MAX_LENGTH,
} from '#shared/utils/connectors-policy'
import { addConnector } from '~~/server/utils/connectors/add'
import { readConnectorBody } from '~~/server/utils/connectors/body'
import { requireConnectorAccess } from '~~/server/utils/connectors/route'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const bodySchema = z.object({
  url: z.string().min(1).max(CONNECTOR_URL_MAX_LENGTH).optional(),
  title: z.string().max(CONNECTOR_TITLE_MAX_LENGTH).optional(),
  presetId: z.string().min(1).max(32).optional(),
})

/**
 * Adds a connector without any network request (docs/connectors.md section
 * 5.1): the URL is checked syntactically, a preset's own URL replaces the
 * input, and the row starts disabled in `needs-auth`.
 */
export default defineEventHandler(async (event) => {
  const userId = await requireConnectorAccess(event)
  const body = await readConnectorBody(event, bodySchema)
  const { connector, host } = await addConnector(useDb(), {
    userId,
    url: body.url,
    title: body.title,
    presetId: body.presetId,
    source: { via: 'app' },
  })

  useRequestLogger(event).set({
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
