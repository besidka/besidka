import type { LoggerLike } from '~~/server/utils/files/logger'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'
import { resolveMcpSiteUrl } from '~~/server/utils/mcp/auth'
import {
  assertMcpToolAuthorized,
  enforceMcpToolRateLimit,
  requireMcpLegalConsent,
} from '~~/server/utils/mcp/private-access'
import { toJsonToolResult } from '~~/server/utils/mcp/result'
import { withSafeToolErrors } from '~~/server/utils/mcp/safe-tool'
import type { McpPrivateToolName } from '~~/server/utils/mcp/tool-scopes'
import { isMcpWriteTool } from '~~/server/utils/mcp/tool-scopes'

export type McpLogValue = string | number | boolean

export interface McpPrivateToolContext {
  userId: number
  clientId: string
  db: ReturnType<typeof useDb>
  logger: LoggerLike
  log: (fields: Record<string, McpLogValue>) => void
}

/**
 * Wraps a private MCP tool: the token and scope the request guard verified,
 * the per-user call limits, the legal-consent gate, id-only logging under
 * the toolkit's `mcp` wide-event key, compact JSON output and the
 * safe-error wrapper. Content is never logged.
 */
export function withMcpPrivateTool<Args>(
  toolName: McpPrivateToolName,
  handler: (args: Args, context: McpPrivateToolContext) => Promise<unknown>,
) {
  return withSafeToolErrors(async (args: Args) => {
    const event = useEvent()
    const logger = useRequestLogger(event)
    const auth = assertMcpToolAuthorized(event.context.mcpAuth, toolName)
    const log = (fields: Record<string, McpLogValue>) => {
      logger.set({ mcp: fields })
    }

    log({
      user_id: auth.userId,
      client_id: auth.clientId,
      tool_kind: isMcpWriteTool(toolName) ? 'write' : 'read',
    })

    await enforceMcpToolRateLimit(auth.userId, toolName)

    const db = useDb()

    await requireMcpLegalConsent(auth.userId, resolveMcpSiteUrl(), db)

    const result = await handler(args, {
      userId: auth.userId,
      clientId: auth.clientId,
      db,
      logger,
      log,
    })

    return toJsonToolResult(result)
  }, toolName)
}
