import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getTableName } from 'drizzle-orm'
import type { Table } from 'drizzle-orm'

const tableNames = {
  userAttribution: 'user_attribution',
  userActivationEvents: 'user_activation_events',
} as const

function tableNameOf(table: unknown): string {
  return getTableName(table as Table)
}

const mocks = vi.hoisted(() => ({
  getOAuthState: vi.fn<() => Promise<unknown>>(async () => null),
}))

vi.mock('better-auth/api', () => ({
  getOAuthState: mocks.getOAuthState,
}))

interface FakeDbOptions {
  claimed?: boolean
  recordedEvents?: string[]
  attribution?: Record<string, string | null> | null
  failOn?: 'insert' | 'select'
}

interface DbOperation {
  kind: 'insert' | 'select'
  table: string
  values?: unknown
}

function createFakeDb(options: FakeDbOptions = {}) {
  const operations: DbOperation[] = []

  function resolveSelectRows(table: string): unknown[] {
    if (table === tableNames.userActivationEvents) {
      return (options.recordedEvents ?? []).map((event) => {
        return { event }
      })
    }

    if (table === tableNames.userAttribution) {
      return options.attribution ? [options.attribution] : []
    }

    return []
  }

  const db = {
    insert: vi.fn((table: unknown) => {
      if (options.failOn === 'insert') {
        throw new Error('insert failed')
      }

      return {
        values: (values: unknown) => {
          operations.push({ kind: 'insert', table: tableNameOf(table), values })

          const claimRows = options.claimed === false
            ? []
            : [{ userId: (values as { userId: number }).userId }]

          return {
            onConflictDoNothing: () => {
              return Object.assign(Promise.resolve(undefined), {
                returning: vi.fn(async () => claimRows),
              })
            },
          }
        },
      }
    }),
    select: vi.fn(() => {
      if (options.failOn === 'select') {
        throw new Error('select failed')
      }

      return {
        from: (table: unknown) => {
          const tableName = tableNameOf(table)
          const rows = resolveSelectRows(tableName)

          operations.push({ kind: 'select', table: tableName })

          return {
            where: () => {
              return Object.assign(Promise.resolve(rows), {
                limit: async () => rows,
              })
            },
          }
        },
      }
    }),
  }

  function insertsInto(table: string): unknown[] {
    return operations
      .filter((operation) => {
        return operation.kind === 'insert' && operation.table === table
      })
      .map((operation) => {
        return operation.values
      })
  }

  return { db, operations, insertsInto }
}

function createAnalytics() {
  return { writeDataPoint: vi.fn() }
}

function createLogger() {
  return { set: vi.fn() }
}

async function importActivation() {
  return import('../../../../server/utils/analytics/activation')
}

function expectNoFlatAnalyticsEvent(logger: ReturnType<typeof createLogger>) {
  for (const [fields] of logger.set.mock.calls) {
    expect(fields).not.toHaveProperty('analytics')
  }
}

const NEW_USER_EVENTS = ['signup_completed']

describe('server/utils/analytics/activation', () => {
  let analytics: ReturnType<typeof createAnalytics>

  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.unstubAllGlobals()

    analytics = createAnalytics()
    mocks.getOAuthState.mockResolvedValue(null)
    vi.stubGlobal('useAnalytics', () => analytics)
  })

  describe('recordSignupActivation', () => {
    it('stores attribution, claims the ledger and writes the event', async () => {
      const fake = createFakeDb()
      const logger = createLogger()

      vi.stubGlobal('useDb', () => fake.db)

      const { recordSignupActivation } = await importActivation()

      await expect(recordSignupActivation(
        41,
        { source: 'reddit', medium: 'social', campaign: 'launch' },
        logger,
      )).resolves.toBe('fired')

      expect(fake.insertsInto(tableNames.userAttribution)).toEqual([{
        userId: 41,
        utmSource: 'reddit',
        utmMedium: 'social',
        utmCampaign: 'launch',
        utmContent: null,
      }])
      expect(fake.insertsInto(tableNames.userActivationEvents)).toEqual([{
        userId: 41,
        event: 'signup_completed',
        provider: null,
      }])
      expect(analytics.writeDataPoint).toHaveBeenCalledExactlyOnceWith({
        blobs: ['signup_completed', 'launch', 'reddit', 'social', ''],
        doubles: [1],
        indexes: ['signup_completed'],
      })
      expect(logger.set).toHaveBeenCalledExactlyOnceWith({
        analytics: { event: 'signup_completed' },
        attributes: {
          utm: { source: 'reddit', medium: 'social', campaign: 'launch' },
        },
      })
    })

    it('skips the attribution row when there is no utm', async () => {
      const fake = createFakeDb()
      const logger = createLogger()

      vi.stubGlobal('useDb', () => fake.db)

      const { recordSignupActivation } = await importActivation()

      await recordSignupActivation(7, {}, logger)

      expect(fake.insertsInto(tableNames.userAttribution)).toEqual([])
      expect(analytics.writeDataPoint).toHaveBeenCalledExactlyOnceWith({
        blobs: ['signup_completed', 'none', 'none', 'none', ''],
        doubles: [1],
        indexes: ['signup_completed'],
      })
      expect(logger.set).toHaveBeenCalledExactlyOnceWith({
        analytics: { event: 'signup_completed' },
        attributes: {},
      })
    })

    it('does not write the event when the ledger was already claimed', async () => {
      const fake = createFakeDb({ claimed: false })
      const logger = createLogger()

      vi.stubGlobal('useDb', () => fake.db)

      const { recordSignupActivation } = await importActivation()

      await expect(recordSignupActivation(7, { source: 'reddit' }, logger))
        .resolves.toBe('skipped')

      expect(analytics.writeDataPoint).not.toHaveBeenCalled()
      expect(logger.set).not.toHaveBeenCalled()
    })

    it('swallows database errors without setting a flat analytics event', async () => {
      const fake = createFakeDb({ failOn: 'insert' })
      const logger = createLogger()

      vi.stubGlobal('useDb', () => fake.db)

      const { recordSignupActivation } = await importActivation()

      await expect(
        recordSignupActivation(7, { source: 'reddit' }, logger),
      ).resolves.toBe('failed')

      expect(analytics.writeDataPoint).not.toHaveBeenCalled()
      expect(logger.set).toHaveBeenCalledExactlyOnceWith({
        attributes: {
          analytics: { error: 'insert failed', event: 'signup_completed' },
        },
      })
      expectNoFlatAnalyticsEvent(logger)
    })

    it('swallows analytics engine errors', async () => {
      const fake = createFakeDb()
      const logger = createLogger()

      analytics.writeDataPoint.mockImplementation(() => {
        throw new Error('engine down')
      })
      vi.stubGlobal('useDb', () => fake.db)

      const { recordSignupActivation } = await importActivation()

      await expect(recordSignupActivation(7, {}, logger))
        .resolves.toBe('failed')

      expect(logger.set).toHaveBeenCalledExactlyOnceWith({
        attributes: {
          analytics: { error: 'engine down', event: 'signup_completed' },
        },
      })
    })

    it('still claims the ledger when the analytics binding is absent', async () => {
      const fake = createFakeDb()
      const logger = createLogger()

      vi.stubGlobal('useAnalytics', () => null)
      vi.stubGlobal('useDb', () => fake.db)

      const { recordSignupActivation } = await importActivation()

      await recordSignupActivation(7, {}, logger)

      expect(fake.insertsInto(tableNames.userActivationEvents)).toHaveLength(1)
      expect(logger.set).toHaveBeenCalledOnce()
    })
  })

  describe('recordFirstProviderKeyActivation', () => {
    it('reads the ledger and attribution before claiming, then emits', async () => {
      const fake = createFakeDb({
        recordedEvents: NEW_USER_EVENTS,
        attribution: {
          source: 'reddit',
          medium: null,
          campaign: 'launch',
          content: 'hero',
        },
      })
      const logger = createLogger()

      vi.stubGlobal('useDb', () => fake.db)

      const { recordFirstProviderKeyActivation } = await importActivation()

      await expect(
        recordFirstProviderKeyActivation(41, 'anthropic', logger),
      ).resolves.toBe('fired')

      expect(fake.operations).toEqual([
        { kind: 'select', table: tableNames.userActivationEvents },
        { kind: 'select', table: tableNames.userAttribution },
        {
          kind: 'insert',
          table: tableNames.userActivationEvents,
          values: {
            userId: 41,
            event: 'first_provider_key_added',
            provider: 'anthropic',
          },
        },
      ])
      expect(analytics.writeDataPoint).toHaveBeenCalledExactlyOnceWith({
        blobs: [
          'first_provider_key_added',
          'launch',
          'reddit',
          'none',
          'anthropic',
        ],
        doubles: [1],
        indexes: ['first_provider_key_added'],
      })
      expect(logger.set).toHaveBeenCalledExactlyOnceWith({
        analytics: { event: 'first_provider_key_added' },
        attributes: {
          utm: { source: 'reddit', campaign: 'launch', content: 'hero' },
          activation: { provider: 'anthropic' },
        },
      })
    })

    it('skips users who signed up before the feature with a read only', async () => {
      const fake = createFakeDb({ recordedEvents: [] })
      const logger = createLogger()

      vi.stubGlobal('useDb', () => fake.db)

      const { recordFirstProviderKeyActivation } = await importActivation()

      await expect(
        recordFirstProviderKeyActivation(41, 'openai', logger),
      ).resolves.toBe('skipped')

      expect(fake.operations).toEqual([
        { kind: 'select', table: tableNames.userActivationEvents },
      ])
      expect(fake.db.insert).not.toHaveBeenCalled()
      expect(analytics.writeDataPoint).not.toHaveBeenCalled()
      expect(logger.set).not.toHaveBeenCalled()
    })

    it('does no insert once the event is already recorded', async () => {
      const fake = createFakeDb({
        recordedEvents: ['signup_completed', 'first_provider_key_added'],
      })
      const logger = createLogger()

      vi.stubGlobal('useDb', () => fake.db)

      const { recordFirstProviderKeyActivation } = await importActivation()

      await expect(
        recordFirstProviderKeyActivation(41, 'openai', logger),
      ).resolves.toBe('skipped')

      expect(fake.operations).toEqual([
        { kind: 'select', table: tableNames.userActivationEvents },
      ])
      expect(fake.db.insert).not.toHaveBeenCalled()
      expect(logger.set).not.toHaveBeenCalled()
    })

    it('does not emit when a concurrent request won the claim', async () => {
      const fake = createFakeDb({
        recordedEvents: NEW_USER_EVENTS,
        claimed: false,
      })
      const logger = createLogger()

      vi.stubGlobal('useDb', () => fake.db)

      const { recordFirstProviderKeyActivation } = await importActivation()

      await expect(
        recordFirstProviderKeyActivation(41, 'openai', logger),
      ).resolves.toBe('skipped')

      expect(analytics.writeDataPoint).not.toHaveBeenCalled()
      expect(logger.set).not.toHaveBeenCalled()
    })

    it('swallows select errors without setting a flat analytics event', async () => {
      const fake = createFakeDb({ failOn: 'select' })
      const logger = createLogger()

      vi.stubGlobal('useDb', () => fake.db)

      const { recordFirstProviderKeyActivation } = await importActivation()

      await expect(
        recordFirstProviderKeyActivation(41, 'openai', logger),
      ).resolves.toBe('failed')

      expect(logger.set).toHaveBeenCalledExactlyOnceWith({
        attributes: {
          analytics: {
            error: 'select failed',
            event: 'first_provider_key_added',
          },
        },
      })
      expectNoFlatAnalyticsEvent(logger)
    })

    it('swallows a missing DB binding', async () => {
      const logger = createLogger()

      vi.stubGlobal('useDb', () => {
        throw new Error('DB binding missing')
      })

      const { recordFirstProviderKeyActivation } = await importActivation()

      await expect(
        recordFirstProviderKeyActivation(41, 'openai', logger),
      ).resolves.toBe('failed')

      expect(analytics.writeDataPoint).not.toHaveBeenCalled()
      expectNoFlatAnalyticsEvent(logger)
    })
  })

  describe('recordFirstChatMessageActivation', () => {
    it('emits once for a new user without attribution', async () => {
      const fake = createFakeDb({
        recordedEvents: NEW_USER_EVENTS,
        attribution: null,
      })
      const logger = createLogger()

      vi.stubGlobal('useDb', () => fake.db)

      const { recordFirstChatMessageActivation } = await importActivation()

      await expect(
        recordFirstChatMessageActivation(41, 'google', logger),
      ).resolves.toBe('fired')

      expect(fake.insertsInto(tableNames.userActivationEvents)).toEqual([{
        userId: 41,
        event: 'first_chat_message',
        provider: 'google',
      }])
      expect(analytics.writeDataPoint).toHaveBeenCalledExactlyOnceWith({
        blobs: ['first_chat_message', 'none', 'none', 'none', 'google'],
        doubles: [1],
        indexes: ['first_chat_message'],
      })
      expect(logger.set).toHaveBeenCalledExactlyOnceWith({
        analytics: { event: 'first_chat_message' },
        attributes: { activation: { provider: 'google' } },
      })
    })

    it('fires only once across repeated messages', async () => {
      const firstFake = createFakeDb({ recordedEvents: NEW_USER_EVENTS })
      const secondFake = createFakeDb({
        recordedEvents: ['signup_completed', 'first_chat_message'],
      })
      const logger = createLogger()

      vi.stubGlobal('useDb', () => firstFake.db)

      const { recordFirstChatMessageActivation } = await importActivation()

      await recordFirstChatMessageActivation(41, 'openai', logger)

      vi.stubGlobal('useDb', () => secondFake.db)

      await expect(recordFirstChatMessageActivation(41, 'openai', logger))
        .resolves.toBe('skipped')

      expect(analytics.writeDataPoint).toHaveBeenCalledOnce()
      expect(logger.set).toHaveBeenCalledOnce()
      expect(secondFake.db.insert).not.toHaveBeenCalled()
    })

    it('skips users outside the signup cohort without writing', async () => {
      const fake = createFakeDb({ recordedEvents: [] })
      const logger = createLogger()

      vi.stubGlobal('useDb', () => fake.db)

      const { recordFirstChatMessageActivation } = await importActivation()

      await expect(recordFirstChatMessageActivation(41, 'openai', logger))
        .resolves.toBe('skipped')

      expect(fake.db.insert).not.toHaveBeenCalled()
      expect(analytics.writeDataPoint).not.toHaveBeenCalled()
    })
  })

  it('never writes a user id into the analytics engine payload', async () => {
    const userId = 987654321
    const fake = createFakeDb({
      recordedEvents: NEW_USER_EVENTS,
      attribution: {
        source: 'reddit',
        medium: 'social',
        campaign: 'launch',
        content: null,
      },
    })

    vi.stubGlobal('useDb', () => fake.db)

    const {
      recordSignupActivation,
      recordFirstProviderKeyActivation,
      recordFirstChatMessageActivation,
    } = await importActivation()

    await recordSignupActivation(userId, { source: 'reddit' }, createLogger())
    await recordFirstProviderKeyActivation(userId, 'openai', createLogger())
    await recordFirstChatMessageActivation(userId, 'openai', createLogger())

    expect(analytics.writeDataPoint).toHaveBeenCalledTimes(3)
    expect(JSON.stringify(analytics.writeDataPoint.mock.calls))
      .not.toContain(String(userId))

    for (const [dataPoint] of analytics.writeDataPoint.mock.calls) {
      expect(Object.keys(dataPoint as object).sort())
        .toEqual(['blobs', 'doubles', 'indexes'])
      expect((dataPoint as { blobs: unknown[] }).blobs).toHaveLength(5)
      expect((dataPoint as { doubles: unknown[] }).doubles).toEqual([1])
    }
  })

  describe('resolveSignupUtm', () => {
    it('reads utm from the email sign-up callbackURL', async () => {
      const { resolveSignupUtm } = await importActivation()

      await expect(resolveSignupUtm({
        body: { callbackURL: '/signin?utm_source=Reddit&utm_medium=social' },
      })).resolves.toEqual({ source: 'reddit', medium: 'social' })
      expect(mocks.getOAuthState).not.toHaveBeenCalled()
    })

    it('falls back to the oauth state callbackURL', async () => {
      mocks.getOAuthState.mockResolvedValue({
        callbackURL: '/chats/new?utm_campaign=launch',
      })

      const { resolveSignupUtm } = await importActivation()

      await expect(resolveSignupUtm({ body: undefined }))
        .resolves.toEqual({ campaign: 'launch' })
    })

    it('unwraps the oauth-proxy callbackURL used on previews', async () => {
      const original = '/chats/new?utm_source=reddit'

      mocks.getOAuthState.mockResolvedValue({
        callbackURL: 'https://pr-9.example.workers.dev/api/auth/callback/'
          + `github/oauth-proxy?callbackURL=${encodeURIComponent(original)}`,
      })

      const { resolveSignupUtm } = await importActivation()

      await expect(resolveSignupUtm(null))
        .resolves.toEqual({ source: 'reddit' })
    })

    it('returns no utm when the oauth state is unavailable', async () => {
      mocks.getOAuthState.mockRejectedValue(new Error('No request state'))

      const { resolveSignupUtm } = await importActivation()

      await expect(resolveSignupUtm(undefined)).resolves.toEqual({})
    })

    it('ignores a non-string callbackURL', async () => {
      const { resolveSignupUtm } = await importActivation()

      await expect(resolveSignupUtm({ body: { callbackURL: 42 } }))
        .resolves.toEqual({})
    })
  })
})
