import type { McpListFeatureAccessInput } from '~~/server/utils/mcp/private/features'
import {
  listMcpFeatureAccess,
  mcpListFeatureAccessShape,
} from '~~/server/utils/mcp/private/features'
import { withMcpPrivateTool } from '~~/server/utils/mcp/private-tool'

export default defineMcpTool({
  name: 'list_feature_access',
  title: 'List feature grants (admin)',
  description: 'List per-user feature grants, newest first, at most 100: '
    + 'filter by flag, by user id or by exact account email. Users appear '
    + 'only as numeric ids, never with an email, a name or the grant reason. '
    + 'With a user filter the result also lists that user\'s roles. Admins '
    + 'only. Requires signing in (admin:features).',
  inputSchema: mcpListFeatureAccessShape,
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: withMcpPrivateTool(
    'list_feature_access',
    async (input: McpListFeatureAccessInput, context) => {
      const result = await listMcpFeatureAccess(
        {
          db: context.db,
          kv: useKV(),
          userId: context.userId,
          clientId: context.clientId,
          logger: context.logger,
        },
        input,
      )

      context.log({ grant_count: result.grants.length })

      return result
    },
  ),
})
