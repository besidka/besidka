export const MCP_IDENTITY_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
] as const

export const MCP_READ_SCOPES = [
  'chats:read',
  'projects:read',
  'memory:read',
] as const

export const MCP_WRITE_SCOPES = [
  'projects:write',
  'memory:write',
] as const

export const MCP_RESOURCE_SCOPES = [
  ...MCP_READ_SCOPES,
  ...MCP_WRITE_SCOPES,
] as const

export const MCP_OAUTH_SCOPES = [
  ...MCP_IDENTITY_SCOPES,
  ...MCP_RESOURCE_SCOPES,
] as const

export type McpResourceScope = typeof MCP_RESOURCE_SCOPES[number]

export type McpOAuthScope = typeof MCP_OAUTH_SCOPES[number]

export function isMcpWriteScope(scope: string): boolean {
  return (MCP_WRITE_SCOPES as readonly string[]).includes(scope)
}
