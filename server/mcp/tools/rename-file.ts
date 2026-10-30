import { z } from 'zod'
import {
  MCP_FILE_NAME_MAX_CHARS,
  renameMcpFile,
} from '~~/server/utils/mcp/private/files'
import { withMcpPrivateTool } from '~~/server/utils/mcp/private-tool'

const inputSchema = {
  fileId: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .describe('File id from list_files'),
  name: z
    .string()
    .trim()
    .min(1)
    .max(MCP_FILE_NAME_MAX_CHARS)
    .describe('The new file name, 1 to 255 characters'),
}

type RenameFileInput = z.infer<z.ZodObject<typeof inputSchema>>

export default defineMcpTool({
  name: 'rename_file',
  title: 'Rename a file',
  description: 'Change the name of one of your library files. The previous '
    + 'name is not kept. Requires signing in (files:write).',
  inputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: withMcpPrivateTool(
    'rename_file',
    async (input: RenameFileInput, context) => {
      const file = await renameMcpFile(context.db, context.userId, input)

      context.log({ file_id: file.id })

      return file
    },
  ),
})
