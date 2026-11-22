import { z } from 'zod'
import {
  MCP_GOOGLE_CLIENT_MODES,
  disconnectMcpGoogle,
} from '~~/server/utils/mcp/private/google'
import { defineBesidkaTool } from '~~/server/utils/besidka-tools/define'

const inputSchema = {
  clientMode: z
    .enum(MCP_GOOGLE_CLIENT_MODES)
    .describe('Which connection to end, from list_google_connections: '
      + '"besidka" or "byo"'),
  confirm: z
    .literal(true)
    .describe('Must be true, confirmed by the user'),
}

type DisconnectGoogleInput = z.infer<z.ZodObject<typeof inputSchema>>

export const disconnectGoogleBesidkaTool = defineBesidkaTool({
  name: 'disconnect_google',
  title: 'Disconnect Google',
  description: 'Disconnect Google from your Besidka account for one client '
    + 'mode: the grant is revoked at Google, the stored tokens are cleared '
    + 'and the copies of Google Drive files that Besidka made are deleted, '
    + 'so chats that used them lose them. This cannot be undone and the '
    + 'user will have to connect again in the Besidka app (API Keys, '
    + 'Google): ask the user to confirm first and send confirm: true. '
    + 'Reports revoked (false when Google did not confirm), filesDeleted '
    + 'and filesPending (true when some copies are still being deleted and '
    + 'the hourly sweep finishes it). Cannot connect Google or store a '
    + 'client secret. Requires signing in (connectors:write).',
  inputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  access: 'write',
  chat: {
    excluded: 'Disconnecting Google stays in the Besidka app and on the MCP '
      + 'server: in a chat that holds Google data it would delete the '
      + 'copies the chat is using.',
  },
  handler: async (input: DisconnectGoogleInput, context) => {
    const result = await disconnectMcpGoogle(
      {
        db: context.db,
        userId: context.userId,
        logger: context.logger,
      },
      { clientMode: input.clientMode },
    )

    context.log({
      files_deleted: result.filesDeleted,
      files_pending: result.filesPending,
      revoked: result.revoked,
    })

    return result
  },
})
