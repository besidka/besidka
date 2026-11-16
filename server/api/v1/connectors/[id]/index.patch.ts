import { defineEventHandler } from 'nuxt/server'
import { z } from 'zod'
import {
  CONNECTOR_TITLE_MAX_LENGTH,
  CONNECTOR_TOOL_MODES,
} from '#shared/utils/connectors-policy'
import { readConnectorBody } from '~~/server/utils/connectors/body'
import {
  assertConnectorConsent,
  issuerHostOf,
} from '~~/server/utils/connectors/consent'
import { createConnectorError } from '~~/server/utils/connectors/errors'
import {
  requireConnectorAccess,
  requireOwnedConnector,
} from '~~/server/utils/connectors/route'
import {
  readConnectorCredentials,
  readConnectorToolBaseline,
  updateConnector,
} from '~~/server/utils/connectors/store'
import type { ConnectorRecord } from '~~/server/utils/connectors/store'
import { requireLegalConsent } from '~~/server/utils/legal/consent'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const bodySchema = z.object({
  enabled: z.boolean().optional(),
  title: z.string().trim().min(1).max(CONNECTOR_TITLE_MAX_LENGTH).optional(),
  toolMode: z.enum(CONNECTOR_TOOL_MODES).optional(),
})

async function assertConsentsForEnable(
  userId: number,
  connector: ConnectorRecord,
) {
  const db = useDb()

  await requireLegalConsent(userId, db)

  if (connector.authType !== 'oauth') {
    assertConnectorConsent(connector)

    return
  }

  const credentials = await readConnectorCredentials(db, userId, connector.id)

  if (!credentials?.issuer) {
    throw createConnectorError('CONNECTOR_NOT_READY')
  }

  assertConnectorConsent(connector, issuerHostOf(credentials.issuer))
}

async function assertCanEnable(userId: number, connector: ConnectorRecord) {
  if (connector.status === 'drifted') {
    throw createConnectorError('CONNECTOR_TOOLS_REVIEW_REQUIRED')
  }

  if (connector.status !== 'ready') {
    throw createConnectorError('CONNECTOR_NOT_READY')
  }

  await assertConsentsForEnable(userId, connector)

  const { isBaselined } = await readConnectorToolBaseline(
    useDb(),
    userId,
    connector.id,
  )

  if (!isBaselined) {
    throw createConnectorError('CONNECTOR_TOOLS_REVIEW_REQUIRED')
  }
}

/**
 * Renames a connector, turns it on or off, or sets how its tools reach the
 * model (`toolMode`: Auto lists them in the tool index for the model to load
 * when a request needs them, Always on offers them with every message), in
 * the app only; MCP has no tool for any of it. Turning it on
 * needs a connected connector whose tools were reviewed on the Connectors
 * page (a first review, and no unaccepted change: `drifted` is refused), a
 * current sign-up consent and a current per-connector consent for its
 * origin and issuer; turning it off is always allowed. The review rule is
 * enforced here, not only in the page, because any client can call this
 * route.
 */
export default defineEventHandler(async (event) => {
  const userId = await requireConnectorAccess(event)
  const connector = await requireOwnedConnector(event, userId)
  const body = await readConnectorBody(event, bodySchema)

  if (body.enabled === true && !connector.enabled) {
    await assertCanEnable(userId, connector)
  }

  const updated = await updateConnector(useDb(), userId, connector.id, {
    title: body.title,
    enabled: body.enabled,
    toolMode: body.toolMode,
  })

  useRequestLogger(event).set({
    attributes: {
      connectors: {
        step: 'update',
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
        ...(body.toolMode ? { toolMode: body.toolMode } : {}),
      },
    },
  })

  return { connector: updated }
})
