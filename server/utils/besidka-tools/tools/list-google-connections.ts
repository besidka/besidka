import { listMcpGoogleConnections } from '~~/server/utils/mcp/private/google'
import { defineBesidkaTool } from '~~/server/utils/besidka-tools/define'

export const listGoogleConnectionsBesidkaTool = defineBesidkaTool({
  name: 'list_google_connections',
  title: 'List my Google connections',
  description: 'Show whether Google is connected to your Besidka account, '
    + 'per client mode: "besidka" (Besidka\'s own Google client) and, only '
    + 'when your account may use it, "byo" (the owner\'s own client). Each '
    + 'entry has connected, status ("active", or "needs_reauth" when you '
    + 'must connect again in the Besidka app), the granted capabilities '
    + '(for example identity, drive-picked) and connectedAt. Never returns '
    + 'the Google account\'s email or id, tokens, client ids or secrets, '
    + 'file names or any Google content. Connecting is only possible in '
    + 'the Besidka app. Requires signing in (connectors:read).',
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  access: 'read',
  chat: { expose: true, tier: 'read' },
  chatDescription: 'See whether Google is connected to your Besidka account, '
    + 'whether it must be connected again, and which capabilities are '
    + 'granted. Never returns the Google account, tokens or Google '
    + 'content. Connecting or disconnecting is only possible in the app.',
  handler: async (_input: unknown, context) => {
    const result = await listMcpGoogleConnections({
      db: context.db,
      userId: context.userId,
      logger: context.logger,
    })

    context.log({
      connection_count: result.connections.filter((connection) => {
        return connection.connected
      }).length,
    })

    return result
  },
})
