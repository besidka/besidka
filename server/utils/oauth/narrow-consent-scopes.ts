import {
  MCP_IDENTITY_SCOPES,
  MCP_OAUTH_SCOPES,
  MCP_RESOURCE_SCOPES,
} from '#shared/utils/mcp-oauth-scopes'

export const SCOPE_ADDITION_REFUSAL = 'To give this app more permissions, '
  + 'reconnect it from the app; its approval screen will show the new '
  + 'options.'

const resourceScopeSet = new Set<string>(MCP_RESOURCE_SCOPES)
const identityScopeSet = new Set<string>(MCP_IDENTITY_SCOPES)
const canonicalScopeOrder = new Map<string, number>(
  MCP_OAUTH_SCOPES.map((scope, index) => {
    return [scope, index]
  }),
)

export type NarrowConsentScopesResult
  = | { status: 'ok', scopes: string[], removedScopes: string[] }
    | { status: 'unknown', scopes: string[] }
    | { status: 'addition', scopes: string[] }
    | { status: 'empty' }

function sortScopes(scopes: string[]): string[] {
  return [...scopes].sort((first, second) => {
    return (canonicalScopeOrder.get(first) ?? MCP_OAUTH_SCOPES.length)
      - (canonicalScopeOrder.get(second) ?? MCP_OAUTH_SCOPES.length)
  })
}

/**
 * Works out the consent a user's "keep these permissions" request leaves
 * behind. It can only remove: every scope that is not a resource scope
 * (identity scopes) stays, and a requested resource scope the consent does
 * not already hold is an addition, refused here because widening has to go
 * through the OAuth flow. Identity scopes in the request are ignored, since
 * they cannot be removed. A request that would leave the consent with no
 * scope at all is `empty`: an empty list reads as a legacy row and stops
 * narrowing, so it is never written.
 */
export function narrowConsentScopes(
  currentScopes: readonly string[],
  keptScopes: readonly string[],
): NarrowConsentScopesResult {
  const requestedResourceScopes = [...new Set(keptScopes)].filter((scope) => {
    return !identityScopeSet.has(scope)
  })
  const unknownScopes = requestedResourceScopes.filter((scope) => {
    return !resourceScopeSet.has(scope)
  })

  if (unknownScopes.length > 0) {
    return { status: 'unknown', scopes: unknownScopes }
  }

  const currentScopeSet = new Set(currentScopes)
  const addedScopes = requestedResourceScopes.filter((scope) => {
    return !currentScopeSet.has(scope)
  })

  if (addedScopes.length > 0) {
    return { status: 'addition', scopes: addedScopes }
  }

  const requestedScopeSet = new Set(requestedResourceScopes)
  const nextScopes = sortScopes(currentScopes.filter((scope) => {
    return !resourceScopeSet.has(scope) || requestedScopeSet.has(scope)
  }))

  if (nextScopes.length === 0) {
    return { status: 'empty' }
  }

  const nextScopeSet = new Set(nextScopes)

  return {
    status: 'ok',
    scopes: nextScopes,
    removedScopes: currentScopes.filter((scope) => {
      return !nextScopeSet.has(scope)
    }),
  }
}
