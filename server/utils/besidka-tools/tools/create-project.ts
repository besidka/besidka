import { z } from 'zod'
import {
  MCP_PROJECT_NAME_MAX_CHARS,
  createMcpProject,
} from '~~/server/utils/mcp/private/projects'
import { defineBesidkaTool } from '~~/server/utils/besidka-tools/define'
import { quoteText } from '~~/server/utils/besidka-tools/summary'

const inputSchema = {
  name: z
    .string()
    .trim()
    .min(1)
    .max(MCP_PROJECT_NAME_MAX_CHARS)
    .describe('Project name, 1 to 100 characters'),
}

type CreateProjectInput = z.infer<z.ZodObject<typeof inputSchema>>

export const createProjectBesidkaTool = defineBesidkaTool({
  name: 'create_project',
  title: 'Create a project',
  description: 'Create a new project in your Besidka account and return '
    + 'its id. Use it before add_project_text when the user asks for a '
    + 'project that does not exist yet; check list_projects first so you '
    + 'do not create a duplicate. Requires signing in (projects:write).',
  inputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  access: 'write',
  chat: { expose: true, tier: 'write' },
  chatDescription: 'Create a project and return its id. Check list_projects first '
    + 'so you do not create a duplicate.',
  summarize: (input: CreateProjectInput) => {
    return `Create project ${quoteText(input.name)}`
  },
  handler: async (input: CreateProjectInput, context) => {
    const project = await createMcpProject(
      context.db,
      context.userId,
      input.name,
    )

    context.log({ project_id: project.id })

    return project
  },
})
