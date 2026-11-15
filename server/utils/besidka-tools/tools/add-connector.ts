import { z } from 'zod'
import {
  CONNECTOR_TITLE_MAX_LENGTH,
  CONNECTOR_URL_MAX_LENGTH,
} from '#shared/utils/connectors-policy'
import { buildMcpConnectorContext } from '~~/server/utils/mcp/private/connector-context'
import { addMcpConnector } from '~~/server/utils/mcp/private/connectors'
import { defineBesidkaTool } from '~~/server/utils/besidka-tools/define'

const inputSchema = {
  url: z
    .string()
    .trim()
    .min(1)
    .max(CONNECTOR_URL_MAX_LENGTH)
    .optional()
    .describe('The https address of the remote MCP server. Not needed '
      + 'when presetId is set'),
  title: z
    .string()
    .trim()
    .min(1)
    .max(CONNECTOR_TITLE_MAX_LENGTH)
    .optional()
    .describe('A display name, up to 80 characters. Defaults to the '
      + 'preset name or the host'),
  presetId: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .optional()
    .describe('The id of one of the curated connectors in Besidka, '
      + 'instead of url'),
}

type AddConnectorInput = z.infer<z.ZodObject<typeof inputSchema>>

export const addConnectorBesidkaTool = defineBesidkaTool({
  name: 'add_connector',
  title: 'Add a connector',
  description: 'Add a remote MCP server to your Besidka connectors by '
    + 'address. The connector is created switched off and not signed in: '
    + 'this tool takes no keys or headers, makes no request to the '
    + 'address and cannot switch it on. The user must connect, give '
    + 'consent and enable it in Besidka, at the manageUrl in the result. '
    + 'At most five connectors added this way can wait switched off. '
    + 'Requires signing in (connectors:write).',
  inputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  access: 'write',
  chat: {
    excluded: 'Connector management stays in the Besidka app and on the '
      + 'MCP server: adding a connector opens a new data recipient, which '
      + 'needs the consent screen of the app.',
  },
  handler: async (input: AddConnectorInput, context) => {
    const result = await addMcpConnector(
      buildMcpConnectorContext(context),
      input,
    )

    context.log({ connector_id: result.id })

    return result
  },
})
