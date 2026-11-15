import { listMyFeatures } from '~~/server/utils/mcp/private/features'
import { defineBesidkaTool } from '~~/server/utils/besidka-tools/define'

export const listMyFeaturesBesidkaTool = defineBesidkaTool({
  name: 'list_my_features',
  title: 'List my experimental features',
  description: 'List the experimental Besidka features your account has '
    + 'access to, with whether you are opted in, whether the feature is '
    + 'active and any A/B variant. Opting in '
    + 'authorizes spending your API keys, so it is only possible on the '
    + 'Labs page, never through MCP. Requires signing in (settings:read).',
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  access: 'read',
  chat: { expose: true, tier: 'read' },
  chatDescription: 'List the experimental features your account can use, whether '
    + 'you are opted in, whether each is active and any A/B variant. '
    + 'Opting in is only possible on the Labs page.',
  handler: async (_input: unknown, context) => {
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
})
