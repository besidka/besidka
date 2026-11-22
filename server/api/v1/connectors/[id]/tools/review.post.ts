import { defineEventHandler } from 'nuxt/server'
import { z } from 'zod'
import { readConnectorBody } from '~~/server/utils/connectors/body'
import { createConnectorError } from '~~/server/utils/connectors/errors'
import {
  requireConnectorAccess,
  requireOwnedConnector,
} from '~~/server/utils/connectors/route'
import {
  applyConnectorToolsReview,
  planConnectorToolsReview,
} from '~~/server/utils/connectors/tool-review'
import { requireLegalConsent } from '~~/server/utils/legal/consent'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const bodySchema = z.object({
  decision: z.enum(['accept', 'keep-disabled']),
  reviewToken: z.string().regex(/^[a-f0-9]{64}$/),
})

/**
 * Stores the reviewed tool list as the connector's baseline ("Accept
 * changes" or "Keep disabled", docs/connectors.md section 10.1). The list is
 * read again and must match the review token the page showed, so a server
 * that changed its tools after the user looked answers 409 and nothing is
 * stored.
 */
export default defineEventHandler(async (event) => {
  const userId = await requireConnectorAccess(event)
  const connector = await requireOwnedConnector(event, userId)
  const body = await readConnectorBody(event, bodySchema)
  const logger = useRequestLogger(event)
  const db = useDb()

  if (connector.status === 'needs-auth' || !connector.authType) {
    throw createConnectorError('CONNECTOR_NOT_READY')
  }

  await requireLegalConsent(userId, db)

  const plan = await planConnectorToolsReview({
    db,
    kv: useKV(),
    userId,
    connector,
    logger,
  })

  if (plan.review.reviewToken !== body.reviewToken) {
    throw createConnectorError('CONNECTOR_TOOLS_REVIEW_STALE')
  }

  await applyConnectorToolsReview({
    db,
    userId,
    connector,
    plan,
    decision: body.decision,
  })

  logger.set({
    attributes: {
      connectors: {
        step: 'tools-review',
        decision: body.decision,
        pending: plan.review.counts.pending,
        removed: plan.review.removed.length,
      },
    },
  })

  return { ok: true }
})
