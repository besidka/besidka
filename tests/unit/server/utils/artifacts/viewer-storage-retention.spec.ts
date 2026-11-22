import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import {
  createMemoryExtractionTestDb,
  seedUser,
} from '../../../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../../../setup/helpers/memory-extraction-db'
import { createMemoryBlobStore } from '../../../../setup/helpers/artifacts-store'
import type { MemoryBlobStore } from '../../../../setup/helpers/artifacts-store'

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { publicIdMockFactory } = await import(
    '../../../../setup/helpers/public-id-mock'
  )

  return await publicIdMockFactory()
})

const { createArtifact, decodeArtifactId } = await import(
  '~~/server/utils/artifacts/store'
)
const { sweepViewerArtifactStorage } = await import(
  '~~/server/utils/artifacts/viewer-storage-retention'
)

const NOW = new Date('2026-11-09T12:00:00.000Z')
const DAY_MILLISECONDS = 24 * 60 * 60 * 1000
const SECOND_MILLISECONDS = 1000

function daysAgo(days: number, offsetMilliseconds = 0): Date {
  return new Date(
    NOW.getTime() - days * DAY_MILLISECONDS + offsetMilliseconds,
  )
}

function daysAhead(days: number): Date {
  return new Date(NOW.getTime() + days * DAY_MILLISECONDS)
}

describe('sweepViewerArtifactStorage', () => {
  let testDb: MemoryExtractionTestDb
  let storage: MemoryBlobStore
  let ownerId: number
  let viewerId: number
  let artifactInternalId: number
  let shareSequence = 0

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    storage = createMemoryBlobStore()
    ownerId = await seedUser(testDb.db, null)
    viewerId = await seedUser(testDb.db, null)
    artifactInternalId = await createOwnedArtifact()
    shareSequence = 0
  })

  afterEach(() => {
    testDb.close()
  })

  async function createOwnedArtifact(): Promise<number> {
    const created = await createArtifact({
      db: testDb.db,
      storage,
      userId: ownerId,
      kind: 'html',
      title: 'Photosynthesis quiz',
      content: '<p>Question 1</p>',
      createdVia: 'chat',
      createdBy: 'model',
    })

    return decodeArtifactId(created.artifactId) as number
  }

  async function seedRow(
    viewerUserId: number,
    artifactId: number = artifactInternalId,
    key: string = 'progress',
  ) {
    await testDb.db.insert(schema.artifactStorage).values({
      artifactId,
      viewerUserId,
      key,
      value: { score: 3 },
      bytes: 11,
      updatedAt: daysAgo(90),
    })
  }

  async function seedShare(
    values: Partial<typeof schema.artifactShares.$inferInsert> = {},
    artifactId: number = artifactInternalId,
  ) {
    shareSequence += 1

    await testDb.db.insert(schema.artifactShares).values({
      artifactId,
      userId: ownerId,
      tokenHash: `hash-${artifactId}-${shareSequence}`,
      tokenEncrypted: 'encrypted',
      createdVia: 'ui',
      ...values,
    })
  }

  async function readKeys(
    viewerUserId: number,
    artifactId: number = artifactInternalId,
  ): Promise<string[]> {
    const rows = await testDb.db
      .select({ key: schema.artifactStorage.key })
      .from(schema.artifactStorage)
      .where(and(
        eq(schema.artifactStorage.viewerUserId, viewerUserId),
        eq(schema.artifactStorage.artifactId, artifactId),
      ))
      .orderBy(schema.artifactStorage.key)

    return rows.map(row => row.key)
  }

  function sweep() {
    return sweepViewerArtifactStorage({ db: testDb.db, now: NOW })
  }

  describe('after the last share ended', () => {
    it('purges a viewer exactly 30 days after the share was revoked',
      async () => {
        await seedShare({ revokedAt: daysAgo(30) })
        await seedRow(viewerId)

        await expect(sweep()).resolves.toBe(1)
        await expect(readKeys(viewerId)).resolves.toEqual([])
      })

    it('keeps a viewer one second short of the 30 day mark', async () => {
      await seedShare({
        revokedAt: daysAgo(30, SECOND_MILLISECONDS),
      })
      await seedRow(viewerId)

      await expect(sweep()).resolves.toBe(0)
      await expect(readKeys(viewerId)).resolves.toEqual(['progress'])
    })

    it('purges a viewer one second past the 30 day mark', async () => {
      await seedShare({
        revokedAt: daysAgo(30, -SECOND_MILLISECONDS),
      })
      await seedRow(viewerId)

      await expect(sweep()).resolves.toBe(1)
    })

    it('purges after an expired share passed the grace period', async () => {
      await seedShare({ expiresAt: daysAgo(45) })
      await seedRow(viewerId)

      await expect(sweep()).resolves.toBe(1)
    })

    it('keeps rows during the grace period of an expired share', async () => {
      await seedShare({ expiresAt: daysAgo(5) })
      await seedRow(viewerId)

      await expect(sweep()).resolves.toBe(0)
      await expect(readKeys(viewerId)).resolves.toEqual(['progress'])
    })

    it('purges after a share taken down more than 30 days ago', async () => {
      await seedShare({ takedownAt: daysAgo(31) })
      await seedRow(viewerId)

      await expect(sweep()).resolves.toBe(1)
    })

    it('counts a share from its earliest end date', async () => {
      await seedShare({
        revokedAt: daysAgo(31),
        expiresAt: daysAhead(10),
      })
      await seedRow(viewerId)

      await expect(sweep()).resolves.toBe(1)
    })

    it('counts an expired share from its expiry even if revoked later',
      async () => {
        await seedShare({
          revokedAt: daysAgo(2),
          expiresAt: daysAgo(40),
        })
        await seedRow(viewerId)

        await expect(sweep()).resolves.toBe(1)
      })

    it('measures the grace period from the latest ended share', async () => {
      await seedShare({ revokedAt: daysAgo(60) })
      await seedShare({ revokedAt: daysAgo(10) })
      await seedRow(viewerId)

      await expect(sweep()).resolves.toBe(0)
      await expect(readKeys(viewerId)).resolves.toEqual(['progress'])
    })

    it('purges once every share ended more than 30 days ago', async () => {
      await seedShare({ revokedAt: daysAgo(60) })
      await seedShare({ expiresAt: daysAgo(31) })
      await seedRow(viewerId)

      await expect(sweep()).resolves.toBe(1)
    })
  })

  describe('while a share is active', () => {
    it('keeps rows for a share without any end date', async () => {
      await seedShare()
      await seedRow(viewerId)

      await expect(sweep()).resolves.toBe(0)
      await expect(readKeys(viewerId)).resolves.toEqual(['progress'])
    })

    it('keeps rows for a share that expires in the future', async () => {
      await seedShare({ expiresAt: daysAhead(3) })
      await seedRow(viewerId)

      await expect(sweep()).resolves.toBe(0)
    })

    it('keeps rows when an active share sits next to an old revoked one',
      async () => {
        await seedShare({ revokedAt: daysAgo(120) })
        await seedShare()
        await seedRow(viewerId)

        await expect(sweep()).resolves.toBe(0)
        await expect(readKeys(viewerId)).resolves.toEqual(['progress'])
      })
  })

  describe('without any share', () => {
    it('purges rows of a viewer who is not the owner', async () => {
      await seedRow(viewerId)

      await expect(sweep()).resolves.toBe(1)
      await expect(readKeys(viewerId)).resolves.toEqual([])
    })
  })

  describe('takedown and deletion of the artifact', () => {
    it('purges viewer rows at once when the artifact is taken down',
      async () => {
        await seedShare()
        await seedRow(viewerId)
        testDb.sqlite.prepare(
          'update artifacts set takedown_at = ? where id = ?',
        ).run(Math.floor(NOW.getTime() / 1000) - 1, artifactInternalId)

        await expect(sweep()).resolves.toBe(1)
        await expect(readKeys(viewerId)).resolves.toEqual([])
      })

    it('purges viewer rows when the artifact no longer exists', async () => {
      await seedShare()
      await seedRow(viewerId)
      testDb.sqlite.prepare('delete from artifacts where id = ?')
        .run(artifactInternalId)

      await expect(sweep()).resolves.toBe(1)
      await expect(readKeys(viewerId)).resolves.toEqual([])
    })

    it('purges rows saved for an artifact id that never existed', async () => {
      await seedRow(viewerId, 9999)

      await expect(sweep()).resolves.toBe(1)
    })
  })

  describe('owner rows', () => {
    it('never purges the owner when no share exists', async () => {
      await seedRow(ownerId)

      await expect(sweep()).resolves.toBe(0)
      await expect(readKeys(ownerId)).resolves.toEqual(['progress'])
    })

    it('never purges the owner after every share ended long ago',
      async () => {
        await seedShare({ revokedAt: daysAgo(400) })
        await seedRow(ownerId)

        await expect(sweep()).resolves.toBe(0)
        await expect(readKeys(ownerId)).resolves.toEqual(['progress'])
      })

    it('never purges the owner of a taken-down artifact', async () => {
      await seedRow(ownerId)
      testDb.sqlite.prepare(
        'update artifacts set takedown_at = ? where id = ?',
      ).run(Math.floor(NOW.getTime() / 1000) - 1, artifactInternalId)

      await expect(sweep()).resolves.toBe(0)
      await expect(readKeys(ownerId)).resolves.toEqual(['progress'])
    })

    it('purges only the viewer when both saved progress', async () => {
      await seedRow(ownerId)
      await seedRow(viewerId)

      await expect(sweep()).resolves.toBe(1)
      await expect(readKeys(ownerId)).resolves.toEqual(['progress'])
      await expect(readKeys(viewerId)).resolves.toEqual([])
    })
  })

  describe('isolation between artifacts', () => {
    it('judges every artifact by its own shares', async () => {
      const keptArtifactId = await createOwnedArtifact()

      await seedShare({ revokedAt: daysAgo(90) })
      await seedShare({}, keptArtifactId)
      await seedRow(viewerId)
      await seedRow(viewerId, keptArtifactId, 'kept')

      await expect(sweep()).resolves.toBe(1)
      await expect(readKeys(viewerId)).resolves.toEqual([])
      await expect(readKeys(viewerId, keptArtifactId))
        .resolves.toEqual(['kept'])
    })

    it('counts every purged row of every viewer', async () => {
      const otherViewerId = await seedUser(testDb.db, null)

      await seedRow(viewerId, artifactInternalId, 'first')
      await seedRow(viewerId, artifactInternalId, 'second')
      await seedRow(otherViewerId, artifactInternalId, 'first')

      await expect(sweep()).resolves.toBe(3)
    })
  })

  it('uses the current time when none is passed', async () => {
    await seedShare({ revokedAt: new Date(Date.now() - 31 * DAY_MILLISECONDS) })
    await seedRow(viewerId)

    await expect(sweepViewerArtifactStorage({ db: testDb.db }))
      .resolves.toBe(1)
  })
})
