import { z } from 'zod'
import { buildMcpConnectorContext } from '~~/server/utils/mcp/private/connector-context'
import {
  MCP_CONNECTOR_LIST_DEFAULT_LIMIT,
  MCP_CONNECTOR_LIST_MAX_LIMIT,
  listMcpConnectors,
} from '~~/server/utils/mcp/private/connectors'
import { defineBesidkaTool } from '~~/server/utils/besidka-tools/define'

const inputSchema = {
  cursor: z
    .string()
    .max(64)
    .optional()
    .describe('The nextCursor of the previous page'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MCP_CONNECTOR_LIST_MAX_LIMIT)
    .optional()
    .describe(`Page size, 1 to ${MCP_CONNECTOR_LIST_MAX_LIMIT}, default `
      + `${MCP_CONNECTOR_LIST_DEFAULT_LIMIT}`),
}

type ListConnectorsInput = z.infer<z.ZodObject<typeof inputSchema>>

export const listConnectorsBesidkaTool = defineBesidkaTool({
  name: 'list_connectors',
  title: 'List my connectors',
  description: 'List the connectors you added to Besidka (remote MCP '
    + 'servers its chats can use), most recently changed first, with id, '
    + 'title, host, status, whether it is switched on, how many of its '
    + 'tools are on and whether its tools changed since you reviewed '
    + 'them. Never returns addresses beyond the host, keys or tokens. '
    + 'Use nextCursor to get the next page. Requires signing in '
    + '(connectors:read).',
  inputSchema,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  access: 'read',
  chat: {
    excluded: 'Connector management stays in the Besidka app and on the '
      + 'MCP server: a chat that can see and change its own connectors is '
      + 'an injection path to a new data channel.',
  },
  handler: async (input: ListConnectorsInput, context) => {
    const result = await listMcpConnectors(
      buildMcpConnectorContext(context),
      input,
    )

    context.log({ result_count: result.connectors.length })

    return result
  },
})
