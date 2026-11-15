import type { McpPrivateToolContext } from '~~/server/utils/mcp/private-tool'
import type { McpSkillContext } from '~~/server/utils/mcp/private/skills'
import { resolveMcpSiteUrl } from '~~/server/utils/mcp/auth'

export function buildMcpSkillContext(
  context: McpPrivateToolContext,
): McpSkillContext {
  return {
    db: context.db,
    kv: useKV(),
    bucket: useFileStorage(),
    userId: context.userId,
    clientId: context.clientId,
    logger: context.logger,
    siteUrl: resolveMcpSiteUrl(),
  }
}
