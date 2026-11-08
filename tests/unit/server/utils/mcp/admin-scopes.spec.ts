import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadUserFeatureState: vi.fn(),
  config: {
    featuresDisabled: '',
    featuresHostMode: 'byok',
    featuresRolloutEnabled: false,
    adminEmails: 'owner@example.com',
    requireAdminTwoFactor: true,
  },
}))

vi.mock('~~/server/utils/features/evaluate', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('~~/server/utils/features/evaluate')
  >()

  return {
    ...original,
    getFeatureEvaluationConfig: () => mocks.config,
    loadUserFeatureState: mocks.loadUserFeatureState,
  }
})

const {
  isFeatureAdminUserId,
  keepMcpAdminScopesForAdmins,
} = await import('~~/server/utils/mcp/admin-scopes')

const db = {} as never
const SCOPES = ['openid', 'chats:read', 'admin:features']

function userState(overrides: Record<string, unknown> = {}) {
  return {
    userId: 7,
    email: 'user@example.com',
    emailVerified: true,
    twoFactorEnabled: true,
    roles: [],
    grants: {},
    optIns: {},
    ...overrides,
  }
}

describe('MCP admin scopes', () => {
  beforeEach(() => {
    mocks.loadUserFeatureState.mockReset()
  })

  it('does not look the user up without an admin scope', async () => {
    expect(await keepMcpAdminScopesForAdmins(['chats:read'], 7, db))
      .toEqual(['chats:read'])
    expect(mocks.loadUserFeatureState).not.toHaveBeenCalled()
  })

  it.each([
    ['an ordinary user', userState()],
    ['an admin role without a verified email', userState({
      roles: ['admin'],
      emailVerified: false,
    })],
    ['an admin role without 2FA', userState({
      roles: ['admin'],
      twoFactorEnabled: false,
    })],
    ['a missing user', null],
  ])('strips admin:features for %s', async (_label, state) => {
    mocks.loadUserFeatureState.mockResolvedValue(state)

    expect(await keepMcpAdminScopesForAdmins(SCOPES, 7, db))
      .toEqual(['openid', 'chats:read'])
  })

  it.each([
    ['an admin role', userState({ roles: ['admin'] })],
    ['an env admin email', userState({ email: 'owner@example.com' })],
  ])('keeps admin:features for %s', async (_label, state) => {
    mocks.loadUserFeatureState.mockResolvedValue(state)

    expect(await keepMcpAdminScopesForAdmins(SCOPES, 7, db)).toEqual(SCOPES)
  })

  it('treats an invalid user id as not an admin', async () => {
    expect(await isFeatureAdminUserId(db, 0)).toBe(false)
    expect(await isFeatureAdminUserId(db, Number.NaN)).toBe(false)
    expect(mocks.loadUserFeatureState).not.toHaveBeenCalled()
  })
})
