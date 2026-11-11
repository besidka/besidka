import { z } from 'zod'
import { ARTIFACT_MAX_VERSIONS } from '#shared/utils/artifacts'
import { buildMcpArtifactContext } from '~~/server/utils/mcp/private/artifact-context'
import {
  MCP_ARTIFACT_ID_MAX_CHARS,
  getMcpArtifact,
} from '~~/server/utils/mcp/private/artifacts'
import { withMcpPrivateTool } from '~~/server/utils/mcp/private-tool'

const inputSchema = {
  id: z
    .string()
    .trim()
    .min(1)
    .max(MCP_ARTIFACT_ID_MAX_CHARS)
    .describe('Artifact id from list_artifacts'),
  version: z
    .number()
    .int()
    .min(1)
    .max(ARTIFACT_MAX_VERSIONS)
    .optional()
    .describe('A version number from the versions list; default the latest'),
}

type GetArtifactInput = z.infer<z.ZodObject<typeof inputSchema>>

export default defineMcpTool({
  name: 'get_artifact',
  title: 'Read an artifact',
  description: 'Read the full content of one version of a Besidka artifact '
    + '(the latest by default, up to 512 KB) together with its title, kind '
    + 'and the list of version numbers. An artifact taken down after a '
    + 'report is refused. Requires signing in (artifacts:read).',
  inputSchema,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: withMcpPrivateTool(
    'get_artifact',
    async (input: GetArtifactInput, context) => {
      const result = await getMcpArtifact(
        buildMcpArtifactContext(context),
        input,
      )

      context.log({
        artifact_id: result.id,
        artifact_version: result.version,
        text_bytes: new TextEncoder().encode(result.content).byteLength,
      })

      return result
    },
  ),
})
