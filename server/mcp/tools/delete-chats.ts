import { z } from 'zod'
import {
  MCP_DELETE_CHATS_MAX,
  deleteMcpChats,
} from '~~/server/utils/mcp/private/chat-actions'
import { withMcpPrivateTool } from '~~/server/utils/mcp/private-tool'

const inputSchema = {
  slugs: z
    .array(z.ulid())
    .min(1)
    .max(MCP_DELETE_CHATS_MAX)
    .describe('Chat slugs from list_chats, 1 to 25'),
}

type DeleteChatsInput = z.infer<z.ZodObject<typeof inputSchema>>

export default defineMcpTool({
  name: 'delete_chats',
  title: 'Delete chats',
  description: 'Permanently delete Besidka chats with their messages, the '
    + 'memory learned only from them and the files only they produced. This '
    + 'cannot be undone. A chat that is generating a reply is skipped (a best-effort check). '
    + 'Reports the deleted slugs and the skipped ones with the reason: '
    + 'not_found, generating or error (try again). '
    + 'Requires signing in (data:delete).',
  inputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: withMcpPrivateTool(
    'delete_chats',
    async (input: DeleteChatsInput, context) => {
      const result = await deleteMcpChats(
        context.db,
        context.userId,
        input,
        context.logger,
      )

      context.log({
        requested_count: input.slugs.length,
        deleted_count: result.deleted.length,
        skipped_count: result.skipped.length,
      })

      return result
    },
  ),
})
