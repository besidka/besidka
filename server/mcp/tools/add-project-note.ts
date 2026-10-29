import { z } from 'zod'
import { KNOWLEDGE_LIMITS } from '#shared/utils/project-knowledge-policy'
import { addMcpProjectNote } from '~~/server/utils/mcp/private/projects'
import { withMcpPrivateTool } from '~~/server/utils/mcp/private-tool'

const inputSchema = {
  projectId: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .describe('Project id from list_projects'),
  title: z
    .string()
    .trim()
    .min(1)
    .max(KNOWLEDGE_LIMITS.maxTitleChars)
    .describe('Note title, one line'),
  body: z
    .string()
    .min(1)
    .max(KNOWLEDGE_LIMITS.maxNoteChars)
    .describe('Note text (markdown)'),
  description: z
    .string()
    .trim()
    .max(KNOWLEDGE_LIMITS.maxDescriptionChars)
    .optional()
    .describe('Optional one-line description'),
}

type AddNoteInput = z.infer<z.ZodObject<typeof inputSchema>>

export default defineMcpTool({
  name: 'add_project_note',
  title: 'Add a project note',
  description: 'Add a note to the knowledge of one of your Besidka '
    + 'projects. Chats in the project can then use it. A note identical to '
    + 'an existing item is refused. Requires signing in (projects:write).',
  inputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  handler: withMcpPrivateTool(
    'add_project_note',
    async (input: AddNoteInput, context) => {
      const item = await addMcpProjectNote(
        context.db,
        context.userId,
        input,
        context.logger,
      )

      context.log({ project_id: input.projectId, item_id: item.id })

      return item
    },
  ),
})
