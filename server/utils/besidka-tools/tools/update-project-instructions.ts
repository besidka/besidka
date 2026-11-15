import { z } from 'zod'
import {
  MCP_PROJECT_INSTRUCTIONS_MAX_CHARS,
  updateMcpProjectInstructions,
} from '~~/server/utils/mcp/private/projects'
import { defineBesidkaTool } from '~~/server/utils/besidka-tools/define'
import { plainToken } from '~~/server/utils/besidka-tools/summary'

const inputSchema = {
  projectId: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .describe('Project id from list_projects'),
  instructions: z
    .string()
    .max(MCP_PROJECT_INSTRUCTIONS_MAX_CHARS)
    .nullable()
    .describe('New instructions, up to 10000 characters. null clears them'),
}

type UpdateInstructionsInput = z.infer<z.ZodObject<typeof inputSchema>>

export const updateProjectInstructionsBesidkaTool = defineBesidkaTool({
  name: 'update_project_instructions',
  title: 'Update project instructions',
  description: 'Replace the custom instructions of one of your Besidka '
    + 'projects, or clear them with null. The old text is not kept. '
    + 'Requires signing in (projects:write).',
  inputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  access: 'instructions',
  chat: { expose: true, tier: 'ask-every-time' },
  chatDescription: 'Replace the custom instructions of a project, or clear them '
    + 'with null. The old text is not kept.',
  summarize: (input: UpdateInstructionsInput) => {
    const projectId = plainToken(input.projectId)

    if (input.instructions === null) {
      return `Clear the instructions of project ${projectId}`
    }

    return `Replace the instructions of project ${projectId} `
      + `(${input.instructions.length} characters)`
  },
  handler: async (input: UpdateInstructionsInput, context) => {
    const result = await updateMcpProjectInstructions(
      context.db,
      context.userId,
      input,
    )

    context.log({
      project_id: input.projectId,
      has_instructions: result.instructions !== null,
    })

    return result
  },
})
