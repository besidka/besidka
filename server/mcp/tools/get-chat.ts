import { z } from 'zod'
import {
  MCP_CHAT_MAX_MESSAGES,
  getMcpChat,
} from '~~/server/utils/mcp/private/chats'
import { resolveMcpSiteUrl } from '~~/server/utils/mcp/auth'
import { withMcpPrivateTool } from '~~/server/utils/mcp/private-tool'

const inputSchema = {
  slug: z.ulid().describe('Chat slug from list_chats'),
  maxMessages: z
    .number()
    .int()
    .min(1)
    .max(MCP_CHAT_MAX_MESSAGES)
    .optional()
    .describe('Newest messages to return, 1 to 200. Defaults to 50'),
}

type GetChatInput = z.infer<z.ZodObject<typeof inputSchema>>

export default defineMcpTool({
  name: 'get_chat',
  title: 'Read a chat',
  description: 'Read one of your Besidka chats: title, project, whether it '
    + 'is pinned or excluded from memory, its share settings if it has a '
    + 'live share (the share link itself only when the connection can also '
    + 'change chats, chats:write), the models used and the text of its messages, oldest to newest. Long '
    + 'messages and long chats are truncated; files, images and tool '
    + 'output are left out. Requires signing in (chats:read).',
  inputSchema,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: withMcpPrivateTool(
    'get_chat',
    async (input: GetChatInput, context) => {
      const chat = await getMcpChat(context.db, context.userId, {
        ...input,
        siteUrl: resolveMcpSiteUrl(),
        includeShareUrl: context.scopes.includes('chats:write'),
      })

      context.log({
        chat_slug: chat.slug,
        result_count: chat.messages.length,
        truncated: chat.truncated,
      })

      return chat
    },
  ),
})
