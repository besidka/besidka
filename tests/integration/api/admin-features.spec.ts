import { readdirSync, readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ADMIN_ROUTES_DIRECTORY = 'server/api/v1/admin'

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  assertNotCrossSiteRequest: vi.fn(),
  useDb: vi.fn(() => ({})),
  useKV: vi.fn(() => ({ delete: vi.fn() })),
  logger: { set: vi.fn() },
  routerParams: {} as Record<string, string>,
  headers: {} as Record<string, string>,
  body: {} as unknown,
  query: {} as Record<string, unknown>,
  setFeatureRule: vi.fn(),
  setFeatureGrant: vi.fn(),
  revokeFeatureGrant: vi.fn(),
  setUserRole: vi.fn(),
  revokeUserRole: vi.fn(),
  listAdminFeatures: vi.fn(),
  getAdminFeature: vi.fn(),
  listAdminFeatureGrants: vi.fn(),
  searchAdminUsers: vi.fn(),
  listAdminUserRoles: vi.fn(),
  listAdminAuditLog: vi.fn(),
  createFeatureSchedules: vi.fn(),
  cancelFeatureSchedule: vi.fn(),
  applyDueFeatureSchedules: vi.fn(),
  testHookEnabled: false,
}))

vi.mock('nuxt/server', () => ({
  defineEventHandler: (handler: unknown) => handler,
  getRouterParams: () => mocks.routerParams,
  getRequestHeader: (_event: unknown, name: string) => mocks.headers[name],
  getRequestURL: () => new URL('https://besidka.com/api/v1/admin'),
  readValidatedBody: async (
    _event: unknown,
    validate: (value: unknown) => unknown,
  ) => validate(mocks.body),
  getValidatedQuery: async (
    _event: unknown,
    validate: (value: unknown) => unknown,
  ) => validate(mocks.query),
}))

vi.mock('evlog', () => ({
  createError: (input: Record<string, unknown>) => {
    return Object.assign(new Error(String(input.message)), input)
  },
}))

vi.mock('~~/server/utils/features/guards', () => ({
  requireAdmin: mocks.requireAdmin,
}))

vi.mock('~~/server/utils/logging/request-logger', () => ({
  useRequestLogger: () => mocks.logger,
}))

vi.mock('~~/server/utils/features/admin', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('~~/server/utils/features/admin')
  >()

  return {
    ...original,
    setFeatureRule: mocks.setFeatureRule,
    setFeatureGrant: mocks.setFeatureGrant,
    revokeFeatureGrant: mocks.revokeFeatureGrant,
    setUserRole: mocks.setUserRole,
    revokeUserRole: mocks.revokeUserRole,
  }
})

vi.mock('~~/server/utils/features/schedules', () => ({
  createFeatureSchedules: mocks.createFeatureSchedules,
  cancelFeatureSchedule: mocks.cancelFeatureSchedule,
  applyDueFeatureSchedules: mocks.applyDueFeatureSchedules,
}))

vi.mock('~~/server/utils/features/schedule-test-hook', () => ({
  isFeatureScheduleTestHookEnabled: () => mocks.testHookEnabled,
}))

vi.mock('~~/server/utils/features/schedule-notify', () => ({
  createFeatureScheduleNotifier: () => vi.fn(),
}))

vi.mock('~~/server/utils/features/admin-queries', () => ({
  listAdminFeatures: mocks.listAdminFeatures,
  getAdminFeature: mocks.getAdminFeature,
  listAdminFeatureGrants: mocks.listAdminFeatureGrants,
  searchAdminUsers: mocks.searchAdminUsers,
  listAdminUserRoles: mocks.listAdminUserRoles,
  listAdminAuditLog: mocks.listAdminAuditLog,
}))

const adminContext = {
  userId: 1,
  rules: {},
  userState: null,
  config: {
    featuresDisabled: '',
    featuresHostMode: 'byok',
    featuresRolloutEnabled: false,
    adminEmails: 'owner@example.com',
    requireAdminTwoFactor: true,
  },
  isAdmin: true,
  exposures: new Set(),
}

function listAdminRouteFiles(): string[] {
  return readdirSync(ADMIN_ROUTES_DIRECTORY, { recursive: true })
    .map((entry) => {
      return String(entry).split('\\').join('/')
    })
    .filter((entry) => {
      return entry.endsWith('.ts')
    })
    .sort()
}

function createEvent() {
  return { context: {}, res: { headers: new Headers() } }
}

async function callRoute(file: string) {
  const { default: handler } = await import(
    `../../../${ADMIN_ROUTES_DIRECTORY}/${file}`
  )

  return (handler as (event: unknown) => Promise<any>)(createEvent())
}

describe('admin API routes', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('useDb', mocks.useDb)
    vi.stubGlobal('useKV', mocks.useKV)
    vi.stubGlobal('assertNotCrossSiteRequest', mocks.assertNotCrossSiteRequest)
    mocks.requireAdmin.mockResolvedValue(adminContext)
    mocks.routerParams = { flag: 'artifacts', id: '3' }
    mocks.body = {}
    mocks.query = {}
    mocks.headers = {}
    mocks.testHookEnabled = false
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('covers every documented route', () => {
    expect(listAdminRouteFiles()).toEqual([
      'audit/index.get.ts',
      'features/[flag]/grants/index.get.ts',
      'features/[flag]/grants/index.post.ts',
      'features/[flag]/index.get.ts',
      'features/[flag]/rule.patch.ts',
      'features/[flag]/schedules/[id]/cancel.post.ts',
      'features/[flag]/schedules/index.post.ts',
      'features/grants/[id]/revoke.post.ts',
      'features/index.get.ts',
      'features/schedules/apply-due.post.ts',
      'roles/[id]/revoke.post.ts',
      'roles/index.get.ts',
      'roles/index.post.ts',
      'users/search.get.ts',
    ])
  })

  it.each(listAdminRouteFiles())(
    '%s calls requireAdmin before anything else',
    (file) => {
      const source = readFileSync(`${ADMIN_ROUTES_DIRECTORY}/${file}`, 'utf-8')
      const handlerBody = source.split('defineEventHandler(async (event) => {')[1]
      const firstStatement = handlerBody?.trim().split('\n')[0]?.trim()

      expect(firstStatement).toMatch(
        /^(const adminContext = )?await requireAdmin\(event\)$/,
      )

      if (!file.includes('.get.')) {
        expect(source).toContain('createFeatureAdminWriteContext(')
      }
    },
  )

  it.each(listAdminRouteFiles())(
    '%s answers 404 to a non-admin without touching the database',
    async (file) => {
      mocks.requireAdmin.mockRejectedValue(
        Object.assign(new Error('Not found'), { status: 404 }),
      )

      await expect(callRoute(file)).rejects.toMatchObject({ status: 404 })
      expect(mocks.useDb).not.toHaveBeenCalled()
      expect(mocks.assertNotCrossSiteRequest).not.toHaveBeenCalled()
    },
  )

  it.each(listAdminRouteFiles())(
    '%s answers 401 to a signed-out caller',
    async (file) => {
      mocks.requireAdmin.mockRejectedValue(
        Object.assign(new Error('Unauthorized'), { status: 401 }),
      )

      await expect(callRoute(file)).rejects.toMatchObject({ status: 401 })
    },
  )

  it('lists the features with no-store and logs the read', async () => {
    mocks.listAdminFeatures.mockResolvedValue({
      rolloutEnabled: false,
      hostMode: 'byok',
      flags: [{ key: 'artifacts' }],
    })

    const event = createEvent()
    const { default: handler } = await import(
      '~~/server/api/v1/admin/features/index.get'
    )
    const result = await (handler as (input: unknown) => Promise<any>)(event)

    expect(result.flags).toHaveLength(1)
    expect(event.res.headers.get('Cache-Control')).toBe('private, no-store')
    expect(mocks.logger.set).toHaveBeenCalledWith({
      attributes: {
        featureAccess: {
          action: 'admin.read',
          resource: 'features',
          resultCount: 1,
        },
      },
    })
  })

  it('saves a grant through the shared writer after the cross-site check', async () => {
    mocks.body = { userId: 5, effect: 'allow', expiresInDays: 30 }
    mocks.setFeatureGrant.mockResolvedValue({
      flag: 'artifacts',
      userId: 5,
      effect: 'allow',
      variant: null,
      expiresAt: new Date('2026-12-08T00:00:00.000Z'),
      reason: null,
    })

    const result = await callRoute('features/[flag]/grants/index.post.ts')

    expect(mocks.assertNotCrossSiteRequest).toHaveBeenCalled()
    expect(mocks.setFeatureGrant).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: { userId: 1, kind: 'ui' },
        rolloutEnabled: false,
      }),
      'artifacts',
      { userId: 5, effect: 'allow', expiresInDays: 30 },
    )
    expect(result.grant.expiresAt).toBe('2026-12-08T00:00:00.000Z')
  })

  it.each([
    [{ 'sec-fetch-site': 'same-site' }],
    [{ 'sec-fetch-site': 'cross-site' }],
    [{ origin: 'https://evil.besidka.com' }],
  ])('refuses a write that is not same-origin: %o', async (headers) => {
    mocks.headers = headers
    mocks.body = { userId: 5, role: 'tester' }
    mocks.assertNotCrossSiteRequest.mockImplementation(() => {})

    await expect(callRoute('roles/index.post.ts'))
      .rejects.toMatchObject({ status: 403 })
    expect(mocks.setUserRole).not.toHaveBeenCalled()
  })

  it.each([
    [{ 'sec-fetch-site': 'same-origin' }],
    [{ origin: 'https://besidka.com' }],
    [{}],
  ])('accepts a same-origin write: %o', async (headers) => {
    mocks.headers = headers
    mocks.body = { userId: 5, role: 'tester' }
    mocks.setUserRole.mockResolvedValue({ id: 1, changed: true })

    await expect(callRoute('roles/index.post.ts'))
      .resolves.toEqual({ role: { id: 1, changed: true } })
  })

  it('rejects an admin role before it reaches the writer', async () => {
    mocks.body = { userId: 5, role: 'admin' }

    await expect(callRoute('roles/index.post.ts'))
      .rejects.toMatchObject({ status: 400 })
    expect(mocks.setUserRole).not.toHaveBeenCalled()
  })

  it('rejects a rule patch with unknown keys or out-of-range basis points', async () => {
    mocks.body = { rolloutBps: 10_001 }

    await expect(callRoute('features/[flag]/rule.patch.ts'))
      .rejects.toMatchObject({ status: 400 })

    mocks.body = { salt: 'x' }

    await expect(callRoute('features/[flag]/rule.patch.ts'))
      .rejects.toMatchObject({ status: 400 })
    expect(mocks.setFeatureRule).not.toHaveBeenCalled()
  })

  it('schedules steps through the shared writer as the admin', async () => {
    mocks.body = {
      steps: [
        { runAt: '2026-12-19T10:00:00.000Z', grantRoles: ['tester'] },
        { runAt: '2026-12-26T10:00:00.000Z', rolloutBps: 2500 },
      ],
    }
    mocks.createFeatureSchedules.mockResolvedValue({
      flag: 'artifacts',
      ids: [1, 2],
    })

    const result = await callRoute('features/[flag]/schedules/index.post.ts')

    expect(mocks.assertNotCrossSiteRequest).toHaveBeenCalled()
    expect(mocks.createFeatureSchedules).toHaveBeenCalledWith(
      expect.objectContaining({ actor: { userId: 1, kind: 'ui' } }),
      'artifacts',
      mocks.body,
    )
    expect(result).toEqual({ schedule: { flag: 'artifacts', ids: [1, 2] } })
  })

  it('rejects a schedule that grants admins or has no steps', async () => {
    mocks.body = {
      steps: [{ runAt: '2026-12-19T10:00:00.000Z', grantRoles: ['admin'] }],
    }

    await expect(callRoute('features/[flag]/schedules/index.post.ts'))
      .rejects.toMatchObject({ status: 400 })

    mocks.body = { steps: [] }

    await expect(callRoute('features/[flag]/schedules/index.post.ts'))
      .rejects.toMatchObject({ status: 400 })
    expect(mocks.createFeatureSchedules).not.toHaveBeenCalled()
  })

  it('cancels one step of the flag', async () => {
    mocks.cancelFeatureSchedule.mockResolvedValue({ id: 3, flag: 'artifacts' })

    await callRoute('features/[flag]/schedules/[id]/cancel.post.ts')

    expect(mocks.cancelFeatureSchedule).toHaveBeenCalledWith(
      expect.objectContaining({ actor: { userId: 1, kind: 'ui' } }),
      'artifacts',
      3,
    )
  })

  it('keeps the apply-due test hook closed unless it is switched on', async () => {
    await expect(callRoute('features/schedules/apply-due.post.ts'))
      .rejects.toMatchObject({ status: 404 })
    expect(mocks.applyDueFeatureSchedules).not.toHaveBeenCalled()

    mocks.testHookEnabled = true
    mocks.applyDueFeatureSchedules.mockResolvedValue({ applied: 1 })

    await expect(callRoute('features/schedules/apply-due.post.ts'))
      .resolves.toEqual({ result: { applied: 1 } })
  })

  it('rejects a short user search without logging the text', async () => {
    mocks.query = { q: 'ab' }

    await expect(callRoute('users/search.get.ts'))
      .rejects.toMatchObject({ status: 400 })
    expect(mocks.searchAdminUsers).not.toHaveBeenCalled()
    expect(JSON.stringify(mocks.logger.set.mock.calls)).not.toContain('ab')
  })

  it('logs a user search by result count only', async () => {
    mocks.query = { q: 'tester-secret' }
    mocks.searchAdminUsers.mockResolvedValue([{ id: 2 }])

    await callRoute('users/search.get.ts')

    expect(JSON.stringify(mocks.logger.set.mock.calls))
      .not.toContain('tester-secret')
    expect(mocks.logger.set).toHaveBeenCalledWith({
      attributes: {
        featureAccess: {
          action: 'admin.read',
          resource: 'user_search',
          resultCount: 1,
        },
      },
    })
  })
})
