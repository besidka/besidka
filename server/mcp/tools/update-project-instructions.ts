import { z } from 'zod'
import {
  MCP_PROJECT_INSTRUCTIONS_MAX_CHARS,
  updateMcpProjectInstructions,
} from '~~/server/utils/mcp/private/projects'
import { withMcpPrivateTool } from '~~/server/utils/mcp/private-tool'

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

export default defineMcpTool({
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
  handler: withMcpPrivateTool(
    'update_project_instructions',
    async (input: UpdateInstructionsInput, context) => {
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
  ),
})
