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
    externalSource: 'google' | null = 'google',
  ) {
    await testDb.db.insert(schema.files).values({
      userId: owner,
      storageKey,
      name: 'File name that must not be logged.pdf',
      size: 10,
      type: 'application/pdf',
      externalSource,
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
      await seedFile(userId, 'u/upload.pdf', null)
      kv.values.set('file-cache:u/drive-a.pdf', 'cached')

      const { deleteGoogleDerivedFiles } = await accessEndedModule()
      const result = await deleteGoogleDerivedFiles({
        db: testDb.db,
        userId,
        logger,
      })

      expect(result).toEqual({ deleted: 2, complete: true })
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

  it('splits more than one batch of files', async () => {
    const { deleteGoogleDerivedFiles, GOOGLE_FILE_CLEANUP_BATCH_SIZE }
      = await accessEndedModule()

    for (let index = 0; index <= GOOGLE_FILE_CLEANUP_BATCH_SIZE; index++) {
      await seedFile(userId, `u/drive-${index}.pdf`)
    }

    const result = await deleteGoogleDerivedFiles({
      db: testDb.db,
      userId,
      logger,
    })

    expect(result).toEqual({
      deleted: GOOGLE_FILE_CLEANUP_BATCH_SIZE + 1,
      complete: true,
    })
    expect(bucket.delete).toHaveBeenCalledTimes(2)
  })

  it('keeps the rows when R2 fails, so a retry can finish', async () => {
    await seedFile(userId, 'u/drive-a.pdf')
    bucket.delete.mockRejectedValueOnce(new Error('r2 down'))

    const { deleteGoogleDerivedFiles } = await accessEndedModule()
    const result = await deleteGoogleDerivedFiles({
      db: testDb.db,
      userId,
      logger,
    })

    expect(result).toEqual({ deleted: 0, complete: false })
    expect(await storageKeysOf(userId)).toEqual(['u/drive-a.pdf'])
  })

  it('leaves other users alone', async () => {
    const otherUserId = await seedUser(testDb.db)

    await seedFile(userId, 'u/drive-a.pdf')
    await seedFile(otherUserId, 'o/drive-a.pdf')

    const { deleteGoogleDerivedFiles } = await accessEndedModule()

    await deleteGoogleDerivedFiles({ db: testDb.db, userId, logger })

    expect(await storageKeysOf(otherUserId)).toEqual(['o/drive-a.pdf'])
  })

  it('skips the cleanup while another mode is active', async () => {
    const ended = await seedConnection(userId, 'needs_reauth')

    await seedConnection(userId, 'active', 'byo')
    await seedFile(userId, 'u/drive-a.pdf')

    const { cleanupAfterGoogleAccessEnded } = await accessEndedModule()
    const result = await cleanupAfterGoogleAccessEnded({
      db: testDb.db,
      userId,
      connectionId: ended,
      logger,
    })

    expect(result).toEqual({ skipped: true, deleted: 0, complete: true })
    expect(bucket.delete).not.toHaveBeenCalled()
  })

  describe('hourly sweep', () => {
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

        const { sweepGoogleAccessEnded } = await accessEndedModule()
        const result = await sweepGoogleAccessEnded({
          db: testDb.db,
          logger,
        })

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

    it('keeps a revoked row while its files could not be deleted',
      async () => {
        await seedConnection(userId, 'revoked')
        await seedFile(userId, 'u/drive-a.pdf')
        bucket.delete.mockRejectedValueOnce(new Error('r2 down'))

        const { sweepGoogleAccessEnded } = await accessEndedModule()
        const result = await sweepGoogleAccessEnded({
          db: testDb.db,
          logger,
        })

        expect(result.incompleteUsers).toBe(1)
        expect(result.revokedRowsDeleted).toBe(0)
      })
  })
})
