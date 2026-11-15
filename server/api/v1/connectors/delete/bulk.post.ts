import { defineEventHandler } from 'nuxt/server'
import { z } from 'zod'
import { CONNECTOR_DELETE_BATCH } from '#shared/utils/connectors-policy'
import { readConnectorBody } from '~~/server/utils/connectors/body'
import { deleteConnectorsWithRevocation } from '~~/server/utils/connectors/delete'
import { requireConnectorAccess } from '~~/server/utils/connectors/route'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const bodySchema = z.object({
  ids: z.array(z.string().regex(/^[A-Za-z0-9]{1,64}$/))
    .min(1)
    .max(CONNECTOR_DELETE_BATCH),
})

/**
 * Deletes connectors (POST, because a DELETE body may be stripped at the
 * edge). The owned connectors and their credentials are read first; their
 * tokens are then revoked best effort, at most four connectors at a time
 * under a 10 s deadline, and the rows, credentials and settings are removed
 * one by one; audit rows stay. Deleting withdraws the consent, which is
 * logged with the hosts.
 */
export default defineEventHandler(async (event) => {
  const userId = await requireConnectorAccess(event)
  const body = await readConnectorBody(event, bodySchema)
  const { deleted } = await deleteConnectorsWithRevocation(
    useDb(),
    userId,
    body.ids,
    useRequestLogger(event),
  )

  return { deleted }
})
