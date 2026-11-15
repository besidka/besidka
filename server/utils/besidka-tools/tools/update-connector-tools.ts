import { z } from 'zod'
import { CONNECTOR_REMOTE_TOOL_NAME_MAX_LENGTH } from '#shared/utils/connectors-policy'
import { buildMcpConnectorContext } from '~~/server/utils/mcp/private/connector-context'
import {
  MCP_CONNECTOR_ID_PATTERN,
  MCP_CONNECTOR_TOOLS_MAX,
  updateMcpConnectorTools,
} from '~~/server/utils/mcp/private/connectors'
import { defineBesidkaTool } from '~~/server/utils/besidka-tools/define'

const toolChangeSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(CONNECTOR_REMOTE_TOOL_NAME_MAX_LENGTH)
    .describe('The tool name from get_connector'),
  enabled: z
    .literal(false)
    .optional()
    .describe('false turns the tool off. Turning a tool on is only '
      + 'possible in the Besidka app'),
  approval: z
    .literal('ask')
    .optional()
    .describe('ask ends the Always allow setting of the tool, so it asks '
      + 'again. Granting Always allow is only possible in the Besidka '
      + 'app'),
})

const inputSchema = {
  id: z
    .string()
    .regex(MCP_CONNECTOR_ID_PATTERN)
    .describe('Connector id from list_connectors'),
  tools: z
    .array(toolChangeSchema)
    .min(1)
    .max(MCP_CONNECTOR_TOOLS_MAX)
    .describe(`Up to ${MCP_CONNECTOR_TOOLS_MAX} tools to change, each with `
      + 'enabled: false, approval: "ask" or both'),
}

type UpdateConnectorToolsInput = z.infer<z.ZodObject<typeof inputSchema>>

export const updateConnectorToolsBesidkaTool = defineBesidkaTool({
  name: 'update_connector_tools',
  title: 'Restrict connector tools',
  description: 'Reduce what a connector\'s tools may do: turn tools off, or '
    + 'end their Always allow setting by setting them back to ask. Allow in '
    + 'this chat grants of single chats are not changed. It can never turn '
    + 'a tool on, grant Always allow, or switch the connector itself on; '
    + 'those stay in the Besidka app. Every tool name must belong to the '
    + 'connector, or nothing changes. Returns the updated tool list. '
    + 'Requires signing in (connectors:write).',
  inputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  access: 'write',
  chat: {
    excluded: 'Connector management stays in the Besidka app and on the '
      + 'MCP server: tool permissions are the user\'s own decision.',
  },
  handler: async (input: UpdateConnectorToolsInput, context) => {
    const result = await updateMcpConnectorTools(
      buildMcpConnectorContext(context),
      input,
    )

    context.log({
      connector_id: result.id,
      changed_tools: input.tools.length,
    })

    return result
  },
})
