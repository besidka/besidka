import { z } from 'zod'
import {
  MCP_CHAT_LIST_MAX_LIMIT,
  listMcpChats,
  mcpChatSearchTargets,
} from '~~/server/utils/mcp/private/chats'
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
  search: z
    .string()
    .trim()
    .max(200)
    .optional()
    .describe('Search text, at least 2 characters'),
  searchIn: z
    .enum(mcpChatSearchTargets)
    .optional()
    .describe('Search titles, message content or both. Defaults to all'),
  projectId: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .optional()
    .describe('Only the chats of this project, from list_projects'),
  pinnedOnly: z
    .boolean()
    .optional()
    .describe('true returns only pinned chats'),
}

type ListChatsInput = z.infer<z.ZodObject<typeof inputSchema>>

export default defineMcpTool({
  name: 'list_chats',
  title: 'List my chats',
  description: 'List your Besidka chats, most recent activity first, with '
    + 'slug, title, project, and whether each is pinned, shared or excluded '
    + 'from memory. Pass search to find chats by title or message content, '
    + 'projectId for the chats of one project, pinnedOnly for pinned chats. '
    + 'Use get_chat with a slug to read one. Requires signing in '
    + '(chats:read).',
  inputSchema,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: withMcpPrivateTool(
    'list_chats',
    async (input: ListChatsInput, context) => {
      const result = await listMcpChats(
        context.db,
        context.userId,
        input,
        context.logger,
      )

      context.log({
        result_count: result.chats.length,
        has_search: Boolean(input.search),
        has_project_filter: input.projectId !== undefined,
        pinned_only: input.pinnedOnly === true,
      })

      return result
    },
  ),
})
