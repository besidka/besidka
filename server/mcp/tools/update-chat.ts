import { z } from 'zod'
import { updateMcpChat } from '~~/server/utils/mcp/private/chat-actions'
import { withMcpPrivateTool } from '~~/server/utils/mcp/private-tool'

const inputSchema = {
  slug: z.ulid().describe('Chat slug from list_chats'),
  title: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .describe('New title, 1 to 200 characters'),
  pinned: z
    .boolean()
    .optional()
    .describe('true pins the chat, false unpins it'),
  memoryExcluded: z
    .boolean()
    .optional()
    .describe('true keeps the chat out of memory and removes what memory '
      + 'learned from it, false allows it again'),
  projectId: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .nullable()
    .optional()
    .describe('Project id from list_projects to move the chat into, or null '
      + 'to take it out of its project'),
}

type UpdateChatInput = z.infer<z.ZodObject<typeof inputSchema>>

export default defineMcpTool({
  name: 'update_chat',
  title: 'Update a chat',
  description: 'Change one of your Besidka chats: rename it, pin or unpin '
    + 'it, exclude it from or include it in memory, or move it into a '
    + 'project or out of one. Pass at least one of title, pinned, '
    + 'memoryExcluded and projectId. Each field sets the value you give. '
    + 'Including a chat in memory again covers messages written from now '
    + 'on, not earlier ones. If a call fails partway, the fields before the '
    + 'failing one are already applied, in the order title, pinned, '
    + 'memoryExcluded, projectId. Returns the chat as it is now. '
    + 'Requires signing in (chats:write).',
  inputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: withMcpPrivateTool(
    'update_chat',
    async (input: UpdateChatInput, context) => {
      const chat = await updateMcpChat(
        context.db,
        context.userId,
        input,
        context.logger,
      )

      context.log({
        chat_slug: chat.slug,
        has_title: input.title !== undefined,
        has_pinned: input.pinned !== undefined,
        has_memory_excluded: input.memoryExcluded !== undefined,
        has_project: input.projectId !== undefined,
      })

      return chat
    },
  ),
})
