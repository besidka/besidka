import { z } from 'zod'
import {
  MCP_KNOWLEDGE_DELETE_MAX_ITEMS,
  deleteMcpKnowledgeItems,
} from '~~/server/utils/mcp/private/projects'
import { withMcpPrivateTool } from '~~/server/utils/mcp/private-tool'

const inputSchema = {
  projectId: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .describe('Project id from list_projects'),
  itemIds: z
    .array(z.string().trim().min(1).max(32))
    .min(1)
    .max(MCP_KNOWLEDGE_DELETE_MAX_ITEMS)
    .describe('Knowledge item ids from get_project, 1 to 100'),
}

type DeleteKnowledgeItemsInput = z.infer<z.ZodObject<typeof inputSchema>>

export default defineMcpTool({
  name: 'delete_project_knowledge_items',
  title: 'Delete project knowledge items',
  description: 'Permanently delete knowledge items from one of your Besidka '
    + 'projects. Ids that are unknown or belong to another project are '
    + 'skipped and reported, never an error. This cannot be undone: ask '
    + 'the user to confirm first. Requires signing in (data:delete).',
  inputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: withMcpPrivateTool(
    'delete_project_knowledge_items',
    async (input: DeleteKnowledgeItemsInput, context) => {
      const result = await deleteMcpKnowledgeItems(
        context.db,
        context.userId,
        input,
        context.logger,
      )

      context.log({
        project_id: input.projectId,
        deleted_count: result.deleted,
        skipped_count: result.skipped.length,
      })

      return result
    },
  ),
})
