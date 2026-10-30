import { z } from 'zod'
import {
  MCP_PROJECT_NAME_MAX_CHARS,
  deleteMcpProject,
} from '~~/server/utils/mcp/private/projects'
import { withMcpPrivateTool } from '~~/server/utils/mcp/private-tool'

const inputSchema = {
  projectId: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .describe('Project id from list_projects'),
  confirmName: z
    .string()
    .min(1)
    .max(MCP_PROJECT_NAME_MAX_CHARS)
    .describe('The exact current name of the project, confirmed by the user'),
}

type DeleteProjectInput = z.infer<z.ZodObject<typeof inputSchema>>

export default defineMcpTool({
  name: 'delete_project',
  title: 'Delete a project',
  description: 'Permanently delete one of your Besidka projects with its '
    + 'instructions, knowledge items and project memory. Its chats are '
    + 'kept and detached from the project. This cannot be undone: ask the '
    + 'user to confirm first, and send the exact project name as '
    + 'confirmName. Requires signing in (data:delete).',
  inputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  handler: withMcpPrivateTool(
    'delete_project',
    async (input: DeleteProjectInput, context) => {
      const result = await deleteMcpProject(
        context.db,
        context.userId,
        input,
        context.logger,
      )

      context.log({
        project_id: result.id,
        chats_detached: result.chatsDetached,
      })

      return result
    },
  ),
})
