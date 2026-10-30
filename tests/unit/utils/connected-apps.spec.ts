import { describe, expect, it } from 'vitest'
import {
  filterEditableScopes,
  filterVisibleScopes,
  findNewestConnection,
  groupConnectedApps,
  listOlderConnections,
} from '../../../app/utils/connected-apps'
import type { ConnectedApp } from '../../../app/utils/connected-apps'

function createApp(overrides: Partial<ConnectedApp> = {}): ConnectedApp {
  return {
    clientId: 'client-1',
    name: 'Claude',
    scopes: ['openid', 'chats:read'],
    canEditScopes: true,
    createdAt: '2026-10-01T00:00:00.000Z',
    lastUsedAt: null,
    ...overrides,
  }
}

describe('utils/connected-apps', () => {
  describe('groupConnectedApps', () => {
    it('groups connections by name, ignoring case and whitespace', () => {
      const groups = groupConnectedApps([
        createApp({ clientId: 'a', name: 'Claude' }),
        createApp({ clientId: 'b', name: ' claude ' }),
        createApp({ clientId: 'c', name: 'Cursor' }),
        createApp({ clientId: 'd', name: 'CLAUDE' }),
      ])

      expect(groups.map((group) => {
        return [group.key, group.apps.length]
      })).toEqual([['claude', 3], ['cursor', 1]])
    })

    it('keeps one app per group when no names match', () => {
      const groups = groupConnectedApps([
        createApp({ clientId: 'a', name: 'Claude' }),
        createApp({ clientId: 'b', name: 'Cursor' }),
      ])

      expect(groups).toHaveLength(2)
      expect(groups.every((group) => {
        return group.apps.length === 1
      })).toBe(true)
    })

    it('orders a group by last use and picks the most recent as newest', () => {
      const [group] = groupConnectedApps([
        createApp({
          clientId: 'old',
          createdAt: '2026-09-01T00:00:00.000Z',
          lastUsedAt: '2026-09-02T00:00:00.000Z',
        }),
        createApp({
          clientId: 'recent',
          createdAt: '2026-08-01T00:00:00.000Z',
          lastUsedAt: '2026-10-20T00:00:00.000Z',
        }),
        createApp({
          clientId: 'unused',
          createdAt: '2026-10-10T00:00:00.000Z',
          lastUsedAt: null,
        }),
      ])

      expect(group!.apps.map((app) => {
        return app.clientId
      })).toEqual(['recent', 'unused', 'old'])
      expect(group!.newestClientId).toBe('recent')
    })

    it('falls back to the creation time for a connection never used', () => {
      const [group] = groupConnectedApps([
        createApp({
          clientId: 'used-long-ago',
          createdAt: '2026-01-01T00:00:00.000Z',
          lastUsedAt: '2026-02-01T00:00:00.000Z',
        }),
        createApp({
          clientId: 'new-unused',
          createdAt: '2026-10-01T00:00:00.000Z',
          lastUsedAt: null,
        }),
      ])

      expect(group!.newestClientId).toBe('new-unused')
    })

    it('treats an unparseable date as the oldest', () => {
      const [group] = groupConnectedApps([
        createApp({ clientId: 'broken', createdAt: 'nope' }),
        createApp({ clientId: 'valid' }),
      ])

      expect(group!.newestClientId).toBe('valid')
    })
  })

  describe('listOlderConnections', () => {
    it('lists every connection except the newest', () => {
      const [group] = groupConnectedApps([
        createApp({ clientId: 'a', createdAt: '2026-10-01T00:00:00.000Z' }),
        createApp({ clientId: 'b', createdAt: '2026-10-03T00:00:00.000Z' }),
        createApp({ clientId: 'c', createdAt: '2026-10-02T00:00:00.000Z' }),
      ])

      expect(listOlderConnections(group!).map((app) => {
        return app.clientId
      })).toEqual(['c', 'a'])
    })

    it('lists nothing for a single connection', () => {
      const [group] = groupConnectedApps([createApp()])

      expect(listOlderConnections(group!)).toEqual([])
    })
  })

  describe('findNewestConnection', () => {
    it('returns the most recently used connection', () => {
      expect(findNewestConnection([
        createApp({ clientId: 'a', lastUsedAt: '2026-10-01T00:00:00.000Z' }),
        createApp({ clientId: 'b', lastUsedAt: '2026-10-05T00:00:00.000Z' }),
      ]).clientId).toBe('b')
    })
  })

  describe('scope filters', () => {
    it('hides identity scopes from the badges', () => {
      expect(filterVisibleScopes([
        'openid',
        'offline_access',
        'chats:read',
        'data:delete',
      ])).toEqual(['chats:read', 'data:delete'])
    })

    it('keeps only the resource scopes an editor can untick', () => {
      expect(filterEditableScopes([
        'openid',
        'chats:read',
        'admin',
        'memory:write',
      ])).toEqual(['chats:read', 'memory:write'])
    })
  })
})
