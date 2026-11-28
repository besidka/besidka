import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import {
  createMemoryExtractionTestDb,
  seedUser,
} from '../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../setup/helpers/memory-extraction-db'
import { createFakeConnectorKv } from '../../setup/helpers/connectors-oauth'
import type { FakeConnectorKv } from '../../setup/helpers/connectors-oauth'
import { createFakeBucket } from '../../setup/helpers/google-connections'
import type { FakeBucket } from '../../setup/helpers/google-connections'

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { skillPublicIdMockFactory } = await import(
    '../../setup/helpers/skills-public-id-mock'
  )

  return await skillPublicIdMockFactory()
})

const ENDED_AT = new Date('2026-11-22T12:00:00.000Z')
const BEFORE_END = new Date('2026-11-22T11:00:00.000Z')
const AFTER_END = new Date('2026-11-22T12:05:00.000Z')

async function accessEndedModule() {
  return await import('~~/server/utils/google/access-ended')
}

describe('Google access-ended cleanup', () => {
  let testDb: MemoryExtractionTestDb
  let kv: FakeConnectorKv
  let bucket: FakeBucket
  let userId: number
  const logger = { set: vi.fn() }

  async function seedFile(
    owner: number,
    storageKey: string,
    options: {
      externalSource?: 'google' | null
      createdAt?: Date
    } = {},
  ) {
    await testDb.db.insert(schema.files).values({
      userId: owner,
      storageKey,
      name: 'File name that must not be logged.pdf',
      size: 10,
      type: 'application/pdf',
      externalSource: options.externalSource === undefined
        ? 'google'
        : options.externalSource,
      createdAt: options.createdAt ?? BEFORE_END,
    })
  }

  async function seedConnection(
    owner: number,
    status: 'active' | 'needs_reauth' | 'revoked',
    clientMode: 'besidka' | 'byo' = 'besidka',
    tokens: { refreshToken?: string | null } = {},
  ) {
    const [row] = await testDb.db.insert(schema.googleConnections).values({
      userId: owner,
      clientMode,
      grantedScopes: [],
      status,
      refreshToken: tokens.refreshToken ?? null,
    }).returning({ id: schema.googleConnections.id })

    return row!.id
  }

  async function storageKeysOf(owner: number) {
    const rows = await testDb.db
      .select({ storageKey: schema.files.storageKey })
      .from(schema.files)
      .where(eq(schema.files.userId, owner))

    return rows.map(row => row.storageKey).sort()
  }

  async function cleanup(overrides: Record<string, unknown> = {}) {
    const { deleteGoogleDerivedFiles } = await accessEndedModule()

    return await deleteGoogleDerivedFiles({
      db: testDb.db,
      userId,
      createdBefore: ENDED_AT,
      logger,
      ...overrides,
    })
  }

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    kv = createFakeConnectorKv()
    bucket = createFakeBucket()
    userId = await seedUser(testDb.db)
    logger.set.mockClear()
    vi.stubGlobal('useDb', () => testDb.db)
    vi.stubGlobal('useKV', () => kv)
    vi.stubGlobal('useFileStorage', () => bucket)
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  it('deletes Google copies in R2 batches with their derived keys',
    async () => {
      await seedFile(userId, 'u/drive-a.pdf')
      await seedFile(userId, 'u/drive-b.docx')
      await seedFile(userId, 'u/upload.pdf', { externalSource: null })

      const result = await cleanup()

      expect(result).toEqual({ deleted: 2, complete: true, skipped: false })
      expect(bucket.delete).toHaveBeenCalledTimes(1)
      expect(bucket.deletedBatches[0]).toEqual(expect.arrayContaining([
        'u/drive-a.pdf',
        'u/drive-b.docx',
      ]))
      expect(bucket.deletedBatches[0]!.length).toBeGreaterThan(2)
      expect(await storageKeysOf(userId)).toEqual(['u/upload.pdf'])
      expect(JSON.stringify(logger.set.mock.calls))
        .not.toContain('must not be logged')
    })

  it('never deletes a file picked after access ended', async () => {
    await seedFile(userId, 'u/before.pdf')
    await seedFile(userId, 'u/after.pdf', { createdAt: AFTER_END })

    await cleanup()

    expect(await storageKeysOf(userId)).toEqual(['u/after.pdf'])
  })

  it('stops as soon as the user is connected again', async () => {
    await seedConnection(userId, 'active')
    await seedFile(userId, 'u/drive-a.pdf')

    const result = await cleanup()

    expect(result).toEqual({ deleted: 0, complete: true, skipped: true })
    expect(bucket.delete).not.toHaveBeenCalled()
  })

  it('stops between batches when a reconnect lands mid-cleanup', async () => {
    const { GOOGLE_FILE_CLEANUP_BATCH_SIZE } = await accessEndedModule()

    for (let index = 0; index <= GOOGLE_FILE_CLEANUP_BATCH_SIZE; index++) {
      await seedFile(userId, `u/drive-${index}.pdf`)
    }

    bucket.delete.mockImplementationOnce(async (keys: string | string[]) => {
      bucket.deletedBatches.push([...keys])
      await seedConnection(userId, 'active')
    })

    const result = await cleanup()

    expect(result).toEqual({
      deleted: GOOGLE_FILE_CLEANUP_BATCH_SIZE,
      complete: true,
      skipped: true,
    })
    expect(await storageKeysOf(userId)).toHaveLength(1)
  })

  it('splits more than one batch of files', async () => {
    const { GOOGLE_FILE_CLEANUP_BATCH_SIZE } = await accessEndedModule()

    for (let index = 0; index <= GOOGLE_FILE_CLEANUP_BATCH_SIZE; index++) {
      await seedFile(userId, `u/drive-${index}.pdf`)
    }

    const result = await cleanup()

    expect(result).toEqual({
      deleted: GOOGLE_FILE_CLEANUP_BATCH_SIZE + 1,
      complete: true,
      skipped: false,
    })
    expect(bucket.delete).toHaveBeenCalledTimes(2)
  })

  it('stops at the file budget and reports it unfinished', async () => {
    await seedFile(userId, 'u/drive-a.pdf')
    await seedFile(userId, 'u/drive-b.pdf')
    await seedFile(userId, 'u/drive-c.pdf')

    const result = await cleanup({
      budget: {
        remainingFiles: 2,
        deadline: Number.POSITIVE_INFINITY,
        now: Date.now,
      },
    })

    expect(result).toEqual({ deleted: 2, complete: false, skipped: false })
    expect(await storageKeysOf(userId)).toHaveLength(1)
  })

  it('stops at the deadline', async () => {
    await seedFile(userId, 'u/drive-a.pdf')

    const result = await cleanup({
      budget: { remainingFiles: 100, deadline: 0, now: () => 1 },
    })

    expect(result).toEqual({ deleted: 0, complete: false, skipped: false })
  })

  it('keeps the rows when R2 fails, so a retry can finish', async () => {
    await seedFile(userId, 'u/drive-a.pdf')
    bucket.delete.mockRejectedValueOnce(new Error('r2 down'))

    const result = await cleanup()

    expect(result).toEqual({ deleted: 0, complete: false, skipped: false })
    expect(await storageKeysOf(userId)).toEqual(['u/drive-a.pdf'])
  })

  it('does not let an active own-client connection keep the copies',
    async () => {
      await seedConnection(userId, 'active', 'byo')
      await seedFile(userId, 'u/drive-a.pdf')

      const result = await cleanup()

      expect(result).toEqual({ deleted: 1, complete: true, skipped: false })
      expect(await storageKeysOf(userId)).toEqual([])
    })

  it('leaves other users alone', async () => {
    const otherUserId = await seedUser(testDb.db)

    await seedFile(userId, 'u/drive-a.pdf')
    await seedFile(otherUserId, 'o/drive-a.pdf')

    await cleanup()

    expect(await storageKeysOf(otherUserId)).toEqual(['o/drive-a.pdf'])
  })

  describe('hourly sweep', () => {
    async function sweep(overrides: Record<string, unknown> = {}) {
      const { sweepGoogleAccessEnded } = await accessEndedModule()

      return await sweepGoogleAccessEnded({
        db: testDb.db,
        kv: kv as never,
        logger,
        now: () => ENDED_AT.getTime(),
        ...overrides,
      })
    }

    it('cleans users with Google files and no active connection',
      async () => {
        const activeUserId = await seedUser(testDb.db)
        const revokedUserId = await seedUser(testDb.db)

        await seedConnection(userId, 'needs_reauth', 'besidka', {
          refreshToken: 'enc:left-over',
        })
        await seedFile(userId, 'u/drive-a.pdf')
        await seedConnection(activeUserId, 'active')
        await seedConnection(activeUserId, 'needs_reauth', 'byo')
        await seedFile(activeUserId, 'a/drive-a.pdf')
        await seedConnection(revokedUserId, 'revoked')
        await seedFile(revokedUserId, 'r/drive-a.pdf')

        const result = await sweep()

        expect(result).toEqual({
          tokensCleared: 1,
          usersCleaned: 2,
          filesDeleted: 2,
          incompleteUsers: 0,
          revokedRowsDeleted: 1,
        })
        expect(await storageKeysOf(userId)).toEqual([])
        expect(await storageKeysOf(revokedUserId)).toEqual([])
        expect(await storageKeysOf(activeUserId)).toEqual(['a/drive-a.pdf'])

        const rows = await testDb.db
          .select({
            userId: schema.googleConnections.userId,
            status: schema.googleConnections.status,
            refreshToken: schema.googleConnections.refreshToken,
          })
          .from(schema.googleConnections)

        expect(rows).toEqual(expect.arrayContaining([
          { userId, status: 'needs_reauth', refreshToken: null },
          { userId: activeUserId, status: 'active', refreshToken: null },
        ]))
        expect(rows.some(row => row.userId === revokedUserId)).toBe(false)
      })

    it('handles at most the user cap and moves its cursor on', async () => {
      const secondUserId = await seedUser(testDb.db)
      const thirdUserId = await seedUser(testDb.db)

      for (const owner of [userId, secondUserId, thirdUserId]) {
        await seedFile(owner, `${owner}/drive.pdf`)
      }

      const first = await sweep({ userLimit: 2 })

      expect(first.usersCleaned).toBe(2)
      expect(kv.values.get('google:sweep-cursor')).toBe(String(secondUserId))
      expect(await storageKeysOf(thirdUserId)).toHaveLength(1)

      const second = await sweep({ userLimit: 2 })

      expect(second.usersCleaned).toBe(1)
      expect(await storageKeysOf(thirdUserId)).toEqual([])
      expect(kv.values.get('google:sweep-cursor')).toBe('0')
    })

    it('does not let a failing user starve the next ones', async () => {
      const secondUserId = await seedUser(testDb.db)

      await seedFile(userId, 'u/drive.pdf')
      await seedFile(secondUserId, 's/drive.pdf')
      bucket.delete.mockRejectedValueOnce(new Error('r2 down'))

      const first = await sweep({ userLimit: 1 })

      expect(first.incompleteUsers).toBe(1)

      await sweep({ userLimit: 1 })

      expect(await storageKeysOf(secondUserId)).toEqual([])
    })

    it('stops at its file budget', async () => {
      const secondUserId = await seedUser(testDb.db)

      await seedFile(userId, 'u/drive-a.pdf')
      await seedFile(userId, 'u/drive-b.pdf')
      await seedFile(secondUserId, 's/drive.pdf')

      const result = await sweep({ fileBudget: 2 })

      expect(result.filesDeleted).toBe(2)
      expect(await storageKeysOf(secondUserId)).toEqual(['s/drive.pdf'])
    })

    it('keeps a revoked row while its files could not be deleted',
      async () => {
        await seedConnection(userId, 'revoked')
        await seedFile(userId, 'u/drive-a.pdf')
        bucket.delete.mockRejectedValueOnce(new Error('r2 down'))

        const result = await sweep()

        expect(result.incompleteUsers).toBe(1)
        expect(result.revokedRowsDeleted).toBe(0)
      })

    it('cleans the copies of a user whose only active link is the own client',
      async () => {
        await seedConnection(userId, 'revoked', 'besidka')
        await seedConnection(userId, 'active', 'byo')
        await seedFile(userId, 'u/drive-a.pdf')

        const result = await sweep()

        expect(result.filesDeleted).toBe(1)
        expect(result.revokedRowsDeleted).toBe(1)
        expect(await storageKeysOf(userId)).toEqual([])

        const rows = await testDb.db
          .select({ clientMode: schema.googleConnections.clientMode })
          .from(schema.googleConnections)

        expect(rows).toEqual([{ clientMode: 'byo' }])
      })
  })
})
