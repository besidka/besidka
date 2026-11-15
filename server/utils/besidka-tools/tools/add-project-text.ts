import { z } from 'zod'
import { KNOWLEDGE_LIMITS } from '#shared/utils/project-knowledge-policy'
import {
  MCP_KNOWLEDGE_BATCH_MAX_ITEMS,
  MCP_KNOWLEDGE_BATCH_TEXT_MAX_CHARS,
  MCP_KNOWLEDGE_TEXT_MAX_CHARS,
  addMcpProjectTextInput,
} from '~~/server/utils/mcp/private/projects'
import { defineBesidkaTool } from '~~/server/utils/besidka-tools/define'
import {
  quoteText,
  plainToken,
  pluralize,
  joinPhrases,
} from '~~/server/utils/besidka-tools/summary'

const textItemSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(KNOWLEDGE_LIMITS.maxTitleChars)
    .describe('File name or title, for example timesheet-2026-09.csv'),
  text: z
    .string()
    .min(1)
    .max(MCP_KNOWLEDGE_TEXT_MAX_CHARS)
    .describe('Plain text, CSV or markdown of this item'),
})

const inputSchema = {
  projectId: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .describe('Project id from list_projects or create_project'),
  name: z
    .string()
    .trim()
    .min(1)
    .max(KNOWLEDGE_LIMITS.maxTitleChars)
    .optional()
    .describe('File name or title of a single item, for example '
      + 'notes.md. Use together with text, instead of items'),
  text: z
    .string()
    .min(1)
    .max(MCP_KNOWLEDGE_TEXT_MAX_CHARS)
    .optional()
    .describe('Plain text, CSV or markdown of a single item, up to '
      + `${MCP_KNOWLEDGE_TEXT_MAX_CHARS} characters. Use together with `
      + 'name, instead of items'),
  items: z
    .array(textItemSchema)
    .min(1)
    .max(MCP_KNOWLEDGE_BATCH_MAX_ITEMS)
    .optional()
    .describe(`Up to ${MCP_KNOWLEDGE_BATCH_MAX_ITEMS} items added in one `
      + 'call, for example one per month. The text of all items together '
      + `is limited to ${MCP_KNOWLEDGE_BATCH_TEXT_MAX_CHARS} characters. `
      + 'Use instead of name and text'),
}

type AddTextInput = z.infer<z.ZodObject<typeof inputSchema>>

export const addProjectTextBesidkaTool = defineBesidkaTool({
  name: 'add_project_text',
  title: 'Add text to a project',
  description: 'Add text to the knowledge of one of your Besidka '
    + 'projects, as one item (name and text) or up to '
    + `${MCP_KNOWLEDGE_BATCH_MAX_ITEMS} items in one call (items). This is `
    + 'the route for documents: send a spreadsheet as CSV or a markdown '
    + 'table, one item per sheet or per file, named after the source (for '
    + 'example timesheet-2026-09.csv); slides as markdown with one heading '
    + 'per slide; a PDF or Word document as markdown. Besidka does not '
    + 'accept the binary file itself through MCP, so read or extract the '
    + 'content first. Text identical to an existing item is refused (in a '
    + 'batch it is listed under skipped). Requires signing in '
    + '(projects:write).',
  inputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  access: 'instructions',
  chat: { expose: true, tier: 'ask-every-time' },
  chatDescription: 'Add text to the knowledge of a project, as one item (name and '
    + 'text) or up to 10 items (items).',
  summarize: (input: AddTextInput) => {
    const projectId = plainToken(input.projectId)

    if (input.items) {
      const names = input.items.map((item) => {
        return quoteText(item.name, 30)
      })

      return `Add ${pluralize(input.items.length, 'text item')} to project `
        + `${projectId}: ${joinPhrases(names)}`
    }

    if (input.name && input.text) {
      return `Add ${quoteText(input.name)} (${input.text.length} characters) `
        + `to project ${projectId}`
    }

    return `Add text to project ${projectId}`
  },
  handler: async (input: AddTextInput, context) => {
    const result = await addMcpProjectTextInput(
      context.db,
      context.userId,
      input,
      context.logger,
    )

    if ('items' in result) {
      context.log({
        project_id: input.projectId,
        item_count: result.items.length,
        skipped_count: result.skipped.length,
      })
    } else {
      context.log({
        project_id: input.projectId,
        item_id: result.id,
        text_bytes: result.textBytes,
      })
    }

    return result
  },
})
