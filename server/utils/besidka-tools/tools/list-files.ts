import { z } from 'zod'
import {
  MCP_FILE_LIST_MAX_LIMIT,
  listMcpFiles,
  mcpFileListSources,
} from '~~/server/utils/mcp/private/files'
import { defineBesidkaTool } from '~~/server/utils/besidka-tools/define'

const inputSchema = {
  source: z
    .enum(mcpFileListSources)
    .optional()
    .describe('all (default), upload, assistant (files the assistant '
      + 'generated) or project (files used as project knowledge)'),
  search: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .optional()
    .describe('Only files whose name contains this text'),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe('Number of files to skip, from nextOffset'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MCP_FILE_LIST_MAX_LIMIT)
    .optional()
    .describe(`Files to return, up to ${MCP_FILE_LIST_MAX_LIMIT}. `
      + 'Defaults to 20'),
}

type ListFilesInput = z.infer<z.ZodObject<typeof inputSchema>>

export const listFilesBesidkaTool = defineBesidkaTool({
  name: 'list_files',
  title: 'List my files',
  description: 'List the files in your Besidka library, newest first, with '
    + 'your storage usage. Each file has an id, name, media type, size in '
    + 'bytes, source and expiry. Pass nextOffset back as offset to '
    + 'continue. Files with Google content (copies of Google files, and '
    + 'files made in chats that hold Google data) are not listed. Requires '
    + 'signing in (files:read).',
  inputSchema,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  access: 'read',
  chat: { expose: true, tier: 'read' },
  chatDescription: 'List the files in your library, newest first, with your '
    + 'storage usage: id, name, media type, size, source and expiry. '
    + 'Pass nextOffset back as offset to continue. Files with Google '
    + 'content are listed only in a chat that already holds Google data.',
  handler: async (input: ListFilesInput, context) => {
    const result = await listMcpFiles(context.db, context.userId, {
      ...input,
      googleContent: context.googleContent ?? 'hidden',
    })

    context.log({
      file_source: input.source ?? 'all',
      result_count: result.files.length,
      result_total: result.total,
    })

    return result
  },
})
