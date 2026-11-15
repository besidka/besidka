import { z } from 'zod'
import { getMcpProject } from '~~/server/utils/mcp/private/projects'
import { defineBesidkaTool } from '~~/server/utils/besidka-tools/define'

const inputSchema = {
  projectId: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .describe('Project id from list_projects'),
}

type GetProjectInput = z.infer<z.ZodObject<typeof inputSchema>>

export const getProjectBesidkaTool = defineBesidkaTool({
  name: 'get_project',
  title: 'Read a project',
  description: 'Read one of your Besidka projects: name, instructions, '
    + 'pinned and archived state, knowledge mode, project memory state '
    + '(enabled, status, account memory, entry count), knowledge totals '
    + 'against the limits and the knowledge items (id, kind, title, size, '
    + 'status, flagged, pinned). Use read_project_knowledge_item to read '
    + 'an item. Requires signing in (projects:read).',
  inputSchema,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  access: 'read',
  chat: { expose: true, tier: 'read' },
  chatDescription: 'Read one project: name, instructions, pinned and archived '
    + 'state, knowledge mode, project memory state and the knowledge '
    + 'item list. Use read_project_knowledge_item to read an item.',
  handler: async (input: GetProjectInput, context) => {
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
})
