import { z } from 'zod'
import { deleteMcpChatMessage } from '~~/server/utils/mcp/private/chat-actions'
import { withMcpPrivateTool } from '~~/server/utils/mcp/private-tool'

const inputSchema = {
  slug: z.ulid().describe('Chat slug from list_chats'),
  messageId: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .describe('Message id from get_chat'),
}

type DeleteChatMessageInput = z.infer<z.ZodObject<typeof inputSchema>>

export default defineMcpTool({
  name: 'delete_chat_message',
  title: 'Delete a chat message',
  description: 'Permanently delete one message of a Besidka chat, with the '
    + 'files only that message produced. The only message of a chat cannot '
    + 'be deleted, delete the chat instead. A chat that is generating a '
    + 'reply is refused (a best-effort check). Requires signing in (data:delete).',
  inputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: withMcpPrivateTool(
    'delete_chat_message',
    async (input: DeleteChatMessageInput, context) => {
      const result = await deleteMcpChatMessage(
        context.db,
        context.userId,
        input,
        context.logger,
      )

      context.log({ chat_slug: result.slug, message_id: result.messageId })

      return result
    },
  ),
})
