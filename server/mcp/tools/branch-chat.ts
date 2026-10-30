import { z } from 'zod'
import { branchMcpChat } from '~~/server/utils/mcp/private/chat-actions'
import { withMcpPrivateTool } from '~~/server/utils/mcp/private-tool'

const inputSchema = {
  slug: z.ulid().describe('Chat slug from list_chats'),
  messageId: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .optional()
    .describe('Message id from get_chat to branch at. Omit to copy the '
      + 'whole chat'),
}

type BranchChatInput = z.infer<z.ZodObject<typeof inputSchema>>

export default defineMcpTool({
  name: 'branch_chat',
  title: 'Branch a chat',
  description: 'Copy one of your Besidka chats, or its start up to and '
    + 'including a message, into a new chat in the same project. The '
    + 'original is not changed. A chat that is generating a reply is '
    + 'refused (a best-effort check). Returns the new chat slug and title. Requires signing in '
    + '(chats:write).',
  inputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  handler: withMcpPrivateTool(
    'branch_chat',
    async (input: BranchChatInput, context) => {
      const result = await branchMcpChat(
        context.db,
        context.userId,
        input,
        context.logger,
      )

      context.log({
        chat_slug: input.slug,
        branch_slug: result.slug,
        from_message: input.messageId !== undefined,
      })

      return result
    },
  ),
})
