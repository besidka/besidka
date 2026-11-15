import { listMcpFeatureFlags } from '~~/server/utils/mcp/private/features'
import { defineBesidkaTool } from '~~/server/utils/besidka-tools/define'

export const listFeatureFlagsBesidkaTool = defineBesidkaTool({
  name: 'list_feature_flags',
  title: 'List feature flags (admin)',
  description: 'List every Besidka feature flag with its stage, the roles '
    + 'that get it, the rule (enabled, rollout percentage, variants), the '
    + 'kill switch and grant counts. Read-only: rules, rollouts and the kill '
    + 'switch are changed only in the admin web UI. Admins only. Requires '
    + 'signing in (admin:features).',
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  access: 'read',
  chat: {
    excluded: 'Admin-only: feature access management is never offered to a '
      + 'model in chat.',
  },
  handler: async (_input: unknown, context) => {
    const result = await listMcpFeatureFlags({
      db: context.db,
      kv: useKV(),
      userId: context.userId,
      clientId: context.clientId,
      logger: context.logger,
    })

    context.log({ feature_count: result.flags.length })

    return result
  },
})
