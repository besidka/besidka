import { listMyFeatures } from '~~/server/utils/mcp/private/features'
import { withMcpPrivateTool } from '~~/server/utils/mcp/private-tool'

export default defineMcpTool({
  name: 'list_my_features',
  title: 'List my experimental features',
  description: 'List the experimental Besidka features your account can '
    + 'see, with whether you have access (enabled), whether you are opted '
    + 'in, whether the feature is active and any A/B variant. Opting in '
    + 'authorises spending your API keys, so it is only possible on the '
    + 'Labs page, never through MCP. Requires signing in (settings:read).',
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: withMcpPrivateTool(
    'list_my_features',
    async (_input: unknown, context) => {
      const kv = useKV()
      const result = await listMyFeatures(
        context.db,
        kv,
        context.userId,
        context.logger,
      )

      context.log({ feature_count: result.features.length })

      return result
    },
  ),
})
