import type { z } from 'zod'
import type { McpResourceScope } from '#shared/utils/mcp-oauth-scopes'
import type { BesidkaToolPermissionTier } from '#shared/utils/besidka-tool-permissions'
import type { ToolAccess } from '#shared/utils/tool-approval-policy'
import type { LoggerLike } from '~~/server/utils/files/logger'
import type { McpPrivateToolName } from '~~/server/utils/mcp/tool-scopes'

export type BesidkaToolLogValue = string | number | boolean

export type BesidkaToolAccess = ToolAccess

export type BesidkaToolTier = BesidkaToolPermissionTier

export type BesidkaToolChatExposure
  = | { expose: true, tier: BesidkaToolTier }
    | { excluded: string }

export interface BesidkaToolAnnotations {
  readOnlyHint?: boolean
  destructiveHint?: boolean
  idempotentHint?: boolean
  openWorldHint?: boolean
}

export interface BesidkaToolContext {
  userId: number
  clientId: string
  scopes: readonly string[]
  currentChatSlug?: string
  db: ReturnType<typeof useDb>
  logger: LoggerLike
  log: (fields: Record<string, BesidkaToolLogValue>) => void
}

export interface BesidkaToolDefinition {
  name: McpPrivateToolName
  title: string
  description: string
  chatDescription?: string
  inputSchema?: z.ZodRawShape
  annotations: BesidkaToolAnnotations
  access: BesidkaToolAccess
  chat: BesidkaToolChatExposure
  summarize?: (input: never) => string
  handler: (input: never, context: BesidkaToolContext) => Promise<unknown>
}

export interface BesidkaTool extends BesidkaToolDefinition {
  mcpScope: McpResourceScope
}
