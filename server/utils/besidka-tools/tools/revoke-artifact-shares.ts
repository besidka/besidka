import { z } from 'zod'
import { buildMcpArtifactContext } from '~~/server/utils/mcp/private/artifact-context'
import {
  MCP_ARTIFACT_ID_MAX_CHARS,
  MCP_ARTIFACT_REVOKE_MAX_IDS,
  MCP_ARTIFACT_SHARE_ID_MAX_CHARS,
  revokeMcpArtifactShares,
} from '~~/server/utils/mcp/private/artifacts'
import { defineBesidkaTool } from '~~/server/utils/besidka-tools/define'
import { pluralize, listTokens } from '~~/server/utils/besidka-tools/summary'

const inputSchema = {
  shareIds: z
    .array(z.string().trim().min(1).max(MCP_ARTIFACT_SHARE_ID_MAX_CHARS))
    .min(1)
    .max(MCP_ARTIFACT_REVOKE_MAX_IDS)
    .optional()
    .describe('Share ids from list_artifact_shares, 1 to '
      + `${MCP_ARTIFACT_REVOKE_MAX_IDS}. Send this or artifactIds, not both`),
  artifactIds: z
    .array(z.string().trim().min(1).max(MCP_ARTIFACT_ID_MAX_CHARS))
    .min(1)
    .max(MCP_ARTIFACT_REVOKE_MAX_IDS)
    .optional()
    .describe('Artifact ids whose every link is revoked, 1 to '
      + `${MCP_ARTIFACT_REVOKE_MAX_IDS}. Send this or shareIds, not both`),
}

type RevokeArtifactSharesInput = z.infer<z.ZodObject<typeof inputSchema>>

export const revokeArtifactSharesBesidkaTool = defineBesidkaTool({
  name: 'revoke_artifact_shares',
  title: 'Stop sharing artifacts',
  description: 'Revoke public artifact links, either by share id or every '
    + 'link of the artifacts you name, so the links stop working at once. '
    + 'The artifacts stay. Reports how many links were revoked and which '
    + 'ids were not yours or not found; copies others already made cannot '
    + 'be recalled. Requires signing in (artifacts:write).',
  inputSchema,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  access: 'write',
  chat: { expose: true, tier: 'ask-every-time' },
  chatDescription: 'Revoke public artifact links by share id, or every link of the '
    + 'artifacts you name, so they stop working at once. Copies '
    + 'others made cannot be recalled.',
  summarize: (input: RevokeArtifactSharesInput) => {
    const phrases: string[] = []

    if (input.shareIds) {
      phrases.push(
        `${pluralize(input.shareIds.length, 'public link')}: `
        + listTokens(input.shareIds),
      )
    }

    if (input.artifactIds) {
      phrases.push(
        `every public link of ${pluralize(input.artifactIds.length, 'artifact')}: `
        + listTokens(input.artifactIds),
      )
    }

    if (phrases.length === 0) {
      return 'Revoke public artifact links'
    }

    return `Revoke ${phrases.join(' and ')}`
  },
  handler: async (input: RevokeArtifactSharesInput, context) => {
    const result = await revokeMcpArtifactShares(
      buildMcpArtifactContext(context),
      input,
    )

    context.log({
      requested_count: (input.shareIds ?? input.artifactIds ?? []).length,
      revoked_count: result.revoked,
      not_found_count: result.notFound.length,
    })

    return result
  },
})
