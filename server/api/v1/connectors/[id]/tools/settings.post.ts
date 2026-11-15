import { defineEventHandler } from 'nuxt/server'
import { z } from 'zod'
import { CONNECTOR_REMOTE_TOOL_NAME_MAX_LENGTH } from '#shared/utils/connectors-policy'
import { TOOL_PERMISSION_MODES } from '#shared/utils/tool-approval-policy'
import type { ToolPermissionMode } from '#shared/utils/tool-approval-policy'
import { readConnectorBody } from '~~/server/utils/connectors/body'
import {
  connectorErrorCodeOf,
  createConnectorError,
  isConnectorErrorCode,
} from '~~/server/utils/connectors/errors'
import {
  requireConnectorAccess,
  requireOwnedConnector,
} from '~~/server/utils/connectors/route'
import {
  readConnectorToolBaseline,
  updateConnectorToolSwitches,
} from '~~/server/utils/connectors/store'
import type {
  ConnectorRecord,
  ConnectorToolSwitch,
} from '~~/server/utils/connectors/store'
import {
  loadConnectorToolDefinitions,
  resolveAlwaysAllowHashes,
} from '~~/server/utils/connectors/tool-review'
import { requireLegalConsent } from '~~/server/utils/legal/consent'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'
import type { LoggerLike } from '~~/server/utils/files/logger'

const TOOLS_PER_REQUEST = 40

const bodySchema = z.object({
  tools: z.array(z.object({
    name: z.string().min(1).max(CONNECTOR_REMOTE_TOOL_NAME_MAX_LENGTH),
    enabled: z.boolean().optional(),
    approval: z.literal('ask').optional(),
    mode: z.enum(TOOL_PERMISSION_MODES).optional(),
  }).refine((tool) => {
    return tool.mode !== undefined
      || tool.enabled !== undefined
      || tool.approval !== undefined
  }).refine((tool) => {
    return tool.mode === undefined
      || (tool.enabled === undefined && tool.approval === undefined)
  })).min(1).max(TOOLS_PER_REQUEST),
})

type ToolChange = z.infer<typeof bodySchema>['tools'][number]

function toSwitch(
  tool: ToolChange,
  alwaysAllowHashes: ReadonlyMap<string, string>,
): ConnectorToolSwitch {
  const modeSwitches: Record<ToolPermissionMode, ConnectorToolSwitch> = {
    blocked: { toolName: tool.name, enabled: false },
    ask: { toolName: tool.name, enabled: true, resetApproval: true },
    allow: {
      toolName: tool.name,
      enabled: true,
      alwaysAllowHash: alwaysAllowHashes.get(tool.name),
    },
  }

  if (tool.mode) {
    return modeSwitches[tool.mode]
  }

  return {
    toolName: tool.name,
    enabled: tool.enabled,
    resetApproval: tool.approval === 'ask',
  }
}

async function loadAllowedHashes(input: {
  connector: ConnectorRecord
  userId: number
  toolNames: string[]
  logger: LoggerLike
}): Promise<Map<string, string>> {
  const db = useDb()
  const { definitions, hashes } = await loadConnectorToolDefinitions({
    db,
    kv: useKV(),
    userId: input.userId,
    connector: input.connector,
    logger: input.logger,
  })
  const { settings } = await readConnectorToolBaseline(
    db,
    input.userId,
    input.connector.id,
  )
  const resolved = resolveAlwaysAllowHashes({
    definitions,
    hashes,
    settings,
    toolNames: input.toolNames,
  })

  if (resolved.refused.length > 0) {
    throw createConnectorError('CONNECTOR_TOOL_ALWAYS_ALLOW_REFUSED')
  }

  return resolved.hashes
}

/**
 * The reviewed hash of every tool to set to Always allow, checked on the
 * live tool list with the same guards as the tool listing: a connector that
 * is not connected answers `CONNECTOR_NOT_READY`, the sign-up consent is
 * required before any request that can carry a token, and a failure is
 * reported by a fixed code, never with text from the remote server.
 */
async function resolveAllowedHashes(input: {
  connector: ConnectorRecord
  userId: number
  toolNames: string[]
  logger: LoggerLike
}): Promise<Map<string, string>> {
  if (input.toolNames.length === 0) {
    return new Map()
  }

  if (input.connector.status === 'needs-auth' || !input.connector.authType) {
    throw createConnectorError('CONNECTOR_NOT_READY')
  }

  await requireLegalConsent(input.userId, useDb())

  try {
    return await loadAllowedHashes(input)
  } catch (exception) {
    const code = connectorErrorCodeOf(exception, 'CONNECTOR_UNREACHABLE')

    input.logger.set({
      attributes: { connectors: { step: 'tool-settings', code } },
    })

    throw createConnectorError(
      isConnectorErrorCode(code) ? code : 'CONNECTOR_UNREACHABLE',
    )
  }
}

/**
 * Sets the mode of reviewed tools: Blocked (off), Needs approval, or Always
 * allow, which is bound to the reviewed definition hash and refused for a
 * tool that deletes or shares data or changed since the review (checked on
 * the live tool list, never on the client's word). The legacy fields turn a
 * tool on or off (`enabled`) or remove an Always allow (`approval: 'ask'`).
 * No change touches the reviewed hash, so a changed tool stays hidden until
 * the user reviews it. Unknown names answer 404.
 */
export default defineEventHandler(async (event) => {
  const userId = await requireConnectorAccess(event, { selection: true })
  const connector = await requireOwnedConnector(event, userId)
  const body = await readConnectorBody(event, bodySchema)
  const logger = useRequestLogger(event)
  const alwaysAllowNames = body.tools
    .filter(tool => tool.mode === 'allow')
    .map(tool => tool.name)
  const alwaysAllowHashes = await resolveAllowedHashes({
    connector,
    userId,
    toolNames: alwaysAllowNames,
    logger,
  })
  const updated = await updateConnectorToolSwitches(
    useDb(),
    userId,
    connector.id,
    body.tools.map(tool => toSwitch(tool, alwaysAllowHashes)),
  )

  logger.set({
    attributes: {
      connectors: {
        step: 'tool-settings',
        requested: body.tools.length,
        alwaysAllow: alwaysAllowNames.length,
        updated: updated.length,
      },
    },
  })

  if (updated.length === 0) {
    throw createConnectorError('CONNECTOR_TOOL_NOT_FOUND')
  }

  return { updated }
})
