import { z } from 'zod'
import { buildMcpConnectorContext } from '~~/server/utils/mcp/private/connector-context'
import {
  MCP_CONNECTOR_ID_PATTERN,
  getMcpConnector,
} from '~~/server/utils/mcp/private/connectors'
import { defineBesidkaTool } from '~~/server/utils/besidka-tools/define'

const inputSchema = {
  id: z
    .string()
    .regex(MCP_CONNECTOR_ID_PATTERN)
    .describe('Connector id from list_connectors'),
}

type GetConnectorInput = z.infer<z.ZodObject<typeof inputSchema>>

export const getConnectorBesidkaTool = defineBesidkaTool({
  name: 'get_connector',
  title: 'Get a connector',
  description: 'Read one of your Besidka connectors: the summary of '
    + 'list_connectors plus its tools (name, whether it is on, its '
    + 'approval mode and whether the server marks it read-only) and how '
    + 'many times its tools were called in the last 30 days. Tool '
    + 'descriptions are not included. Never returns the full address, '
    + 'keys, tokens or call contents. Requires signing in '
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
  handler: async (input: GetConnectorInput, context) => {
    const result = await getMcpConnector(
      buildMcpConnectorContext(context),
      input,
    )

    context.log({
      connector_id: result.id,
      tool_count: result.tools.length,
    })

    return result
  },
})
