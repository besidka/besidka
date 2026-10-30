import { z } from 'zod'
import { KNOWLEDGE_LIMITS } from '#shared/utils/project-knowledge-policy'
import { updateMcpKnowledgeItem } from '~~/server/utils/mcp/private/projects'
import { withMcpPrivateTool } from '~~/server/utils/mcp/private-tool'

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

export default defineMcpTool({
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
  handler: withMcpPrivateTool(
    'update_project_knowledge_item',
    async (input: UpdateKnowledgeItemInput, context) => {
      const item = await updateMcpKnowledgeItem(
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
