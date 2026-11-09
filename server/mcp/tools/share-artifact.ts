import { z } from 'zod'
import { ARTIFACT_MAX_VERSIONS } from '#shared/utils/artifacts'
import { MCP_ARTIFACT_SHARE_DAILY_LIMIT } from '~~/config/mcp-server'
import { buildMcpArtifactContext } from '~~/server/utils/mcp/private/artifact-context'
import {
  MCP_ARTIFACT_ID_MAX_CHARS,
  MCP_ARTIFACT_SHARE_MAX_DAYS,
  shareMcpArtifact,
} from '~~/server/utils/mcp/private/artifacts'
import { withMcpPrivateTool } from '~~/server/utils/mcp/private-tool'

const inputSchema = {
  id: z
    .string()
    .trim()
    .min(1)
    .max(MCP_ARTIFACT_ID_MAX_CHARS)
    .describe('Artifact id from list_artifacts'),
  expiresInDays: z
    .number()
    .int()
    .min(1)
    .max(MCP_ARTIFACT_SHARE_MAX_DAYS)
    .describe('Days until the link stops working, 1 to '
      + `${MCP_ARTIFACT_SHARE_MAX_DAYS}. Required`),
  pinnedVersion: z
    .number()
    .int()
    .min(1)
    .max(ARTIFACT_MAX_VERSIONS)
    .optional()
    .describe('Show this version only; default the latest version, which '
      + 'follows later updates'),
}

type ShareArtifactInput = z.infer<z.ZodObject<typeof inputSchema>>

export default defineMcpTool({
  name: 'share_artifact',
  title: 'Publish an artifact as a public link',
  description: 'Create a public link to one of your Besidka artifacts. '
    + 'Anyone who has the link can open the artifact, no account needed, and '
    + 'can report it; copies others make cannot be recalled. The link '
    + 'expires after the days you give (at most 30), is never indexed by '
    + 'search engines, does not let visitors save progress or use AI '
    + 'features, and shows in your link list as created by this app. At '
    + `most ${MCP_ARTIFACT_SHARE_DAILY_LIMIT.max} links a day can be `
    + 'created through connected apps, and an artifact can have 10 active '
    + 'links. The result lists warnings when the shared version seems to '
    + 'contain emails, phone numbers or similar identifiers. Only share '
    + 'what the user asked to publish, and revoke a link with '
    + 'revoke_artifact_shares. Requires signing in (artifacts:share).',
  inputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  handler: withMcpPrivateTool(
    'share_artifact',
    async (input: ShareArtifactInput, context) => {
      const result = await shareMcpArtifact(
        buildMcpArtifactContext(context),
        input,
      )

      context.log({
        artifact_id: input.id,
        share_id: result.shareId,
        expires_in_days: input.expiresInDays,
        warning_count: result.warnings.length,
      })

      return result
    },
  ),
})
