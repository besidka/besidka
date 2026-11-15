import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LEGAL_NOTICES } from '#shared/utils/legal-notices'
import * as schema from '~~/server/db/schema'
import { isAdminUser } from '~~/server/utils/features/evaluate'
import { resetApprovedConsentVersionMemo } from '~~/server/utils/legal/consent-version'
import {
  createMemoryExtractionTestDb,
} from '../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../setup/helpers/memory-extraction-db'

const mocks = vi.hoisted(() => ({
  useFeatureContext: vi.fn(),
  assertNotCrossSiteRequest: vi.fn(),
  logger: { set: vi.fn() },
  routerParams: {} as Record<string, string>,
  headers: {} as Record<string, string>,
  body: {} as unknown,
}))

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { publicIdMockFactory } = await import(
    '../../setup/helpers/public-id-mock'
  )

  return await publicIdMockFactory()
})

vi.mock('nuxt/server', () => ({
  defineEventHandler: (handler: unknown) => handler,
  getRouterParams: () => mocks.routerParams,
  getRequestHeader: (_event: unknown, name: string) => mocks.headers[name],
  getRequestURL: () => new URL('https://besidka.com/api/v1/admin/legal'),
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
  useFeatureContext: mocks.useFeatureContext,
  evaluateFeatureForEvent: vi.fn(),
}))

vi.mock('~~/server/utils/logging/request-logger', () => ({
  useRequestLogger: () => mocks.logger,
}))

const runtimeConfig = (await import('#app/nuxt')).useRuntimeConfig() as
  unknown as Record<string, unknown>

const NOTICE = LEGAL_NOTICES[0]
const OWNER_EMAIL = 'owner@example.com'
const ADMIN_CONFIG = {
  adminEmails: OWNER_EMAIL,
  featuresDisabled: '',
  featuresHostMode: 'byok',
  featuresRolloutEnabled: false,
  requireAdminTwoFactor: true,
}

const LEGAL_ROUTES = [
  'legal/index.get.ts',
  'legal/notices/[id]/approve.post.ts',
  'legal/notices/[id]/withdraw.post.ts',
  'legal/consent-version/approve.post.ts',
  'legal/opt-outs/index.post.ts',
  'legal/opt-outs/[id]/remove.post.ts',
]

function createEvent() {
  return { context: {}, res: { headers: new Headers() } }
}

async function callRoute(file: string, event = createEvent()) {
  const { default: handler } = await import(
    `../../../server/api/v1/admin/${file}`
  )

  return (handler as (input: unknown) => Promise<any>)(event)
}

function featureContextFor(twoFactorEnabled: boolean) {
  const userState = {
    email: OWNER_EMAIL,
    emailVerified: true,
    twoFactorEnabled,
    roles: [],
  }

  return {
    userId: 1,
    rules: {},
    userState,
    config: ADMIN_CONFIG,
    isAdmin: isAdminUser(userState as never, ADMIN_CONFIG),
    exposures: new Set(),
  }
}

describe('admin legal API routes', () => {
  let testDb: MemoryExtractionTestDb
  let kvStore: Map<string, string>

  async function seedUser(email: string): Promise<number> {
    const [user] = await testDb.db.insert(schema.users).values({
      name: email,
      email,
      emailVerified: true,
      createdAt: new Date('2026-10-01T00:00:00.000Z'),
    }).returning({ id: schema.users.id })

    return user!.id
  }

  async function readApprovals() {
    return await testDb.db.select().from(schema.legalNoticeApprovals)
  }

  async function readAudit() {
    return await testDb.db.select().from(schema.featureAuditLog)
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-02T10:00:00.000Z'))
    resetApprovedConsentVersionMemo()
    testDb = createMemoryExtractionTestDb()
    kvStore = new Map()
    vi.stubGlobal('useDb', () => testDb.db)
    vi.stubGlobal('useKV', () => ({
      get: async (key: string) => kvStore.get(key) ?? null,
      put: async (key: string, value: string) => {
        kvStore.set(key, value)
      },
      delete: async (key: string) => {
        kvStore.delete(key)
      },
    }))
    vi.stubGlobal('assertNotCrossSiteRequest', mocks.assertNotCrossSiteRequest)
    vi.stubGlobal('useUnauthorizedError', () => {
      throw Object.assign(new Error('Unauthorized'), { status: 401 })
    })
    mocks.useFeatureContext.mockResolvedValue(featureContextFor(true))
    mocks.routerParams = {}
    mocks.headers = {}
    mocks.body = {}
    runtimeConfig.legalNoticeSweepEnabled = false
    mocks.logger.set.mockClear()
    mocks.assertNotCrossSiteRequest.mockClear()
  })

  afterEach(() => {
    testDb.close()
    vi.useRealTimers()
    vi.unstubAllGlobals()
    resetApprovedConsentVersionMemo()
  })

  it.each(LEGAL_ROUTES)(
    '%s refuses an env admin without two-factor authentication',
    async (file) => {
      mocks.useFeatureContext.mockResolvedValue(featureContextFor(false))
      mocks.routerParams = { id: NOTICE.id }
      mocks.body = { recipientEstimate: 0, version: '2026-11-a', userId: 1 }

      await expect(callRoute(file)).rejects.toMatchObject({ status: 404 })
      expect(await readApprovals()).toEqual([])
      expect(await readAudit()).toEqual([])
    },
  )

  it.each(LEGAL_ROUTES)('%s answers 401 when signed out', async (file) => {
    mocks.useFeatureContext.mockResolvedValue({
      ...featureContextFor(true),
      userId: null,
      isAdmin: false,
    })

    await expect(callRoute(file)).rejects.toMatchObject({ status: 401 })
  })

  it('lists the legal state with no-store and the sweep switch', async () => {
    runtimeConfig.legalNoticeSweepEnabled = true

    const event = createEvent()
    const result = await callRoute('legal/index.get.ts', event)

    expect(event.res.headers.get('Cache-Control')).toBe('private, no-store')
    expect(result.sweepEnabled).toBe(true)
    expect(result.notices).toHaveLength(LEGAL_NOTICES.length)
    expect(result.consent.effectiveVersion).toBe('2026-11-a')
  })

  it('approves and withdraws a notice with audit rows', async () => {
    await seedUser(OWNER_EMAIL)
    await seedUser('reader@example.test')
    mocks.routerParams = { id: NOTICE.id }
    mocks.body = { recipientEstimate: 2 }

    const approved = await callRoute('legal/notices/[id]/approve.post.ts')

    expect(mocks.assertNotCrossSiteRequest).toHaveBeenCalled()
    expect(approved.approval).toMatchObject({
      noticeId: NOTICE.id,
      recipientEstimate: 2,
    })

    mocks.body = {}
    await callRoute('legal/notices/[id]/withdraw.post.ts')

    const [approval] = await readApprovals()

    expect(approval?.withdrawnAt).toBeInstanceOf(Date)
    expect((await readAudit()).map((row) => {
      return [row.action, row.actorUserId, row.actorKind]
    })).toEqual([
      ['legal-notice.approve', 1, 'ui'],
      ['legal-notice.withdraw', 1, 'ui'],
    ])
  })

  it.each([
    [{ 'sec-fetch-site': 'same-site' }],
    [{ 'sec-fetch-site': 'cross-site' }],
    [{ origin: 'https://evil.besidka.com' }],
  ])('refuses an approval that is not same-origin: %o', async (headers) => {
    mocks.headers = headers
    mocks.routerParams = { id: NOTICE.id }
    mocks.body = { recipientEstimate: 0 }

    await expect(callRoute('legal/notices/[id]/approve.post.ts'))
      .rejects.toMatchObject({ status: 403 })
    expect(await readApprovals()).toEqual([])
  })

  it('rejects an approval body with unknown keys', async () => {
    mocks.routerParams = { id: NOTICE.id }
    mocks.body = { recipientEstimate: 0, sendFrom: '2026-11-01' }

    await expect(callRoute('legal/notices/[id]/approve.post.ts'))
      .rejects.toMatchObject({ status: 400 })
  })

  it('rejects a malformed notice id', async () => {
    mocks.routerParams = { id: '../etc' }
    mocks.body = { recipientEstimate: 0 }

    await expect(callRoute('legal/notices/[id]/approve.post.ts'))
      .rejects.toMatchObject({ status: 400 })
  })

  it('refuses to approve a consent version that is not in code', async () => {
    mocks.body = { version: '2027-01-a' }

    await expect(callRoute('legal/consent-version/approve.post.ts'))
      .rejects.toMatchObject({ status: 409 })
    expect(await readAudit()).toEqual([])
  })

  it('refuses to approve the consent version already in effect', async () => {
    mocks.body = { version: '2026-11-a' }

    await expect(callRoute('legal/consent-version/approve.post.ts'))
      .rejects.toMatchObject({ status: 409 })
  })

  it('adds and removes an opt-out by user id', async () => {
    const userId = await seedUser('reader@example.test')

    mocks.body = { userId }
    await expect(callRoute('legal/opt-outs/index.post.ts'))
      .resolves.toEqual({ optOut: { userId, changed: true } })

    mocks.body = {}
    mocks.routerParams = { id: String(userId) }
    await expect(callRoute('legal/opt-outs/[id]/remove.post.ts'))
      .resolves.toEqual({ optOut: { userId, changed: true } })

    expect((await readAudit()).map((row) => {
      return [row.action, row.targetUserId]
    })).toEqual([
      ['legal-notice-opt-out.add', userId],
      ['legal-notice-opt-out.remove', userId],
    ])
  })
})
