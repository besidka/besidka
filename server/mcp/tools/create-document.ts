import { z } from 'zod'
import { DOCUMENT_FORMATS } from '#shared/utils/documents'
import {
  MCP_DOCUMENT_TITLE_MAX_CHARS,
  buildMcpDocumentDescription,
  createMcpDocument,
} from '~~/server/utils/mcp/private/documents'
import { MCP_FILE_NAME_MAX_CHARS } from '~~/server/utils/mcp/private/files'
import { withMcpPrivateTool } from '~~/server/utils/mcp/private-tool'

const inputSchema = {
  format: z
    .enum(DOCUMENT_FORMATS)
    .describe('pdf and docx take blocks, pptx takes slides, xlsx takes sheets'),
  title: z
    .string()
    .trim()
    .min(1)
    .max(MCP_DOCUMENT_TITLE_MAX_CHARS)
    .describe('The document title, up to '
      + `${MCP_DOCUMENT_TITLE_MAX_CHARS} characters`),
  spec: z
    .looseObject({ specVersion: z.number().int().optional() })
    .describe('Besidka document spec v1 as a JSON object without format and '
      + 'title: blocks (pdf, docx), slides (pptx) or sheets (xlsx), see the '
      + 'tool description for the shapes'),
  fileName: z
    .string()
    .trim()
    .min(1)
    .max(MCP_FILE_NAME_MAX_CHARS)
    .optional()
    .describe('File name, for example report.pdf. Defaults to the title'),
  aiGenerated: z
    .boolean()
    .optional()
    .describe('Set true when an AI model wrote the content, so the file is '
      + 'marked as AI-generated'),
}

type CreateDocumentInput = z.infer<z.ZodObject<typeof inputSchema>>

export default defineMcpTool({
  name: 'create_document',
  title: 'Create a document',
  description: buildMcpDocumentDescription(),
  inputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  handler: withMcpPrivateTool(
    'create_document',
    async (input: CreateDocumentInput, context) => {
      const document = await createMcpDocument(
        {
          db: context.db,
          kv: useKV(),
          userId: context.userId,
          logger: context.logger,
        },
        input,
      )

      context.log({
        document_id: document.documentId,
        file_id: document.file.id,
        format: document.format,
        bytes: document.file.size,
      })

      return document
    },
  ),
})
