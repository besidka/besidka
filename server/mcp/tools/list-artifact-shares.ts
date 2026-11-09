import { z } from 'zod'
import { buildMcpArtifactContext } from '~~/server/utils/mcp/private/artifact-context'
import {
  MCP_ARTIFACT_ID_MAX_CHARS,
  listMcpArtifactShares,
} from '~~/server/utils/mcp/private/artifacts'
import { withMcpPrivateTool } from '~~/server/utils/mcp/private-tool'

const inputSchema = {
  id: z
    .string()
    .trim()
    .min(1)
    .max(MCP_ARTIFACT_ID_MAX_CHARS)
    .describe('Artifact id from list_artifacts'),
}

type ListArtifactSharesInput = z.infer<z.ZodObject<typeof inputSchema>>

export default defineMcpTool({
  name: 'list_artifact_shares',
  title: 'List artifact share links',
  description: 'List the active public links of one Besidka artifact: the '
    + 'status, which app created it (null when you created it in Besidka), '
    + 'the pinned version, the expiry and whether visitors may save '
    + 'progress or use AI features. Links are capabilities: anyone who has '
    + 'one can open the artifact, so the link itself (url) is returned only '
    + 'when this app was also granted artifacts:share, and is null '
    + 'otherwise. Ended links are not listed. Requires signing in '
    + '(artifacts:read).',
  inputSchema,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: withMcpPrivateTool(
    'list_artifact_shares',
    async (input: ListArtifactSharesInput, context) => {
      const result = await listMcpArtifactShares(
        buildMcpArtifactContext(context),
        input,
        { includeUrls: context.scopes.includes('artifacts:share') },
      )

      context.log({ artifact_id: input.id, result_count: result.length })

      return result
    },
  ),
})
