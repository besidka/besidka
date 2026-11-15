import { z } from 'zod'
import { KNOWLEDGE_LIMITS } from '#shared/utils/project-knowledge-policy'
import { updateMcpKnowledgeItem } from '~~/server/utils/mcp/private/projects'
import { defineBesidkaTool } from '~~/server/utils/besidka-tools/define'
import {
  quoteText,
  plainToken,
  joinPhrases,
} from '~~/server/utils/besidka-tools/summary'

const inputSchema = {
  projectId: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .describe('Project id from list_projects'),
  itemId: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .describe('Knowledge item id from get_project'),
  title: z
    .string()
    .trim()
    .min(1)
    .max(KNOWLEDGE_LIMITS.maxTitleChars)
    .optional()
    .describe('New title, notes only'),
  body: z
    .string()
    .min(1)
    .max(KNOWLEDGE_LIMITS.maxNoteChars)
    .optional()
    .describe('New text (markdown), notes only'),
  description: z
    .string()
    .trim()
    .max(KNOWLEDGE_LIMITS.maxDescriptionChars)
    .nullable()
    .optional()
    .describe('One-line description, up to 100 characters. null clears it'),
  pinned: z
    .boolean()
    .optional()
    .describe('Whether chats always include this item'),
  sendAsNativePdf: z
    .boolean()
    .optional()
    .describe('Send the original PDF to the model; PDF items only'),
}

type UpdateKnowledgeItemInput = z.infer<z.ZodObject<typeof inputSchema>>

export const updateProjectKnowledgeItemBesidkaTool = defineBesidkaTool({
  name: 'update_project_knowledge_item',
  title: 'Update a project knowledge item',
  description: 'Edit one knowledge item of one of your Besidka projects. '
    + 'Notes can change title and text; every item can change its '
    + 'description, pinned state and, for PDFs, whether the original is '
    + 'sent as a PDF. The old text of a note is not kept. A changed note '
    + 'text is checked for prompt injection with your TypeSafe key only if '
    + 'you configured one, like add_project_note. Requires signing in '
    + '(projects:write).',
  inputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  access: 'write',
  chat: { expose: true, tier: 'write' },
  chatDescription: 'Edit a project knowledge item: notes can change title and '
    + 'text, every item can change its description and pinned state. '
    + 'The old note text is not kept.',
  summarize: (input: UpdateKnowledgeItemInput) => {
    const phrases: string[] = []

    if (input.title !== undefined) {
      phrases.push(`rename it to ${quoteText(input.title)}`)
    }

    if (input.body !== undefined) {
      phrases.push(`replace its text (${input.body.length} characters)`)
    }

    if (input.description !== undefined) {
      phrases.push(
        input.description === null
          ? 'clear its description'
          : 'change its description',
      )
    }

    if (input.pinned !== undefined) {
      phrases.push(input.pinned ? 'pin it' : 'unpin it')
    }

    if (input.sendAsNativePdf !== undefined) {
      phrases.push(
        input.sendAsNativePdf
          ? 'send the original PDF to the model'
          : 'stop sending the original PDF to the model',
      )
    }

    const item = `knowledge item ${plainToken(input.itemId)} of project `
      + plainToken(input.projectId)

    if (phrases.length === 0) {
      return `Edit ${item}`
    }

    return `Edit ${item}: ${joinPhrases(phrases)}`
  },
  handler: async (input: UpdateKnowledgeItemInput, context) => {
    const item = await updateMcpKnowledgeItem(
      context.db,
      context.userId,
      input,
      context.logger,
    )

    context.log({ project_id: input.projectId, item_id: item.id })

    return item
  },
})
