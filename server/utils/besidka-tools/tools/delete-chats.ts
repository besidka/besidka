import { z } from 'zod'
import {
  MCP_DELETE_CHATS_MAX,
  deleteMcpChats,
} from '~~/server/utils/mcp/private/chat-actions'
import { defineBesidkaTool } from '~~/server/utils/besidka-tools/define'
import { pluralize, listTokens } from '~~/server/utils/besidka-tools/summary'

const inputSchema = {
  slugs: z
    .array(z.ulid())
    .min(1)
    .max(MCP_DELETE_CHATS_MAX)
    .describe('Chat slugs from list_chats, 1 to 25'),
}

type DeleteChatsInput = z.infer<z.ZodObject<typeof inputSchema>>

export const deleteChatsBesidkaTool = defineBesidkaTool({
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
  access: 'delete',
  chat: { expose: true, tier: 'ask-every-time' },
  chatDescription: 'Permanently delete chats with their messages and the files '
    + 'only they produced. This cannot be undone.',
  summarize: (input: DeleteChatsInput) => {
    return `Delete ${pluralize(input.slugs.length, 'chat')}: `
      + listTokens(input.slugs)
  },
  handler: async (input: DeleteChatsInput, context) => {
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
})
