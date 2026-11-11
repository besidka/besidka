import { z } from 'zod'
import { ARTIFACT_KINDS } from '#shared/utils/artifacts'
import { buildMcpArtifactContext } from '~~/server/utils/mcp/private/artifact-context'
import {
  MCP_ARTIFACT_LIST_DEFAULT_LIMIT,
  MCP_ARTIFACT_LIST_MAX_LIMIT,
  MCP_ARTIFACT_QUERY_MAX_CHARS,
  listMcpArtifacts,
} from '~~/server/utils/mcp/private/artifacts'
import { withMcpPrivateTool } from '~~/server/utils/mcp/private-tool'

const inputSchema = {
  query: z
    .string()
    .trim()
    .max(MCP_ARTIFACT_QUERY_MAX_CHARS)
    .optional()
    .describe('Only artifacts whose title contains this text'),
  kind: z
    .enum(ARTIFACT_KINDS)
    .optional()
    .describe('Only artifacts of this kind'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MCP_ARTIFACT_LIST_MAX_LIMIT)
    .optional()
    .describe(`Page size, 1 to ${MCP_ARTIFACT_LIST_MAX_LIMIT}, default `
      + `${MCP_ARTIFACT_LIST_DEFAULT_LIMIT}`),
  cursor: z
    .string()
    .max(64)
    .optional()
    .describe('The nextCursor of the previous page'),
}

type ListArtifactsInput = z.infer<z.ZodObject<typeof inputSchema>>

export default defineMcpTool({
  name: 'list_artifacts',
  title: 'List artifacts',
  description: 'List your Besidka artifacts (pages, apps, diagrams and '
    + 'documents made in chats or by connected apps), most recently changed '
    + 'first, with the current version, the chat slug they came from '
    + '(null when that chat is gone) and how many public links are active. '
    + 'Use nextCursor to get the next page. Requires signing in '
    + '(artifacts:read).',
  inputSchema,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: withMcpPrivateTool(
    'list_artifacts',
    async (input: ListArtifactsInput, context) => {
      const result = await listMcpArtifacts(
        buildMcpArtifactContext(context),
        input,
      )

      context.log({ result_count: result.items.length })

      return result
    },
  ),
})
