import type { McpSetFeatureAccessInput } from '~~/server/utils/mcp/private/features'
import {
  mcpSetFeatureAccessShape,
  setMcpFeatureAccess,
} from '~~/server/utils/mcp/private/features'
import { withMcpPrivateTool } from '~~/server/utils/mcp/private-tool'

export default defineMcpTool({
  name: 'set_feature_access',
  title: 'Give or remove a feature for one user (admin)',
  description: 'Give one user an experimental feature (allow), keep it off '
    + 'for them (deny) or remove their grant (clear). Identify the user by '
    + 'numeric userId or exact email; the result shows only the user id. '
    + 'Changes one user at a time and is written to the audit log. It cannot '
    + 'change a rollout, a rule or the kill switch, and it cannot opt anyone '
    + 'in to a feature that spends their API keys. Admins only. Requires '
    + 'signing in (admin:features).',
  inputSchema: mcpSetFeatureAccessShape,
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: withMcpPrivateTool(
    'set_feature_access',
    async (input: McpSetFeatureAccessInput, context) => {
      const result = await setMcpFeatureAccess(
        {
          db: context.db,
          kv: useKV(),
          userId: context.userId,
          clientId: context.clientId,
          logger: context.logger,
        },
        input,
      )

      context.log({
        feature_access: result.access,
        feature_changed: result.changed,
      })

      return result
    },
  ),
})
