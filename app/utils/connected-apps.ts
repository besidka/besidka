import {
  MCP_IDENTITY_SCOPES,
  MCP_RESOURCE_SCOPES,
} from '#shared/utils/mcp-oauth-scopes'

export interface ConnectedApp {
  clientId: string
  name: string
  scopes: string[]
  canEditScopes: boolean
  createdAt: string
  lastUsedAt: string | null
}

export interface ConnectedAppGroup {
  key: string
  name: string
  apps: ConnectedApp[]
  newestClientId: string
}

const identityScopeSet = new Set<string>(MCP_IDENTITY_SCOPES)
const resourceScopeSet = new Set<string>(MCP_RESOURCE_SCOPES)

function toTime(value: string | null): number {
  if (!value) {
    return Number.NEGATIVE_INFINITY
  }

  const time = new Date(value).getTime()

  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time
}

function toActivityTime(app: ConnectedApp): number {
  return Math.max(toTime(app.lastUsedAt), toTime(app.createdAt))
}

export function filterVisibleScopes(scopes: string[]): string[] {
  return scopes.filter((scope) => {
    return !identityScopeSet.has(scope)
  })
}

export function filterEditableScopes(scopes: string[]): string[] {
  return scopes.filter((scope) => {
    return resourceScopeSet.has(scope)
  })
}

export function findNewestConnection(apps: ConnectedApp[]): ConnectedApp {
  return apps.reduce((newest, app) => {
    return toActivityTime(app) > toActivityTime(newest) ? app : newest
  })
}

/**
 * Groups connections that share a name, ignoring case and surrounding
 * whitespace, in the order the groups first appear. Some apps register a new
 * OAuth client on every reconnect, so one app shows up as several
 * connections. The newest one is the most recently used; a connection that
 * was never used falls back to the time it was created.
 */
export function groupConnectedApps(apps: ConnectedApp[]): ConnectedAppGroup[] {
  const groups = new Map<string, ConnectedApp[]>()

  for (const app of apps) {
    const key = app.name.trim().toLowerCase()
    const group = groups.get(key)

    if (group) {
      group.push(app)
    } else {
      groups.set(key, [app])
    }
  }

  return [...groups.entries()].map(([key, groupApps]) => {
    const sorted = [...groupApps].sort((first, second) => {
      return toActivityTime(second) - toActivityTime(first)
    })

    return {
      key,
      name: sorted[0]!.name,
      apps: sorted,
      newestClientId: sorted[0]!.clientId,
    }
  })
}

export function listOlderConnections(group: ConnectedAppGroup): ConnectedApp[] {
  return group.apps.filter((app) => {
    return app.clientId !== group.newestClientId
  })
}
