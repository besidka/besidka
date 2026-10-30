import { z } from 'zod'
import {
  MCP_MOVE_CHATS_MAX,
  moveMcpChatsToProject,
} from '~~/server/utils/mcp/private/chat-actions'
import { withMcpPrivateTool } from '~~/server/utils/mcp/private-tool'

const inputSchema = {
  slugs: z
    .array(z.ulid())
    .min(1)
    .max(MCP_MOVE_CHATS_MAX)
    .describe('Chat slugs from list_chats, 1 to 100'),
  projectId: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .nullable()
    .describe('Project id from list_projects, or null to take the chats '
      + 'out of their projects'),
}

type MoveChatsToProjectInput = z.infer<z.ZodObject<typeof inputSchema>>

export default defineMcpTool({
  name: 'move_chats_to_project',
  title: 'Move chats to a project',
  description: 'Move several of your Besidka chats into a project, or out '
    + 'of any project with a null projectId. Reports how many moved, how '
    + 'many were already there and which slugs are not your chats. '
    + 'Requires signing in (chats:write).',
  inputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: withMcpPrivateTool(
    'move_chats_to_project',
    async (input: MoveChatsToProjectInput, context) => {
      const result = await moveMcpChatsToProject(
        context.db,
        context.userId,
        input,
      )

      context.log({
        requested_count: input.slugs.length,
        moved_count: result.moved,
        already_there_count: result.alreadyThere,
        not_found_count: result.notFound.length,
      })

      return result
    },
  ),
})
