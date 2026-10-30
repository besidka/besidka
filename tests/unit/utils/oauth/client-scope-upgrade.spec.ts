import { describe, expect, it, vi } from 'vitest'
import { MCP_OAUTH_SCOPES } from '#shared/utils/mcp-oauth-scopes'
import {
  OAUTH_AUTHORIZE_PATH,
  refreshStaleClientScopes,
  upgradeClientScopes,
} from '~~/server/utils/oauth/client-scope-upgrade'

const LEGACY_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'chats:read',
  'projects:read',
  'memory:read',
  'projects:write',
  'memory:write',
]

describe('upgradeClientScopes', () => {
  it('returns the full current list for a strict subset', () => {
    expect(upgradeClientScopes(LEGACY_SCOPES)).toEqual([...MCP_OAUTH_SCOPES])
  })

  it('upgrades a minimal identity-only snapshot', () => {
    expect(upgradeClientScopes(['openid'])).toEqual([...MCP_OAUTH_SCOPES])
  })

  it('is insensitive to the stored order', () => {
    expect(upgradeClientScopes([...LEGACY_SCOPES].reverse()))
      .toEqual([...MCP_OAUTH_SCOPES])
  })

  it('reads a JSON text snapshot', () => {
    expect(upgradeClientScopes(JSON.stringify(LEGACY_SCOPES)))
      .toEqual([...MCP_OAUTH_SCOPES])
  })

  it('reads a double-encoded JSON text snapshot', () => {
    expect(upgradeClientScopes(JSON.stringify(JSON.stringify(LEGACY_SCOPES))))
      .toEqual([...MCP_OAUTH_SCOPES])
  })

  it('returns a fresh array on every call', () => {
    const first = upgradeClientScopes(LEGACY_SCOPES)

    first?.push('mutated')

    expect(upgradeClientScopes(LEGACY_SCOPES)).toEqual([...MCP_OAUTH_SCOPES])
  })

  it('leaves a snapshot that already equals the current list', () => {
    expect(upgradeClientScopes([...MCP_OAUTH_SCOPES])).toBeNull()
  })

  it('leaves an equal snapshot stored in another order', () => {
    expect(upgradeClientScopes([...MCP_OAUTH_SCOPES].reverse())).toBeNull()
  })

  it('leaves a snapshot with a scope Besidka does not define', () => {
    expect(upgradeClientScopes([...LEGACY_SCOPES, 'admin'])).toBeNull()
    expect(upgradeClientScopes(['openid', 'admin'])).toBeNull()
  })

  it('leaves a superset of the current list', () => {
    expect(upgradeClientScopes([...MCP_OAUTH_SCOPES, 'admin'])).toBeNull()
  })

  it('leaves null, undefined and empty snapshots', () => {
    expect(upgradeClientScopes(null)).toBeNull()
    expect(upgradeClientScopes(undefined)).toBeNull()
    expect(upgradeClientScopes([])).toBeNull()
    expect(upgradeClientScopes('[]')).toBeNull()
  })

  it('leaves invalid JSON and wrong shapes', () => {
    expect(upgradeClientScopes('not json')).toBeNull()
    expect(upgradeClientScopes('{"scopes":["openid"]}')).toBeNull()
    expect(upgradeClientScopes(42)).toBeNull()
    expect(upgradeClientScopes({ openid: true })).toBeNull()
  })

  it('reads a space-separated snapshot and ignores non-text entries', () => {
    expect(upgradeClientScopes('openid profile'))
      .toEqual([...MCP_OAUTH_SCOPES])
    expect(upgradeClientScopes(['openid', 7]))
      .toEqual([...MCP_OAUTH_SCOPES])
  })
})

describe('refreshStaleClientScopes', () => {
  function createStore(client: unknown) {
    return {
      findOne: vi.fn(async () => client),
      update: vi.fn(async () => client),
    }
  }

  function createLogger() {
    return { set: vi.fn() }
  }

  it('rewrites the stored scopes of a stale client', async () => {
    const store = createStore({ scopes: LEGACY_SCOPES })
    const logger = createLogger()

    await refreshStaleClientScopes('client-1', store, logger)

    expect(store.findOne).toHaveBeenCalledWith({
      model: 'oauthClient',
      where: [{ field: 'clientId', value: 'client-1' }],
    })
    expect(store.update).toHaveBeenCalledTimes(1)
    expect(store.update).toHaveBeenCalledWith({
      model: 'oauthClient',
      where: [{ field: 'clientId', value: 'client-1' }],
      update: { scopes: [...MCP_OAUTH_SCOPES] },
    })
    expect(logger.set).toHaveBeenCalledWith({
      attributes: {
        oauth_client_scope_upgrade: true,
        oauth_client_scope_upgrade_added: MCP_OAUTH_SCOPES.length
          - LEGACY_SCOPES.length,
      },
    })
  })

  it('does not write when the client is current', async () => {
    const store = createStore({ scopes: [...MCP_OAUTH_SCOPES] })
    const logger = createLogger()

    await refreshStaleClientScopes('client-1', store, logger)

    expect(store.update).not.toHaveBeenCalled()
    expect(logger.set).not.toHaveBeenCalled()
  })

  it('does not write for an unknown client or a null snapshot', async () => {
    const missing = createStore(null)
    const nullScopes = createStore({ scopes: null })

    await refreshStaleClientScopes('client-1', missing, createLogger())
    await refreshStaleClientScopes('client-1', nullScopes, createLogger())

    expect(missing.update).not.toHaveBeenCalled()
    expect(nullScopes.update).not.toHaveBeenCalled()
  })

  it('does not write for a snapshot with a foreign scope', async () => {
    const store = createStore({ scopes: [...LEGACY_SCOPES, 'admin'] })

    await refreshStaleClientScopes('client-1', store, createLogger())

    expect(store.update).not.toHaveBeenCalled()
  })

  it('swallows a lookup failure and logs it', async () => {
    const store = {
      findOne: vi.fn(async () => {
        throw new Error('D1 unavailable')
      }),
      update: vi.fn(),
    }
    const logger = createLogger()

    await expect(refreshStaleClientScopes('client-1', store, logger))
      .resolves.toBeUndefined()

    expect(store.update).not.toHaveBeenCalled()
    expect(logger.set).toHaveBeenCalledWith({
      attributes: {
        oauth_client_scope_upgrade_error: 'D1 unavailable',
      },
    })
  })

  it('swallows an update failure and logs it', async () => {
    const store = {
      findOne: vi.fn(async () => ({ scopes: LEGACY_SCOPES })),
      update: vi.fn(async () => {
        throw new Error('write failed')
      }),
    }
    const logger = createLogger()

    await expect(refreshStaleClientScopes('client-1', store, logger))
      .resolves.toBeUndefined()

    expect(logger.set).toHaveBeenCalledWith({
      attributes: {
        oauth_client_scope_upgrade_error: 'write failed',
      },
    })
  })
})

describe('OAUTH_AUTHORIZE_PATH', () => {
  it('is the Better Auth authorize endpoint', () => {
    expect(OAUTH_AUTHORIZE_PATH).toBe('/oauth2/authorize')
  })
})
