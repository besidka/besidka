import { z } from 'zod'
import {
  ARTIFACT_MAX_VERSIONS,
  ARTIFACT_TITLE_MAX,
} from '#shared/utils/artifacts'
import { buildMcpArtifactContext } from '~~/server/utils/mcp/private/artifact-context'
import {
  MCP_ARTIFACT_CONTENT_MAX_CHARS,
  MCP_ARTIFACT_EDITS_MAX,
  MCP_ARTIFACT_ID_MAX_CHARS,
  updateMcpArtifact,
} from '~~/server/utils/mcp/private/artifacts'
import { withMcpPrivateTool } from '~~/server/utils/mcp/private-tool'

const inputSchema = {
  id: z
    .string()
    .trim()
    .min(1)
    .max(MCP_ARTIFACT_ID_MAX_CHARS)
    .describe('Artifact id from list_artifacts or create_artifact'),
  title: z
    .string()
    .trim()
    .min(1)
    .max(ARTIFACT_TITLE_MAX)
    .optional()
    .describe('A new title for the artifact'),
  content: z
    .string()
    .min(1)
    .max(MCP_ARTIFACT_CONTENT_MAX_CHARS)
    .optional()
    .describe('The full new content, up to '
      + `${MCP_ARTIFACT_CONTENT_MAX_CHARS} characters. Send this or edits, `
      + 'not both'),
  edits: z
    .array(z.object({
      old_string: z
        .string()
        .min(1)
        .max(MCP_ARTIFACT_CONTENT_MAX_CHARS),
      new_string: z
        .string()
        .max(MCP_ARTIFACT_CONTENT_MAX_CHARS),
    }))
    .min(1)
    .max(MCP_ARTIFACT_EDITS_MAX)
    .optional()
    .describe('Exact find-and-replace pairs applied in order to the latest '
      + 'version; each old_string must occur exactly once. Send this or '
      + 'content, not both'),
}

type UpdateArtifactInput = z.infer<z.ZodObject<typeof inputSchema>>

export default defineMcpTool({
  name: 'update_artifact',
  title: 'Update an artifact',
  description: 'Write a new version of one of your Besidka artifacts, from '
    + 'either `edits` (find-and-replace pairs; each old_string must occur '
    + 'exactly once, otherwise the call fails naming the edit and nothing is '
    + 'saved) or the full `content`, never both; `title` is optional. Older '
    + `versions are kept, up to ${ARTIFACT_MAX_VERSIONS} per artifact, and `
    + 'a change computed from an older version than the latest is refused. '
    + 'Public links that follow the latest version show the new one at '
    + 'once. Requires signing in (artifacts:write).',
  inputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  handler: withMcpPrivateTool(
    'update_artifact',
    async (input: UpdateArtifactInput, context) => {
      const result = await updateMcpArtifact(
        buildMcpArtifactContext(context),
        input,
      )

      context.log({
        artifact_id: result.id,
        artifact_version: result.version,
        edit_count: input.edits?.length ?? 0,
      })

      return result
    },
  ),
})
