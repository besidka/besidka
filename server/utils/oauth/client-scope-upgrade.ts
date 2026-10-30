import { MCP_OAUTH_SCOPES } from '#shared/utils/mcp-oauth-scopes'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import { parseStoredOAuthScopes } from '~~/server/utils/oauth/stored-scopes'

export const OAUTH_AUTHORIZE_PATH = '/oauth2/authorize'

const OAUTH_CLIENT_MODEL = 'oauthClient'

interface ClientScopeStore {
  findOne: (input: {
    model: string
    where: { field: string, value: string }[]
  }) => Promise<unknown>
  update: (input: {
    model: string
    where: { field: string, value: string }[]
    update: Record<string, unknown>
  }) => Promise<unknown>
}

interface ClientScopeLogger {
  set: (data: Record<string, unknown>) => void
}

function readStoredScopes(stored: unknown): string[] | null {
  const scopes = parseStoredOAuthScopes(stored)

  return scopes.length > 0 ? scopes : null
}

/**
 * Dynamic client registration snapshots the scope list into the client row,
 * and the provider validates every authorize and token request against that
 * snapshot. Returns the full current list when the snapshot is a strict
 * subset of it, and null when there is nothing to upgrade or the snapshot
 * holds anything Besidka does not define.
 */
export function upgradeClientScopes(stored: unknown): string[] | null {
  const storedScopes = readStoredScopes(stored)

  if (!storedScopes) {
    return null
  }

  const currentScopes = new Set<string>(MCP_OAUTH_SCOPES)
  const hasForeignScope = storedScopes.some((scope) => {
    return !currentScopes.has(scope)
  })

  if (hasForeignScope) {
    return null
  }

  const hasEveryCurrentScope = new Set(storedScopes).size
    === currentScopes.size

  return hasEveryCurrentScope ? null : [...MCP_OAUTH_SCOPES]
}

/**
 * Never throws and never blocks the authorize request: a failed upgrade
 * leaves the client on its old snapshot and is recorded on the request log.
 */
export async function refreshStaleClientScopes(
  clientId: string,
  store: ClientScopeStore,
  logger: ClientScopeLogger,
): Promise<void> {
  try {
    const where = [{ field: 'clientId', value: clientId }]
    const client = await store.findOne({ model: OAUTH_CLIENT_MODEL, where })
    const storedScopes = readStoredScopes(
      (client as { scopes?: unknown } | null)?.scopes,
    )
    const upgradedScopes = upgradeClientScopes(storedScopes)

    if (!upgradedScopes) {
      return
    }

    await store.update({
      model: OAUTH_CLIENT_MODEL,
      where,
      update: { scopes: upgradedScopes },
    })

    logger.set({
      attributes: {
        oauth_client_scope_upgrade: true,
        oauth_client_scope_upgrade_added: upgradedScopes.length
          - new Set(storedScopes).size,
      },
    })
  } catch (exception) {
    logger.set({
      attributes: {
        oauth_client_scope_upgrade_error: exceptionMessage(exception),
      },
    })
  }
}
