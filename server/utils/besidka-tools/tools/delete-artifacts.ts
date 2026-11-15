import { z } from 'zod'
import { buildMcpArtifactContext } from '~~/server/utils/mcp/private/artifact-context'
import {
  MCP_ARTIFACT_DELETE_MAX_IDS,
  MCP_ARTIFACT_ID_MAX_CHARS,
  deleteMcpArtifacts,
} from '~~/server/utils/mcp/private/artifacts'
import { defineBesidkaTool } from '~~/server/utils/besidka-tools/define'
import { pluralize, listTokens } from '~~/server/utils/besidka-tools/summary'

const inputSchema = {
  ids: z
    .array(z.string().trim().min(1).max(MCP_ARTIFACT_ID_MAX_CHARS))
    .min(1)
    .max(MCP_ARTIFACT_DELETE_MAX_IDS)
    .describe('Artifact ids from list_artifacts, up to '
      + `${MCP_ARTIFACT_DELETE_MAX_IDS} per call`),
  confirm: z
    .literal(true)
    .describe('Must be true: deleted artifacts cannot be restored'),
}

type DeleteArtifactsInput = z.infer<z.ZodObject<typeof inputSchema>>

export const deleteArtifactsBesidkaTool = defineBesidkaTool({
  name: 'delete_artifacts',
  title: 'Delete artifacts',
  description: 'Permanently delete Besidka artifacts with all their '
    + 'versions, their public links and the progress visitors saved in '
    + 'them. Artifacts under a legal hold are not deleted and come back in '
    + '`held`; ids that are not yours or do not exist come back in '
    + '`notFound`. Deleted artifacts cannot be restored. '
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
  chatDescription: 'Permanently delete artifacts with all versions, public links '
    + 'and the progress visitors saved. This cannot be undone.',
  summarize: (input: DeleteArtifactsInput) => {
    return `Delete ${pluralize(input.ids.length, 'artifact')} with all `
      + `versions and public links: ${listTokens(input.ids)}`
  },
  handler: async (input: DeleteArtifactsInput, context) => {
    const result = await deleteMcpArtifacts(
      buildMcpArtifactContext(context),
      input,
    )

    context.log({
      requested_count: input.ids.length,
      deleted_count: result.deleted.length,
      held_count: result.held.length,
      not_found_count: result.notFound.length,
    })

    return result
  },
})
