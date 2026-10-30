import { z } from 'zod'
import {
  MCP_REVOKE_SHARES_MAX,
  revokeMcpChatShares,
} from '~~/server/utils/mcp/private/chat-actions'
import { withMcpPrivateTool } from '~~/server/utils/mcp/private-tool'

const inputSchema = {
  slugs: z
    .array(z.ulid())
    .min(1)
    .max(MCP_REVOKE_SHARES_MAX)
    .describe('Chat slugs from list_chats or list_shared_chats, 1 to 90'),
}

type RevokeChatSharesInput = z.infer<z.ZodObject<typeof inputSchema>>

export default defineMcpTool({
  name: 'revoke_chat_shares',
  title: 'Stop sharing chats',
  description: 'Revoke the public share links of Besidka chats, so the '
    + 'links stop working. The chats themselves stay. Reports the slugs that '
    + 'were revoked and the ones that were not shared or are not your '
    + 'chats. Requires signing in (chats:write).',
  inputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: withMcpPrivateTool(
    'revoke_chat_shares',
    async (input: RevokeChatSharesInput, context) => {
      const result = await revokeMcpChatShares(
        context.db,
        context.userId,
        input,
      )

      context.log({
        requested_count: input.slugs.length,
        revoked_count: result.revoked.length,
        not_shared_count: result.notShared.length,
      })

      return result
    },
  ),
})
