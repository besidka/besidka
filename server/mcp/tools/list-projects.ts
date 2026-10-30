import { z } from 'zod'
import {
  MCP_PROJECT_LIST_MAX_LIMIT,
  listMcpProjects,
} from '~~/server/utils/mcp/private/projects'
import { withMcpPrivateTool } from '~~/server/utils/mcp/private-tool'

const inputSchema = {
  cursor: z
    .string()
    .max(300)
    .optional()
    .describe('nextCursor from the previous page'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MCP_PROJECT_LIST_MAX_LIMIT)
    .optional()
    .describe('Projects per page, 1 to 50. Defaults to 20'),
  search: z
    .string()
    .trim()
    .max(200)
    .optional()
    .describe('Filter by project name'),
  archived: z
    .boolean()
    .optional()
    .describe('List archived projects instead. Defaults to false'),
  sortBy: z
    .enum(['activity', 'name'])
    .optional()
    .describe('activity (most recent first, default) or name (A to Z)'),
  pinnedOnly: z
    .boolean()
    .optional()
    .describe('List only pinned projects. Defaults to false'),
}

type ListProjectsInput = z.infer<z.ZodObject<typeof inputSchema>>

export default defineMcpTool({
  name: 'list_projects',
  title: 'List my projects',
  description: 'List your Besidka projects, most recent activity first '
    + 'unless sorted by name, with id, name and pinned state. Use '
    + 'get_project to read instructions and the '
    + 'knowledge item list. Requires signing in (projects:read).',
  inputSchema,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: withMcpPrivateTool(
    'list_projects',
    async (input: ListProjectsInput, context) => {
      const result = await listMcpProjects(context.db, context.userId, input)

      context.log({ result_count: result.projects.length })

      return result
    },
  ),
})
