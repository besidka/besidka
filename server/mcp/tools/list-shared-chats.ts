import { z } from 'zod'
import { resolveMcpSiteUrl } from '~~/server/utils/mcp/auth'
import { MCP_CHAT_LIST_MAX_LIMIT } from '~~/server/utils/mcp/private/chats'
import { listMcpSharedChats } from '~~/server/utils/mcp/private/chat-actions'
import { withMcpPrivateTool } from '~~/server/utils/mcp/private-tool'

const inputSchema = {
  cursor: z
    .string()
    .max(300)
    .optional()
    .describe('nextCursor from the previous page'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MCP_CHAT_LIST_MAX_LIMIT)
    .optional()
    .describe('Chats per page, 1 to 50. Defaults to 20'),
}

type ListSharedChatsInput = z.infer<z.ZodObject<typeof inputSchema>>

export default defineMcpTool({
  name: 'list_shared_chats',
  title: 'List my shared chats',
  description: 'List your Besidka chats that have a live public share link, '
    + 'most recent activity first, with its expiry and what the link shows. '
    + 'The link itself (shareUrl) is included only when the connection can '
    + 'also change chats (chats:write). Use revoke_chat_shares to stop '
    + 'sharing. Requires signing in (chats:read).',
  inputSchema,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: withMcpPrivateTool(
    'list_shared_chats',
    async (input: ListSharedChatsInput, context) => {
      const result = await listMcpSharedChats(
        context.db,
        context.userId,
        {
          ...input,
          siteUrl: resolveMcpSiteUrl(),
          includeShareUrl: context.scopes.includes('chats:write'),
        },
      )

      context.log({ result_count: result.chats.length })

      return result
    },
  ),
})
