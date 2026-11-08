import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getTableName } from 'drizzle-orm'
import type { Table } from 'drizzle-orm'

const mocks = vi.hoisted(() => ({
  featureContext: vi.fn(),
  evaluateFeatureForEvent: vi.fn(),
  loadUserFeatureState: vi.fn(),
  assertNotCrossSiteRequest: vi.fn(),
  logger: { set: vi.fn() },
  routerParams: {} as Record<string, string>,
  headers: {} as Record<string, string>,
  body: {} as unknown,
  db: null as unknown,
}))

vi.mock('nuxt/server', () => ({
  defineEventHandler: (handler: unknown) => handler,
  getRouterParams: () => mocks.routerParams,
  getRequestHeader: (_event: unknown, name: string) => mocks.headers[name],
  getRequestURL: () => new URL('https://besidka.com/api/v1/profiles'),
  readValidatedBody: async (
    _event: unknown,
    validate: (value: unknown) => unknown,
  ) => validate(mocks.body),
}))

vi.mock('evlog', () => ({
  createError: (input: Record<string, unknown>) => {
    return Object.assign(new Error(String(input.message)), input)
  },
}))

vi.mock('~~/server/utils/features/context', () => ({
  useFeatureContext: mocks.featureContext,
  evaluateFeatureForEvent: mocks.evaluateFeatureForEvent,
}))

vi.mock('~~/server/utils/features/evaluate', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('~~/server/utils/features/evaluate')
  >()

  return {
    ...original,
    loadUserFeatureState: mocks.loadUserFeatureState,
  }
})

vi.mock('~~/server/utils/logging/request-logger', () => ({
  useRequestLogger: () => mocks.logger,
}))

interface RecordedInsert {
  table: unknown
  values: Record<string, unknown>
  conflictSet?: Record<string, unknown>
}

function createFakeDb(existingRows: Array<Record<string, unknown>> = []) {
  const inserts: RecordedInsert[] = []
  const db = {
    inserts,
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => existingRows,
        }),
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        const entry: RecordedInsert = { table, values }

        inserts.push(entry)

        const chain = {
          onConflictDoUpdate: (input: { set: Record<string, unknown> }) => {
            entry.conflictSet = input.set

            return chain
          },
        }

        return chain
      },
    }),
    batch: vi.fn(async (statements: unknown[]) => {
      return statements.map(() => [])
    }),
  }

  return db
}

function createUserState(overrides: Record<string, unknown> = {}) {
  return {
    userId: 7,
    email: 'user@example.com',
    emailVerified: true,
    twoFactorEnabled: false,
    roles: [],
    grants: {},
    optIns: {},
    ...overrides,
  }
}

function createFeatureContext(overrides: Record<string, unknown> = {}) {
  return {
    userId: 7,
    rules: {},
    userState: createUserState(),
    config: {
      featuresDisabled: '',
      featuresHostMode: 'byok',
      featuresRolloutEnabled: false,
      adminEmails: '',
      requireAdminTwoFactor: true,
    },
    isAdmin: false,
    exposures: new Set(),
    ...overrides,
  }
}

function createEvent() {
  return { context: {}, res: { headers: new Headers() } }
}

async function callRoute(path: string) {
  const { default: handler } = await import(
    `../../../server/api/v1/profiles/features/${path}`
  )

  return (handler as (event: unknown) => Promise<any>)(createEvent())
}

function unauthorized(): never {
  throw Object.assign(new Error('Unauthorized'), { status: 401 })
}

describe('profile features routes', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.db = createFakeDb()
    vi.stubGlobal('useDb', () => mocks.db)
    vi.stubGlobal('useUnauthorizedError', unauthorized)
    vi.stubGlobal('assertNotCrossSiteRequest', mocks.assertNotCrossSiteRequest)
    mocks.featureContext.mockReset().mockResolvedValue(createFeatureContext())
    mocks.evaluateFeatureForEvent.mockReset().mockResolvedValue({
      value: true,
      variant: null,
      reason: 'ALLOW_GRANT',
      flagMetadata: {},
      active: false,
    })
    mocks.loadUserFeatureState.mockReset().mockResolvedValue(createUserState())
    mocks.logger.set.mockReset()
    mocks.assertNotCrossSiteRequest.mockReset()
    mocks.routerParams = { flag: 'artifacts.llm-bridge' }
    mocks.headers = {}
    mocks.body = { optedIn: true }
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('GET /api/v1/profiles/features', () => {
    it('answers 401 when signed out', async () => {
      mocks.featureContext.mockResolvedValue(createFeatureContext({
        userId: null,
        userState: null,
      }))

      await expect(callRoute('index.get.ts'))
        .rejects.toMatchObject({ status: 401 })
    })

    it('lists nothing for a user without grants', async () => {
      const payload = await callRoute('index.get.ts')

      expect(payload).toEqual({ features: [], objectedToExperiments: false })
    })

    it('lists only accessible client features with their metadata',
      async () => {
        mocks.featureContext.mockResolvedValue(createFeatureContext({
          userState: createUserState({
            grants: {
              'artifacts': { effect: 'allow', variant: null },
              'artifacts.llm-bridge': { effect: 'allow', variant: null },
              'artifacts.mcp': { effect: 'allow', variant: null },
            },
            optIns: {
              'artifacts.llm-bridge': {
                optedInAt: new Date('2026-11-01T00:00:00Z'),
                optedOutAt: null,
              },
            },
          }),
        }))

        const payload = await callRoute('index.get.ts')
        const keys = payload.features.map((feature: { key: string }) => {
          return feature.key
        })

        expect(keys).toEqual(['artifacts', 'artifacts.llm-bridge'])
        expect(payload.features[1]).toMatchObject({
          key: 'artifacts.llm-bridge',
          title: 'Artifacts that call a model',
          spend: 'foreground',
          optIn: 'required',
          requires: { keyKinds: ['provider'] },
          parent: 'artifacts',
          optedIn: true,
          active: true,
        })
      })

    it('reports an objection to experiments', async () => {
      mocks.featureContext.mockResolvedValue(createFeatureContext({
        userState: createUserState({
          optIns: {
            experiments: {
              optedInAt: null,
              optedOutAt: new Date('2026-11-01T00:00:00Z'),
            },
          },
        }),
      }))

      const payload = await callRoute('index.get.ts')

      expect(payload.objectedToExperiments).toBe(true)
    })
  })

  describe('POST /api/v1/profiles/features/[flag]/opt-in', () => {
    it('answers 401 when signed out', async () => {
      mocks.featureContext.mockResolvedValue(createFeatureContext({
        userId: null,
        userState: null,
      }))

      await expect(callRoute('[flag]/opt-in.post.ts'))
        .rejects.toMatchObject({ status: 401 })
    })

    it('answers 404 without access and writes nothing', async () => {
      mocks.evaluateFeatureForEvent.mockResolvedValue({
        value: false,
        variant: null,
        reason: 'DEFAULT',
        flagMetadata: {},
        active: false,
      })

      await expect(callRoute('[flag]/opt-in.post.ts'))
        .rejects.toMatchObject({ status: 404, why: 'feature_unavailable' })
      expect(mocks.evaluateFeatureForEvent).toHaveBeenCalledWith(
        expect.anything(),
        'artifacts.llm-bridge',
        { recordExposure: false },
      )
      expect((mocks.db as ReturnType<typeof createFakeDb>).batch)
        .not.toHaveBeenCalled()
    })

    it('answers 404 for an unknown flag and the reserved experiments key',
      async () => {
        for (const flag of ['unknown.flag', 'experiments']) {
          mocks.routerParams = { flag }

          await expect(callRoute('[flag]/opt-in.post.ts'))
            .rejects.toMatchObject({ status: 404 })
        }
      })

    it('answers 404 for a flag that Labs never shows', async () => {
      mocks.routerParams = { flag: 'artifacts.mcp' }

      await expect(callRoute('[flag]/opt-in.post.ts'))
        .rejects.toMatchObject({ status: 404, why: 'feature_unavailable' })
    })

    it('answers 400 for a feature that needs no opt-in', async () => {
      mocks.routerParams = { flag: 'artifacts' }

      await expect(callRoute('[flag]/opt-in.post.ts'))
        .rejects.toMatchObject({ status: 400, why: 'opt_in_not_applicable' })
    })

    it('answers 400 for an invalid body', async () => {
      mocks.body = { optedIn: 'yes' }

      await expect(callRoute('[flag]/opt-in.post.ts'))
        .rejects.toMatchObject({ status: 400 })
    })

    it.each([
      [{ 'sec-fetch-site': 'same-site' }],
      [{ 'sec-fetch-site': 'cross-site' }],
      [{ origin: 'https://evil.example' }],
    ])('refuses a cross-origin write with %o', async (headers) => {
      mocks.headers = headers

      await expect(callRoute('[flag]/opt-in.post.ts'))
        .rejects.toMatchObject({ status: 403 })
      expect((mocks.db as ReturnType<typeof createFakeDb>).batch)
        .not.toHaveBeenCalled()
    })

    it('opts in, writes the audit row and logs the ledger line', async () => {
      mocks.loadUserFeatureState.mockResolvedValue(createUserState({
        grants: {
          'artifacts': { effect: 'allow', variant: null },
          'artifacts.llm-bridge': { effect: 'allow', variant: null },
        },
        optIns: {
          'artifacts.llm-bridge': {
            optedInAt: new Date(),
            optedOutAt: null,
          },
        },
      }))

      const result = await callRoute('[flag]/opt-in.post.ts')
      const db = mocks.db as ReturnType<typeof createFakeDb>
      const optInWrite = db.inserts.find((entry) => {
        return getTableName(entry.table as Table) === 'feature_opt_ins'
      })
      const auditWrite = db.inserts.find((entry) => {
        return getTableName(entry.table as Table) === 'feature_audit_log'
      })

      expect(result).toEqual({
        flag: 'artifacts.llm-bridge',
        optedIn: true,
        active: true,
      })
      expect(db.batch).toHaveBeenCalledTimes(1)
      expect(optInWrite?.values).toMatchObject({
        userId: 7,
        flag: 'artifacts.llm-bridge',
        optedOutAt: null,
      })
      expect(optInWrite?.values.optedInAt).toBeInstanceOf(Date)
      expect(Object.keys(optInWrite?.conflictSet ?? {})).toEqual(['optedInAt'])
      expect(auditWrite?.values).toMatchObject({
        actorUserId: 7,
        actorKind: 'ui',
        clientId: null,
        action: 'opt_in.set',
        flag: 'artifacts.llm-bridge',
        targetUserId: 7,
        before: null,
      })
      expect(mocks.logger.set).toHaveBeenCalledWith({
        attributes: {
          featureAccess: {
            action: 'opt_in.set',
            flag: 'artifacts.llm-bridge',
            optedIn: true,
          },
        },
      })
    })

    it('opts out by stamping optedOutAt and keeps the opt-in as evidence',
      async () => {
        const optedInAt = new Date('2026-11-01T00:00:00Z')

        mocks.db = createFakeDb([{ optedInAt, optedOutAt: null }])
        mocks.body = { optedIn: false }
        const result = await callRoute('[flag]/opt-in.post.ts')
        const db = mocks.db as ReturnType<typeof createFakeDb>
        const optInWrite = db.inserts.find((entry) => {
          return getTableName(entry.table as Table) === 'feature_opt_ins'
        })
        const auditWrite = db.inserts.find((entry) => {
          return getTableName(entry.table as Table) === 'feature_audit_log'
        })

        expect(result).toMatchObject({ optedIn: false, active: false })
        expect(Object.keys(optInWrite?.conflictSet ?? {}))
          .toEqual(['optedOutAt'])
        expect(optInWrite?.values.optedInAt).toBe(optedInAt)
        expect(auditWrite?.values.before).toEqual({
          optedInAt: Math.floor(optedInAt.getTime() / 1000),
          optedOutAt: null,
        })
      })
  })

  describe('POST /api/v1/profiles/features/experiments', () => {
    it('answers 401 when signed out', async () => {
      mocks.featureContext.mockResolvedValue(createFeatureContext({
        userId: null,
        userState: null,
      }))
      mocks.body = { objected: true }

      await expect(callRoute('experiments.post.ts'))
        .rejects.toMatchObject({ status: 401 })
    })

    it('records an objection on the reserved experiments row', async () => {
      mocks.body = { objected: true }
      mocks.loadUserFeatureState.mockResolvedValue(createUserState({
        optIns: {
          experiments: { optedInAt: null, optedOutAt: new Date() },
        },
      }))

      const result = await callRoute('experiments.post.ts')
      const db = mocks.db as ReturnType<typeof createFakeDb>
      const optInWrite = db.inserts.find((entry) => {
        return getTableName(entry.table as Table) === 'feature_opt_ins'
      })
      const auditWrite = db.inserts.find((entry) => {
        return getTableName(entry.table as Table) === 'feature_audit_log'
      })

      expect(result).toEqual({ objectedToExperiments: true })
      expect(optInWrite?.values).toMatchObject({
        userId: 7,
        flag: 'experiments',
      })
      expect(Object.keys(optInWrite?.conflictSet ?? {}))
        .toEqual(['optedOutAt'])
      expect(auditWrite?.values).toMatchObject({
        action: 'experiments.set',
        flag: 'experiments',
        actorKind: 'ui',
      })
      expect(mocks.logger.set).toHaveBeenCalledWith({
        attributes: {
          featureAccess: { action: 'experiments.set', objected: true },
        },
      })
    })

    it('withdraws the objection by stamping optedInAt', async () => {
      mocks.body = { objected: false }

      await callRoute('experiments.post.ts')

      const db = mocks.db as ReturnType<typeof createFakeDb>
      const optInWrite = db.inserts.find((entry) => {
        return getTableName(entry.table as Table) === 'feature_opt_ins'
      })

      expect(Object.keys(optInWrite?.conflictSet ?? {})).toEqual(['optedInAt'])
    })
  })
})
