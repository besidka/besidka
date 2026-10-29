import { z } from 'zod'
import { getMcpProject } from '~~/server/utils/mcp/private/projects'
import { withMcpPrivateTool } from '~~/server/utils/mcp/private-tool'

const inputSchema = {
  projectId: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .describe('Project id from list_projects'),
}

type GetProjectInput = z.infer<z.ZodObject<typeof inputSchema>>

export default defineMcpTool({
  name: 'get_project',
  title: 'Read a project',
  description: 'Read one of your Besidka projects: name, instructions, '
    + 'knowledge mode and the knowledge items (id, kind, title, size, '
    + 'status, flagged, pinned). Use read_project_knowledge_item to read '
    + 'an item. Requires signing in (projects:read).',
  inputSchema,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: withMcpPrivateTool(
    'get_project',
    async (input: GetProjectInput, context) => {
      const project = await getMcpProject(
        context.db,
        context.userId,
        input.projectId,
      )

      context.log({
        project_id: project.id,
        result_count: project.knowledge.length,
      })

      return project
    },
  ),
})
