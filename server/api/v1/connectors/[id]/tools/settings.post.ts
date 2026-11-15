import { defineEventHandler } from 'nuxt/server'
import { z } from 'zod'
import { CONNECTOR_REMOTE_TOOL_NAME_MAX_LENGTH } from '#shared/utils/connectors-policy'
import { readConnectorBody } from '~~/server/utils/connectors/body'
import { createConnectorError } from '~~/server/utils/connectors/errors'
import {
  requireConnectorAccess,
  requireOwnedConnector,
} from '~~/server/utils/connectors/route'
import { updateConnectorToolSwitches } from '~~/server/utils/connectors/store'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const TOOLS_PER_REQUEST = 40

const bodySchema = z.object({
  tools: z.array(z.object({
    name: z.string().min(1).max(CONNECTOR_REMOTE_TOOL_NAME_MAX_LENGTH),
    enabled: z.boolean().optional(),
    approval: z.literal('ask').optional(),
  }).refine((tool) => {
    return tool.enabled !== undefined || tool.approval !== undefined
  })).min(1).max(TOOLS_PER_REQUEST),
})

/**
 * Turns reviewed tools on or off, and removes an "Always allow" grant
 * (`approval: 'ask'`). The page never grants "Always allow": that choice
 * is made on a real call in the chat, with its confirmation. Neither change
 * touches the reviewed definition hash, so a changed tool stays hidden until
 * the user reviews it. Unknown names answer 404.
 */
export default defineEventHandler(async (event) => {
  const userId = await requireConnectorAccess(event, { selection: true })
  const connector = await requireOwnedConnector(event, userId)
  const body = await readConnectorBody(event, bodySchema)
  const updated = await updateConnectorToolSwitches(
    useDb(),
    userId,
    connector.id,
    body.tools.map((tool) => {
      return {
        toolName: tool.name,
        enabled: tool.enabled,
        resetApproval: tool.approval === 'ask',
      }
    }),
  )

  useRequestLogger(event).set({
    attributes: {
      connectors: {
        step: 'tool-settings',
        requested: body.tools.length,
        updated: updated.length,
      },
    },
  })

  if (updated.length === 0) {
    throw createConnectorError('CONNECTOR_TOOL_NOT_FOUND')
  }

  return { updated }
})
