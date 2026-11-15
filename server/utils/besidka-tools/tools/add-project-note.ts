import { z } from 'zod'
import { KNOWLEDGE_LIMITS } from '#shared/utils/project-knowledge-policy'
import { addMcpProjectNote } from '~~/server/utils/mcp/private/projects'
import { defineBesidkaTool } from '~~/server/utils/besidka-tools/define'
import { quoteText, plainToken } from '~~/server/utils/besidka-tools/summary'

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

export const addProjectNoteBesidkaTool = defineBesidkaTool({
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
  access: 'instructions',
  chat: { expose: true, tier: 'ask-every-time' },
  chatDescription: 'Add a note to the knowledge of a project so its chats can use '
    + 'it.',
  summarize: (input: AddNoteInput) => {
    return `Add the note ${quoteText(input.title)} `
      + `(${input.body.length} characters) to project `
      + plainToken(input.projectId)
  },
  handler: async (input: AddNoteInput, context) => {
    const item = await addMcpProjectNote(
      context.db,
      context.userId,
      input,
      context.logger,
    )

    context.log({ project_id: input.projectId, item_id: item.id })

    return item
  },
})
