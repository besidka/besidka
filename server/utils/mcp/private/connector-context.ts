import type { McpPrivateToolContext } from '~~/server/utils/mcp/private-tool'
import type { McpConnectorContext } from '~~/server/utils/mcp/private/connectors'
import { resolveMcpSiteUrl } from '~~/server/utils/mcp/auth'

export function buildMcpConnectorContext(
  context: McpPrivateToolContext,
): McpConnectorContext {
  return {
    db: context.db,
    kv: useKV(),
    userId: context.userId,
    clientId: context.clientId,
    logger: context.logger,
    siteUrl: resolveMcpSiteUrl(),
  }
}
