import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import {
  createMemoryExtractionTestDb,
  seedChat,
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

const SEEDED_CHATS = 40
const FIRST_ENABLE_AT = new Date('2026-10-26T10:00:00.000Z')
const SECONDS = 1000

function secondsAfter(seconds: number, from = FIRST_ENABLE_AT): Date {
  return new Date(from.getTime() + seconds * SECONDS)
}

describe('memory extraction toggle restamp', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number
  let kvStore: Map<string, string>

  async function patch(body: Record<string, unknown>) {
    const module = await import(
      '../../../server/api/v1/profiles/settings/index.patch'
    )

    return await module.default({ body } as any)
  }

  async function patchAt(at: Date, body: Record<string, unknown>) {
    vi.setSystemTime(at)

    return await patch(body)
  }

  function countChatsStampedAt(at: Date): number {
    const row = testDb.sqlite
      .prepare(`
        select count(*) as total from chats
        where user_id = ? and memory_extracted_at = ?
      `)
      .get(userId, Math.floor(at.getTime() / SECONDS)) as { total: number }

    return row.total
  }

  async function readSettings() {
    return await testDb.db.query.userSettings.findFirst({
      where: { userId },
      columns: {
        memoryExtractionEnabled: true,
        memoryExtractionEnabledAt: true,
      },
    })
  }

  beforeEach(async () => {
    vi.resetModules()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(secondsAfter(-3600))

    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, { memoryExtractionEnabled: false })
    kvStore = new Map()

    for (let index = 0; index < SEEDED_CHATS; index++) {
      await seedChat(testDb.db, userId, {
        activityAt: secondsAfter(-600 - index),
      })
    }

    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('useDb', () => testDb.db)
    vi.stubGlobal('useUserSession', vi.fn(async () => {
      return { user: { id: String(userId) } }
    }))
    vi.stubGlobal('readValidatedBody', async (
      event: { body: unknown },
      parser: (body: unknown) => unknown,
    ) => {
      return parser(event.body)
    })
    vi.stubGlobal('useKV', () => ({
      get: async (key: string) => kvStore.get(key) ?? null,
      put: async (key: string, value: string) => {
        kvStore.set(key, value)
      },
    }))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    testDb.close()
  })

  it('stamps the whole backlog on the first enable', async () => {
    await patchAt(FIRST_ENABLE_AT, { memoryExtractionEnabled: true })

    expect(countChatsStampedAt(FIRST_ENABLE_AT)).toBe(SEEDED_CHATS)
    expect((await readSettings())?.memoryExtractionEnabledAt)
      .toEqual(FIRST_ENABLE_AT)
  })

  it('rewrites no chat row on a later off-to-on toggle without new '
    + 'activity', async () => {
    const secondEnableAt = secondsAfter(60)

    await patchAt(FIRST_ENABLE_AT, { memoryExtractionEnabled: true })
    await patchAt(secondsAfter(30), { memoryExtractionEnabled: false })
    await patchAt(secondEnableAt, { memoryExtractionEnabled: true })

    expect(countChatsStampedAt(secondEnableAt)).toBe(0)
    expect(countChatsStampedAt(FIRST_ENABLE_AT)).toBe(SEEDED_CHATS)
    expect((await readSettings())?.memoryExtractionEnabledAt)
      .toEqual(secondEnableAt)
  })

  it('restamps only the chats with activity while extraction was off, so '
    + 'the sweep never reads that window', async () => {
    const secondEnableAt = secondsAfter(60)
    const offWindowChat = await seedChat(testDb.db, userId, {
      activityAt: secondsAfter(-700),
    })

    await patchAt(FIRST_ENABLE_AT, { memoryExtractionEnabled: true })
    await patchAt(secondsAfter(30), { memoryExtractionEnabled: false })
    await testDb.db.update(schema.chats)
      .set({ activityAt: secondsAfter(45) })
      .where(eq(schema.chats.id, offWindowChat.id))
    await patchAt(secondEnableAt, { memoryExtractionEnabled: true })

    const offWindowRow = await testDb.db.query.chats.findFirst({
      where: { id: offWindowChat.id },
      columns: { memoryExtractedAt: true },
    })

    expect(countChatsStampedAt(secondEnableAt)).toBe(1)
    expect(offWindowRow?.memoryExtractedAt).toEqual(secondEnableAt)
  })

  it('stamps a chat that was never stamped on a re-enable', async () => {
    const secondEnableAt = secondsAfter(60)

    await patchAt(FIRST_ENABLE_AT, { memoryExtractionEnabled: true })
    await patchAt(secondsAfter(30), { memoryExtractionEnabled: false })
    await seedChat(testDb.db, userId, { activityAt: secondsAfter(40) })
    await patchAt(secondEnableAt, { memoryExtractionEnabled: true })

    expect(countChatsStampedAt(secondEnableAt)).toBe(1)
  })

  it('answers 429 to a second enable inside the cooldown and changes '
    + 'nothing', async () => {
    await patchAt(FIRST_ENABLE_AT, { memoryExtractionEnabled: true })
    await patchAt(secondsAfter(2), { memoryExtractionEnabled: false })

    await expect(
      patchAt(secondsAfter(4), { memoryExtractionEnabled: true }),
    ).rejects.toMatchObject({ status: 429 })

    const settings = await readSettings()

    expect(settings?.memoryExtractionEnabled).toBe(false)
    expect(settings?.memoryExtractionEnabledAt).toEqual(FIRST_ENABLE_AT)
    expect(countChatsStampedAt(secondsAfter(4))).toBe(0)
  })

  it('lets the enable through once the cooldown has passed', async () => {
    await patchAt(FIRST_ENABLE_AT, { memoryExtractionEnabled: true })
    await patchAt(secondsAfter(2), { memoryExtractionEnabled: false })

    await expect(
      patchAt(secondsAfter(11), { memoryExtractionEnabled: true }),
    ).resolves.toEqual({ memoryExtractionEnabled: true })
  })

  it('never applies the cooldown to turning extraction off', async () => {
    await patchAt(FIRST_ENABLE_AT, { memoryExtractionEnabled: true })

    await expect(
      patchAt(secondsAfter(1), { memoryExtractionEnabled: false }),
    ).resolves.toEqual({ memoryExtractionEnabled: false })
  })
})
