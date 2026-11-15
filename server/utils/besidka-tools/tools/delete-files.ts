import { z } from 'zod'
import {
  MCP_FILE_DELETE_MAX_IDS,
  deleteMcpFiles,
} from '~~/server/utils/mcp/private/files'
import { defineBesidkaTool } from '~~/server/utils/besidka-tools/define'
import { pluralize, listTokens } from '~~/server/utils/besidka-tools/summary'

const inputSchema = {
  fileIds: z
    .array(z.string().trim().min(1).max(32))
    .min(1)
    .max(MCP_FILE_DELETE_MAX_IDS)
    .describe('File ids from list_files, up to '
      + `${MCP_FILE_DELETE_MAX_IDS} per call`),
}

type DeleteFilesInput = z.infer<z.ZodObject<typeof inputSchema>>

export const deleteFilesBesidkaTool = defineBesidkaTool({
  name: 'delete_files',
  title: 'Delete files',
  description: 'Permanently delete files from your Besidka library, '
    + 'including files that are project knowledge (their extracted text is '
    + 'removed with them). The result lists the deleted ids and the '
    + 'skipped ones with a reason: not_found, or storage_error or error (try '
    + 'again). Files are deleted one at a time, so a failure part way keeps '
    + 'the files already deleted. '
    + 'Requires signing in (data:delete).',
  inputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  access: 'delete',
  chat: { expose: true, tier: 'ask-every-time' },
  chatDescription: 'Permanently delete files from your library, including files '
    + 'that are project knowledge. This cannot be undone.',
  summarize: (input: DeleteFilesInput) => {
    return `Delete ${pluralize(input.fileIds.length, 'file')} from your `
      + `library: ${listTokens(input.fileIds)}`
  },
  handler: async (input: DeleteFilesInput, context) => {
    const result = await deleteMcpFiles(
      context.userId,
      input,
      context.logger,
    )

    context.log({
      deleted_count: result.deleted.length,
      skipped_count: result.skipped.length,
    })

    return result
  },
})
