import { z } from 'zod'
import { buildMcpConnectorContext } from '~~/server/utils/mcp/private/connector-context'
import {
  MCP_CONNECTOR_DELETE_MAX,
  MCP_CONNECTOR_ID_PATTERN,
  deleteMcpConnectors,
} from '~~/server/utils/mcp/private/connectors'
import { defineBesidkaTool } from '~~/server/utils/besidka-tools/define'

const inputSchema = {
  ids: z
    .array(z.string().regex(MCP_CONNECTOR_ID_PATTERN))
    .min(1)
    .max(MCP_CONNECTOR_DELETE_MAX)
    .describe(`Connector ids from list_connectors, 1 to `
      + `${MCP_CONNECTOR_DELETE_MAX}`),
  confirm: z
    .literal(true)
    .describe('Must be true, confirmed by the user'),
}

type DeleteConnectorsInput = z.infer<z.ZodObject<typeof inputSchema>>

export const deleteConnectorsBesidkaTool = defineBesidkaTool({
  name: 'delete_connectors',
  title: 'Delete connectors',
  description: 'Permanently delete connectors from your Besidka account: '
    + 'their sign-in is revoked at the server when it supports that, and '
    + 'their stored credentials, tool settings and per-chat settings are '
    + 'removed. Chats and the record of past tool calls stay. This cannot '
    + 'be undone: ask the user to confirm first and send confirm: true. '
    + 'Reports the ids that were deleted and the ones that are not '
    + 'yours. Requires signing in (connectors:write).',
  inputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  access: 'write',
  chat: {
    excluded: 'Connector management stays in the Besidka app and on the '
      + 'MCP server.',
  },
  handler: async (input: DeleteConnectorsInput, context) => {
    const result = await deleteMcpConnectors(
      buildMcpConnectorContext(context),
      { ids: input.ids },
    )

    context.log({
      requested_count: input.ids.length,
      deleted_count: result.deleted.length,
    })

    return result
  },
})
