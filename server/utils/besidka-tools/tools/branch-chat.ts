import { z } from 'zod'
import { branchMcpChat } from '~~/server/utils/mcp/private/chat-actions'
import { defineBesidkaTool } from '~~/server/utils/besidka-tools/define'
import { plainToken } from '~~/server/utils/besidka-tools/summary'

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

export const branchChatBesidkaTool = defineBesidkaTool({
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
  access: 'write',
  chat: { expose: true, tier: 'write' },
  chatDescription: 'Copy a chat, or its start up to and including a message, into '
    + 'a new chat in the same project. The original is not changed.',
  summarize: (input: BranchChatInput) => {
    const chat = plainToken(input.slug)

    if (input.messageId) {
      return `Copy chat ${chat} up to message `
        + `${plainToken(input.messageId)} into a new chat`
    }

    return `Copy chat ${chat} into a new chat`
  },
  handler: async (input: BranchChatInput, context) => {
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
})
