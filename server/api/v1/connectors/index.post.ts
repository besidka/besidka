import { createError } from 'evlog'
import { defineEventHandler, setResponseStatus } from 'nuxt/server'
import { z } from 'zod'
import {
  CONNECTOR_TITLE_MAX_LENGTH,
  CONNECTOR_URL_MAX_LENGTH,
} from '#shared/utils/connectors-policy'
import { deriveConnectorSlugBase } from '#shared/utils/connectors-slug'
import { findConnectorPreset } from '~~/config/connectors-catalog'
import { readConnectorBody } from '~~/server/utils/connectors/body'
import { requireConnectorAccess } from '~~/server/utils/connectors/route'
import { createConnector } from '~~/server/utils/connectors/store'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'
import { parseSafeOutboundUrl } from '~~/server/utils/net/safe-url'

const bodySchema = z.object({
  url: z.string().min(1).max(CONNECTOR_URL_MAX_LENGTH).optional(),
  title: z.string().max(CONNECTOR_TITLE_MAX_LENGTH).optional(),
  presetId: z.string().min(1).max(32).optional(),
})

function invalidAddress() {
  return createError({
    message: 'This address is not allowed',
    status: 400,
    why: 'The connector address is not a public https URL with a host name',
    fix: 'Use the https address of the MCP server',
  })
}

/**
 * Adds a connector without any network request (docs/connectors.md section
 * 5.1): the URL is checked syntactically, a preset's own URL replaces the
 * input, and the row starts disabled in `needs-auth`.
 */
export default defineEventHandler(async (event) => {
  const userId = await requireConnectorAccess(event)
  const body = await readConnectorBody(event, bodySchema)
  const preset = body.presetId ? findConnectorPreset(body.presetId) : null

  if (body.presetId && !preset) {
    throw createError({
      message: 'Unknown preset',
      status: 400,
      why: 'No catalog entry has this id',
      fix: 'Pick a preset from the list',
    })
  }

  const rawUrl = preset?.url ?? body.url

  if (!rawUrl) {
    throw invalidAddress()
  }

  const parsed = parseSafeOutboundUrl(rawUrl)

  if (!parsed.ok) {
    throw invalidAddress()
  }

  const title = body.title?.trim() || preset?.title || parsed.url.hostname
  const connector = await createConnector(useDb(), {
    userId,
    title,
    url: parsed.url.toString(),
    slugBase: preset?.id ?? deriveConnectorSlugBase(parsed.url.hostname),
    createdVia: preset ? 'preset' : 'app',
    presetId: preset?.id ?? null,
  })

  useRequestLogger(event).set({
    attributes: {
      connectors: {
        id: connector.id,
        host: parsed.url.host,
        step: 'create',
      },
    },
  })

  setResponseStatus(event, 201)

  return { connector }
})
