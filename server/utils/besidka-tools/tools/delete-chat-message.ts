import { z } from 'zod'
import { deleteMcpChatMessage } from '~~/server/utils/mcp/private/chat-actions'
import { defineBesidkaTool } from '~~/server/utils/besidka-tools/define'
import { plainToken } from '~~/server/utils/besidka-tools/summary'

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

export const deleteChatMessageBesidkaTool = defineBesidkaTool({
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
  access: 'delete',
  chat: { expose: true, tier: 'ask-every-time' },
  chatDescription: 'Permanently delete one message of a chat. The only message of '
    + 'a chat cannot be deleted.',
  summarize: (input: DeleteChatMessageInput) => {
    return `Delete message ${plainToken(input.messageId)} of chat `
      + plainToken(input.slug)
  },
  handler: async (input: DeleteChatMessageInput, context) => {
    const result = await deleteMcpChatMessage(
      context.db,
      context.userId,
      input,
      context.logger,
    )

    context.log({ chat_slug: result.slug, message_id: result.messageId })

    return result
  },
})
