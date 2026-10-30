import { z } from 'zod'
import {
  MCP_FILE_NAME_MAX_CHARS,
  MCP_FILE_TEXT_MAX_CHARS,
  createMcpFile,
} from '~~/server/utils/mcp/private/files'
import { withMcpPrivateTool } from '~~/server/utils/mcp/private-tool'

const inputSchema = {
  name: z
    .string()
    .trim()
    .min(1)
    .max(MCP_FILE_NAME_MAX_CHARS)
    .describe('File name with its extension, for example report.md'),
  text: z
    .string()
    .min(1)
    .max(MCP_FILE_TEXT_MAX_CHARS)
    .describe('Plain text, markdown or CSV, up to '
      + `${MCP_FILE_TEXT_MAX_CHARS} characters`),
}

type CreateFileInput = z.infer<z.ZodObject<typeof inputSchema>>

export default defineMcpTool({
  name: 'create_file',
  title: 'Create a text file',
  description: 'Save text as a new file in your Besidka library and return '
    + 'its id. It counts against your storage quota and expires like an '
    + 'upload. The text is not screened for prompt injection, unlike project '
    + 'notes. To give a project the text as knowledge, use add_project_text '
    + 'instead. Requires signing in (files:write).',
  inputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  handler: withMcpPrivateTool(
    'create_file',
    async (input: CreateFileInput, context) => {
      const file = await createMcpFile(
        context.userId,
        input,
        context.logger,
      )

      context.log({ file_id: file.id, file_size: file.size })

      return file
    },
  ),
})
