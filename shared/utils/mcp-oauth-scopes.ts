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
  'files:read',
  'settings:read',
] as const

export const MCP_WRITE_SCOPES = [
  'projects:write',
  'memory:write',
  'chats:write',
  'files:write',
  'settings:write',
  'data:delete',
  'admin:features',
] as const

export const MCP_DELETE_SCOPES = ['data:delete'] as const

export const MCP_ADMIN_SCOPES = ['admin:features'] as const

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

export function isMcpDeleteScope(scope: string): boolean {
  return (MCP_DELETE_SCOPES as readonly string[]).includes(scope)
}

export function isMcpAdminScope(scope: string): boolean {
  return (MCP_ADMIN_SCOPES as readonly string[]).includes(scope)
}

/**
 * Drops the admin-only scopes from a scope list. Non-admins never see them
 * on the consent page, and the consent routes strip them on the server too.
 */
export function withoutMcpAdminScopes(scopes: readonly string[]): string[] {
  return scopes.filter((scope) => {
    return !isMcpAdminScope(scope)
  })
}

export function isMcpIdentityScope(scope: string): boolean {
  return (MCP_IDENTITY_SCOPES as readonly string[]).includes(scope)
}

/**
 * The resource scopes the consent page ticks before the user touches it:
 * every requested read scope, never a write or delete scope.
 */
export function defaultSelectedMcpScopes(requestedScopes: string[]): string[] {
  return requestedScopes.filter((scope) => {
    return !isMcpIdentityScope(scope) && !isMcpWriteScope(scope)
  })
}

/**
 * The scope string an approval grants: the requested identity scopes, which
 * are always included, plus the ticked resource scopes the app asked for.
 */
export function buildApprovedMcpScope(
  requestedScopes: string[],
  selectedScopes: string[],
): string {
  const requestedScopeSet = new Set(requestedScopes)
  const identityScopes = requestedScopes.filter((scope) => {
    return isMcpIdentityScope(scope)
  })
  const resourceScopes = selectedScopes.filter((scope) => {
    return requestedScopeSet.has(scope) && !isMcpIdentityScope(scope)
  })

  return [...new Set([...identityScopes, ...resourceScopes])].join(' ')
}
