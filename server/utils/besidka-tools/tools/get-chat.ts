import { z } from 'zod'
import {
  MCP_CHAT_MAX_MESSAGES,
  getMcpChat,
} from '~~/server/utils/mcp/private/chats'
import { resolveMcpSiteUrl } from '~~/server/utils/mcp/auth'
import { defineBesidkaTool } from '~~/server/utils/besidka-tools/define'

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

export const getChatBesidkaTool = defineBesidkaTool({
  name: 'get_chat',
  title: 'Read a chat',
  description: 'Read one of your Besidka chats: title, project, whether it '
    + 'is pinned or excluded from memory, its share settings if it has a '
    + 'live share (the share link itself only when the connection can also '
    + 'change chats, chats:write), the models used, a context summary '
    + '(counts of outputs, inputs, web sources, generated images, research '
    + 'reports and memory actions, plus up to 20 attached files by id and '
    + 'name) and the text of its messages, oldest to newest. Long messages '
    + 'and long chats are truncated; file contents, images and tool output '
    + 'are left out. In a chat that holds content from Google Drive, '
    + 'Calendar or Gmail, every message text is replaced by a notice, and '
    + 'files with Google content are not listed. Requires signing in '
    + '(chats:read).',
  inputSchema,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  access: 'read',
  chat: {
    excluded: 'The chat has its own read_chat tool.',
  },
  handler: async (input: GetChatInput, context) => {
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
})
