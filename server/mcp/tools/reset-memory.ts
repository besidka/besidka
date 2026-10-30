import { z } from 'zod'
import {
  mcpMemoryScopes,
  resetMcpMemory,
} from '~~/server/utils/mcp/private/memory'
import { withMcpPrivateTool } from '~~/server/utils/mcp/private-tool'

const inputSchema = {
  scope: z
    .enum(mcpMemoryScopes)
    .describe('account (your account memory), project (one project, needs '
      + 'projectId) or all (account memory and every project)'),
  projectId: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .optional()
    .describe('Project id from list_projects, only with the project scope'),
  onlyGenerated: z
    .boolean()
    .optional()
    .describe('Only with the all scope: delete just the entries Besidka '
      + 'generated from your chats and keep the ones you or a connected '
      + 'app wrote or imported'),
  confirm: z
    .literal(true)
    .describe('Must be true. Only set it after the user agreed to delete '
      + 'this memory'),
}

type ResetMemoryInput = z.infer<z.ZodObject<typeof inputSchema>>

export default defineMcpTool({
  name: 'reset_memory',
  title: 'Reset memory',
  description: 'Permanently delete many memory entries at once: your '
    + 'account memory, one project\'s memory, or everything, optionally '
    + 'only the entries Besidka generated from your chats. Returns how '
    + 'many entries were deleted. To remove a single entry use '
    + 'delete_memory. Requires signing in (data:delete).',
  inputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: withMcpPrivateTool(
    'reset_memory',
    async (input: ResetMemoryInput, context) => {
      const result = await resetMcpMemory(context.db, context.userId, input)

      context.log({
        memory_scope: input.scope,
        memory_only_generated: input.onlyGenerated === true,
        deleted_count: result.deleted,
      })

      return result
    },
  ),
})
