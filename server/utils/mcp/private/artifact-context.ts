import type { McpPrivateToolContext } from '~~/server/utils/mcp/private-tool'
import type { McpArtifactContext } from '~~/server/utils/mcp/private/artifacts'
import { useArtifactBlobStore } from '~~/server/utils/artifacts/blob-store'
import { resolveMcpSiteUrl } from '~~/server/utils/mcp/auth'

export function buildMcpArtifactContext(
  context: McpPrivateToolContext,
): McpArtifactContext {
  return {
    db: context.db,
    storage: useArtifactBlobStore(),
    kv: useKV(),
    userId: context.userId,
    clientId: context.clientId,
    logger: context.logger,
    siteUrl: resolveMcpSiteUrl(),
  }
}
