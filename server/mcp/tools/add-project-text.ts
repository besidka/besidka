import { z } from 'zod'
import { KNOWLEDGE_LIMITS } from '#shared/utils/project-knowledge-policy'
import {
  MCP_KNOWLEDGE_TEXT_MAX_CHARS,
  addMcpProjectText,
} from '~~/server/utils/mcp/private/projects'
import { withMcpPrivateTool } from '~~/server/utils/mcp/private-tool'

const inputSchema = {
  projectId: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .describe('Project id from list_projects'),
  name: z
    .string()
    .trim()
    .min(1)
    .max(KNOWLEDGE_LIMITS.maxTitleChars)
    .describe('File name or title, for example notes.md'),
  text: z
    .string()
    .min(1)
    .max(MCP_KNOWLEDGE_TEXT_MAX_CHARS)
    .describe('Plain text or markdown, up to about 200000 characters'),
}

type AddTextInput = z.infer<z.ZodObject<typeof inputSchema>>

export default defineMcpTool({
  name: 'add_project_text',
  title: 'Add text to a project',
  description: 'Add plain text or markdown as a file item to the knowledge '
    + 'of one of your Besidka projects. Text only: no PDF, ZIP or other '
    + 'binary files. Text identical to an existing item is refused. '
    + 'Requires signing in (projects:write).',
  inputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  handler: withMcpPrivateTool(
    'add_project_text',
    async (input: AddTextInput, context) => {
      const item = await addMcpProjectText(
        context.db,
        context.userId,
        input,
        context.logger,
      )

      context.log({
        project_id: input.projectId,
        item_id: item.id,
        text_bytes: item.textBytes,
      })

      return item
    },
  ),
})
