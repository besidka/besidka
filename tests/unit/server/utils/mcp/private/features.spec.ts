import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isFeatureAdminUserId: vi.fn(),
  setFeatureGrant: vi.fn(),
  revokeFeatureGrant: vi.fn(),
  logFeatureAdminRead: vi.fn(),
  listAdminFeatures: vi.fn(),
  loadFeatureRules: vi.fn(),
  loadUserFeatureState: vi.fn(),
  selectResults: [] as unknown[][],
}))

vi.mock('~~/server/utils/mcp/admin-scopes', () => ({
  isFeatureAdminUserId: mocks.isFeatureAdminUserId,
}))

vi.mock('~~/server/utils/features/admin', () => ({
  setFeatureGrant: mocks.setFeatureGrant,
  revokeFeatureGrant: mocks.revokeFeatureGrant,
  logFeatureAdminRead: mocks.logFeatureAdminRead,
}))

vi.mock('~~/server/utils/features/admin-queries', () => ({
  listAdminFeatures: mocks.listAdminFeatures,
}))

vi.mock('~~/server/utils/features/evaluate', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('~~/server/utils/features/evaluate')
  >()

  return {
    ...original,
    getFeatureEvaluationConfig: () => ({
      featuresDisabled: '',
      featuresHostMode: 'byok',
      featuresRolloutEnabled: false,
      adminEmails: '',
      requireAdminTwoFactor: false,
    }),
    loadFeatureRules: mocks.loadFeatureRules,
    loadUserFeatureState: mocks.loadUserFeatureState,
  }
})

const {
  listMcpFeatureAccess,
  listMcpFeatureFlags,
  listMyFeatures,
  setMcpFeatureAccess,
} = await import('~~/server/utils/mcp/private/features')

function createQuery() {
  const result = mocks.selectResults.shift() ?? []
  const query: Record<string, unknown> = {}

  for (const method of ['from', 'where', 'orderBy', 'limit', 'leftJoin']) {
    query[method] = vi.fn(() => query)
  }

  query.then = (resolve: (value: unknown) => unknown) => resolve(result)

  return query
}

const db = { select: vi.fn(() => createQuery()) }
const logger = { set: vi.fn() }
const kv = { get: vi.fn(), put: vi.fn(), delete: vi.fn() }

function createContext() {
  return {
    db: db as never,
    kv,
    userId: 1,
    clientId: 'client-abc',
    logger,
  }
}

describe('MCP feature tools logic', () => {
  beforeEach(() => {
    mocks.selectResults = []
    mocks.isFeatureAdminUserId.mockReset().mockResolvedValue(true)
    mocks.setFeatureGrant.mockReset()
    mocks.revokeFeatureGrant.mockReset()
    mocks.logFeatureAdminRead.mockReset()
    mocks.listAdminFeatures.mockReset().mockResolvedValue({ flags: [] })
    mocks.loadFeatureRules.mockReset().mockResolvedValue({})
    mocks.loadUserFeatureState.mockReset()
    db.select.mockClear()
  })

  it('lists the caller\'s client features with access and opt-in',
    async () => {
      mocks.loadUserFeatureState.mockResolvedValue({
        userId: 5,
        email: 'u@example.com',
        emailVerified: true,
        twoFactorEnabled: false,
        roles: [],
        grants: {
          'research.custom': { effect: 'allow', variant: null },
        },
        optIns: {
          'research.custom': { optedInAt: new Date(), optedOutAt: null },
        },
      })

      const result = await listMyFeatures(db as never, kv, 5, logger)
      const research = result.features.find((feature) => {
        return feature.key === 'research.custom'
      })

      expect(research).toEqual({
        key: 'research.custom',
        title: 'Custom research',
        stage: 'internal',
        enabled: true,
        active: true,
        optedIn: true,
        variant: null,
      })
      expect(result.features.some(feature => feature.key === 'artifacts.mcp'))
        .toBe(false)
      expect(JSON.stringify(result)).not.toContain('u@example.com')
    })

  it.each([
    ['list_feature_flags', () => listMcpFeatureFlags(createContext())],
    ['list_feature_access', () => listMcpFeatureAccess(createContext(), {})],
    ['set_feature_access', () => setMcpFeatureAccess(createContext(), {
      flag: 'artifacts',
      access: 'allow',
      userId: 9,
    })],
  ])('%s answers a generic 404 to a non-admin and does nothing',
    async (_name, run) => {
      mocks.isFeatureAdminUserId.mockResolvedValue(false)

      await expect(run()).rejects.toMatchObject({
        status: 404,
        message: 'Not found',
      })
      expect(db.select).not.toHaveBeenCalled()
      expect(mocks.setFeatureGrant).not.toHaveBeenCalled()
      expect(mocks.listAdminFeatures).not.toHaveBeenCalled()
    })

  it('lists grants with user ids only, never an email or reason',
    async () => {
      mocks.selectResults = [
        [{ id: 9 }],
        [{
          id: 3,
          userId: 9,
          flag: 'artifacts',
          effect: 'allow',
          variant: null,
          expiresAt: null,
          createdAt: new Date('2026-11-01T00:00:00Z'),
        }],
        [{ role: 'tester' }],
      ]

      const result = await listMcpFeatureAccess(createContext(), {
        email: 'tester@example.com',
      })

      expect(result).toEqual({
        grants: [{
          id: 3,
          userId: 9,
          flag: 'artifacts',
          effect: 'allow',
          variant: null,
          expiresAt: null,
          createdAt: 1793491200,
        }],
        userId: 9,
        roles: ['tester'],
        limit: 100,
      })
      expect(JSON.stringify(result)).not.toMatch(/@|reason/)
      expect(mocks.logFeatureAdminRead)
        .toHaveBeenCalledWith(logger, 'mcp.grants', 1)
    })

  it('answers 404 for an unknown user email', async () => {
    mocks.selectResults = [[]]

    await expect(listMcpFeatureAccess(createContext(), {
      email: 'nobody@example.com',
    })).rejects.toMatchObject({ status: 404 })
  })

  it('rejects an unknown flag', async () => {
    await expect(setMcpFeatureAccess(createContext(), {
      flag: 'no.such.flag' as never,
      access: 'allow',
      userId: 9,
    })).rejects.toThrow()
    expect(mocks.setFeatureGrant).not.toHaveBeenCalled()
  })

  it('grants through the shared writer as an MCP actor and echoes ids only',
    async () => {
      mocks.selectResults = [[{ id: 9 }]]
      mocks.setFeatureGrant.mockResolvedValue({
        flag: 'artifacts',
        userId: 9,
        effect: 'allow',
        variant: null,
        expiresAt: new Date('2026-12-01T00:00:00Z'),
        reason: 'Asked for it, Jane Doe',
      })

      const result = await setMcpFeatureAccess(createContext(), {
        flag: 'artifacts',
        access: 'allow',
        email: 'tester@example.com',
        expiresInDays: 23,
        reason: 'Asked for it, Jane Doe',
      })

      expect(mocks.setFeatureGrant).toHaveBeenCalledWith(
        expect.objectContaining({
          actor: { userId: 1, kind: 'mcp', clientId: 'client-abc' },
          rolloutEnabled: false,
        }),
        'artifacts',
        {
          userId: 9,
          effect: 'allow',
          expiresInDays: 23,
          reason: 'Asked for it, Jane Doe',
        },
      )
      expect(result).toEqual({
        flag: 'artifacts',
        userId: 9,
        access: 'allow',
        expiresAt: '2026-12-01T00:00:00.000Z',
        changed: true,
      })
      expect(JSON.stringify(result)).not.toMatch(/Jane|@/)
    })

  it('clears an existing grant through the shared revoke', async () => {
    mocks.selectResults = [[{ id: 12 }]]

    const result = await setMcpFeatureAccess(createContext(), {
      flag: 'artifacts',
      access: 'clear',
      userId: 9,
    })

    expect(mocks.revokeFeatureGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: { userId: 1, kind: 'mcp', clientId: 'client-abc' },
      }),
      12,
    )
    expect(result).toEqual({
      flag: 'artifacts',
      userId: 9,
      access: 'clear',
      changed: true,
    })
  })

  it('reports nothing to clear without a grant', async () => {
    mocks.selectResults = [[]]

    const result = await setMcpFeatureAccess(createContext(), {
      flag: 'artifacts',
      access: 'clear',
      userId: 9,
    })

    expect(result.changed).toBe(false)
    expect(mocks.revokeFeatureGrant).not.toHaveBeenCalled()
  })

  it('refuses both a user id and an email', async () => {
    await expect(setMcpFeatureAccess(createContext(), {
      flag: 'artifacts',
      access: 'allow',
      userId: 9,
      email: 'tester@example.com',
    })).rejects.toMatchObject({ status: 400, why: 'ambiguous_user' })
  })

  it('refuses a missing user', async () => {
    await expect(setMcpFeatureAccess(createContext(), {
      flag: 'artifacts',
      access: 'allow',
    })).rejects.toMatchObject({ status: 400, why: 'missing_user' })
  })
})
