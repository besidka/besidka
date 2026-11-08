import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LEGAL_NOTICES } from '#shared/utils/legal-notices'
import * as schema from '~~/server/db/schema'
import {
  createMemoryExtractionTestDb,
  seedUser,
} from '../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../setup/helpers/memory-extraction-db'

vi.mock('~~/server/utils/logging/request-logger', () => ({
  useRequestLogger: () => ({ set: vi.fn() }),
}))

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { publicIdMockFactory } = await import(
    '../../setup/helpers/public-id-mock'
  )

  return await publicIdMockFactory()
})

const [KNOWN_NOTICE] = LEGAL_NOTICES
const KNOWN_NOTICE_ID = KNOWN_NOTICE.id

describe('profile settings legal notice dismissal', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number
  let session: { user: { id: string } } | null

  async function patch(body: Record<string, unknown>) {
    const module = await import(
      '../../../server/api/v1/profiles/settings/index.patch'
    )

    return await module.default({ body } as any)
  }

  async function get() {
    const module = await import(
      '../../../server/api/v1/profiles/settings/index.get'
    )

    return await module.default({} as any)
  }

  async function readStoredIds(): Promise<string[] | null | undefined> {
    const settings = await testDb.db.query.userSettings.findFirst({
      where: { userId },
      columns: { dismissedLegalNoticeIds: true },
    })

    return settings?.dismissedLegalNoticeIds
  }

  beforeEach(async () => {
    vi.resetModules()

    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, {})
    session = { user: { id: String(userId) } }

    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('useDb', () => testDb.db)
    vi.stubGlobal('useUserSession', vi.fn(async () => session))
    vi.stubGlobal('useUnauthorizedError', () => {
      throw Object.assign(new Error('Unauthorized'), { status: 401 })
    })
    vi.stubGlobal('readValidatedBody', async (
      event: { body: unknown },
      parser: (body: unknown) => unknown,
    ) => {
      return parser(event.body)
    })
    vi.stubGlobal('useKV', () => ({
      get: async () => null,
      put: async () => undefined,
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    testDb.close()
  })

  it('stores a known notice id on the settings row', async () => {
    await patch({ dismissLegalNoticeIds: [KNOWN_NOTICE_ID] })

    expect(await readStoredIds()).toEqual([KNOWN_NOTICE_ID])
  })

  it('returns the merged ids in the update result', async () => {
    const result = await patch({ dismissLegalNoticeIds: [KNOWN_NOTICE_ID] })

    expect(result).toEqual({ dismissedLegalNoticeIds: [KNOWN_NOTICE_ID] })
  })

  it('dedupes repeated ids in one request and across requests', async () => {
    await patch({
      dismissLegalNoticeIds: [KNOWN_NOTICE_ID, KNOWN_NOTICE_ID],
    })
    await patch({ dismissLegalNoticeIds: [KNOWN_NOTICE_ID] })

    expect(await readStoredIds()).toEqual([KNOWN_NOTICE_ID])
  })

  it('keeps ids stored earlier when another one is added', async () => {
    await testDb.db.update(schema.userSettings)
      .set({ dismissedLegalNoticeIds: ['2026-01-older-notice'] })

    await patch({ dismissLegalNoticeIds: [KNOWN_NOTICE_ID] })

    expect(await readStoredIds()).toEqual([
      '2026-01-older-notice',
      KNOWN_NOTICE_ID,
    ])
  })

  it('creates the settings row when the user has none', async () => {
    const userWithoutSettings = await seedUser(testDb.db, null)

    session = { user: { id: String(userWithoutSettings) } }

    await patch({ dismissLegalNoticeIds: [KNOWN_NOTICE_ID] })

    const settings = await testDb.db.query.userSettings.findFirst({
      where: { userId: userWithoutSettings },
      columns: { dismissedLegalNoticeIds: true },
    })

    expect(settings?.dismissedLegalNoticeIds).toEqual([KNOWN_NOTICE_ID])
  })

  it('rejects an unknown notice id with a 400 and stores nothing', async () => {
    await expect(
      patch({ dismissLegalNoticeIds: [KNOWN_NOTICE_ID, 'not-a-notice'] }),
    ).rejects.toMatchObject({ status: 400 })

    expect(await readStoredIds()).toBeNull()
  })

  it('rejects an empty list of notice ids', async () => {
    await expect(patch({ dismissLegalNoticeIds: [] }))
      .rejects.toMatchObject({ status: 400 })
  })

  it('keeps the other settings of the row unchanged', async () => {
    await testDb.db.update(schema.userSettings)
      .set({
        sidebarPinned: true,
        favoriteModels: ['gpt-5.4'],
        typesafeRoles: { memoryChecks: false },
      })

    await patch({ dismissLegalNoticeIds: [KNOWN_NOTICE_ID] })

    const settings = await testDb.db.query.userSettings.findFirst({
      where: { userId },
      columns: {
        sidebarPinned: true,
        favoriteModels: true,
        typesafeRoles: true,
        dismissedLegalNoticeIds: true,
      },
    })

    expect(settings?.sidebarPinned).toBe(true)
    expect(settings?.favoriteModels).toEqual(['gpt-5.4'])
    expect(settings?.typesafeRoles).toEqual({ memoryChecks: false })
    expect(settings?.dismissedLegalNoticeIds).toEqual([KNOWN_NOTICE_ID])
  })

  it.each([
    ['a non-array value', KNOWN_NOTICE_ID],
    ['an id longer than 100 characters', ['n'.repeat(101)]],
    ['more than 20 ids', Array.from({ length: 21 }, () => KNOWN_NOTICE_ID)],
  ])('rejects %s and writes nothing', async (_name, value) => {
    await expect(patch({ dismissLegalNoticeIds: value }))
      .rejects.toMatchObject({ status: 400 })

    expect(await readStoredIds()).toBeNull()
  })

  it('rejects an unauthenticated request', async () => {
    session = null

    await expect(patch({ dismissLegalNoticeIds: [KNOWN_NOTICE_ID] }))
      .rejects.toMatchObject({ status: 401 })

    expect(await readStoredIds()).toBeNull()
  })

  it('returns an empty list from the settings read before any dismissal',
    async () => {
      const settings = await get() as { dismissedLegalNoticeIds: string[] }

      expect(settings.dismissedLegalNoticeIds).toEqual([])
    })

  it('returns the dismissed ids from the settings read', async () => {
    await patch({ dismissLegalNoticeIds: [KNOWN_NOTICE_ID] })

    const settings = await get() as { dismissedLegalNoticeIds: string[] }

    expect(settings.dismissedLegalNoticeIds).toEqual([KNOWN_NOTICE_ID])
  })
})
