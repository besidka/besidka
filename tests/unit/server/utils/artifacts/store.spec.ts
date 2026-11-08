import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { ARTIFACT_KINDS as PROTOCOL_ARTIFACT_KINDS } from '@besidka/artifacts-protocol'
import * as schema from '~~/server/db/schema'
import {
  ARTIFACT_KINDS,
  ARTIFACT_MAX_VERSIONS,
  ARTIFACT_USER_QUOTA_BYTES,
  ARTIFACT_VERSION_MAX_BYTES,
} from '#shared/utils/artifacts'
import {
  createMemoryExtractionTestDb,
  seedChat,
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

const {
  appendArtifactVersion,
  createArtifact,
  decodeArtifactId,
  deleteArtifacts,
  detachArtifactsFromChats,
  getArtifactUsageBytes,
  purgeUserArtifacts,
  readArtifactVersion,
} = await import('~~/server/utils/artifacts/store')
const { sweepClosedArtifactReports } = await import(
  '~~/server/utils/artifacts/report-retention'
)

const logger = { set: vi.fn() }

describe('artifact store', () => {
  let testDb: MemoryExtractionTestDb
  let storage: MemoryBlobStore
  let userId: number
  let otherUserId: number

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    storage = createMemoryBlobStore()
    userId = await seedUser(testDb.db, null)
    otherUserId = await seedUser(testDb.db, null)
    logger.set.mockClear()
  })

  afterEach(() => {
    testDb.close()
  })

  type CreateInput = Parameters<typeof createArtifact>[0]

  function create(overrides: Partial<CreateInput> = {}) {
    return createArtifact({
      db: testDb.db,
      storage,
      userId,
      kind: 'html',
      title: 'Photosynthesis quiz',
      content: '<p>Question 1</p>',
      createdVia: 'chat',
      createdBy: 'model',
      logger,
      ...overrides,
    })
  }

  function readRows() {
    return {
      artifacts: testDb.sqlite.prepare('select * from artifacts').all(),
      versions: testDb.sqlite.prepare(
        'select * from artifact_versions order by version',
      ).all() as Array<Record<string, any>>,
    }
  }

  it('keeps the kind list in step with the runtime protocol', () => {
    expect([...ARTIFACT_KINDS]).toEqual([...PROTOCOL_ARTIFACT_KINDS])
  })

  describe('createArtifact', () => {
    it('writes the R2 object and both rows', async () => {
      const chat = await seedChat(testDb.db, userId)
      const result = await create({
        originChatId: chat.id,
        originMessageId: 'assistant-1',
        modelId: 'claude-opus-5',
      })

      expect(result).toEqual({
        artifactId: expect.stringMatching(/^pub-\d+$/),
        version: 1,
        kind: 'html',
        title: 'Photosynthesis quiz',
      })

      const internalId = decodeArtifactId(result.artifactId)
      const { artifacts, versions } = readRows()

      expect(artifacts).toEqual([expect.objectContaining({
        id: internalId,
        user_id: userId,
        origin_chat_id: Number(chat.id.slice(4)),
        origin_message_id: 'assistant-1',
        current_version: 1,
        total_bytes: 17,
        created_via: 'chat',
      })])
      expect(versions).toHaveLength(1)
      expect(versions[0]!.r2_key).toMatch(
        new RegExp(`^artifacts/${userId}/${internalId}/v1-[0-9a-f-]{36}$`),
      )
      expect(versions[0]!.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(versions[0]!.model_id).toBe('claude-opus-5')
      expect(storage.objects.get(versions[0]!.r2_key)).toBe('<p>Question 1</p>')
    })

    it('accepts exactly the version limit and rejects one byte more', async () => {
      await expect(create({
        content: 'a'.repeat(ARTIFACT_VERSION_MAX_BYTES),
      })).resolves.toMatchObject({ version: 1 })

      await expect(create({
        content: 'a'.repeat(ARTIFACT_VERSION_MAX_BYTES + 1),
      })).rejects.toMatchObject({
        status: 413,
        code: 'artifact_too_large',
      })
    })

    it('counts UTF-8 bytes, not characters', async () => {
      const cyrillic = 'ж'.repeat(ARTIFACT_VERSION_MAX_BYTES / 2 + 1)

      await expect(create({ content: cyrillic })).rejects.toMatchObject({
        status: 413,
      })
    })

    it('rejects an empty or too long title', async () => {
      await expect(create({ title: '   ' })).rejects.toMatchObject({
        status: 400,
      })
      await expect(create({ title: 'x'.repeat(121) })).rejects.toMatchObject({
        status: 400,
      })
    })

    it('rejects a write that would exceed the quota with used and limit', async () => {
      testDb.sqlite.prepare(`
        insert into artifacts (user_id, kind, title, current_version,
          total_bytes, created_via, created_at, updated_at)
        values (?, 'html', 'Big', 1, ?, 'chat', 1, 1)
      `).run(userId, ARTIFACT_USER_QUOTA_BYTES - 10)

      const exception = await create({ content: 'a'.repeat(11) })
        .catch((error: unknown) => error)

      expect(exception).toMatchObject({
        status: 413,
        code: 'artifact_quota_exceeded',
        fix: 'Delete artifacts in History → Artifacts',
      })
      expect((exception as { why: string }).why).toContain('25.00 MB')
      expect(storage.putCalls).toEqual([])
      await expect(create({ content: 'a'.repeat(10) })).resolves
        .toMatchObject({ version: 1 })
    })

    it('leaves no R2 object and no row when the version insert fails', async () => {
      const originalInsert = testDb.db.insert.bind(testDb.db)

      vi.spyOn(testDb.db, 'insert').mockImplementation(((table: unknown) => {
        if (table === schema.artifactVersions) {
          return {
            values: () => Promise.reject(new Error('D1 unavailable')),
          }
        }

        return originalInsert(table as typeof schema.artifacts)
      }) as typeof testDb.db.insert)

      await expect(create()).rejects.toMatchObject({
        status: 500,
        code: 'artifact_write_failed',
      })
      expect(storage.objects.size).toBe(0)
      expect(storage.deleteCalls).toHaveLength(1)
      expect(readRows().artifacts).toEqual([])
    })

    it('removes the header row when the R2 put fails', async () => {
      vi.mocked(storage.put).mockRejectedValueOnce(new Error('R2 down'))

      await expect(create()).rejects.toMatchObject({ status: 500 })
      expect(readRows().artifacts).toEqual([])
    })
  })

  describe('appendArtifactVersion', () => {
    it('writes a new immutable version and updates the header', async () => {
      const created = await create()
      const result = await appendArtifactVersion({
        db: testDb.db,
        storage,
        userId,
        artifactId: created.artifactId,
        content: '<p>Question 1 changed</p>',
        title: 'Quiz v2',
        createdBy: 'model',
        logger,
      })

      expect(result).toEqual({
        artifactId: created.artifactId,
        version: 2,
        kind: 'html',
        title: 'Quiz v2',
      })

      const { artifacts, versions } = readRows()

      expect(artifacts).toEqual([expect.objectContaining({
        current_version: 2,
        total_bytes: 17 + 25,
        title: 'Quiz v2',
      })])
      expect(versions.map(version => version.version)).toEqual([1, 2])
      expect(storage.objects.size).toBe(2)
    })

    it('refuses the version after the cap with 409', async () => {
      const created = await create()

      testDb.sqlite.prepare(
        'update artifacts set current_version = ? where id = ?',
      ).run(ARTIFACT_MAX_VERSIONS, decodeArtifactId(created.artifactId))

      await expect(appendArtifactVersion({
        db: testDb.db,
        storage,
        userId,
        artifactId: created.artifactId,
        content: 'next',
        createdBy: 'user',
      })).rejects.toMatchObject({
        status: 409,
        code: 'artifact_version_cap',
        message: 'This artifact has reached 50 versions',
        fix: 'Create a new artifact',
      })
    })

    it('answers 404 for another user and for a forged id', async () => {
      const created = await create()

      for (const input of [
        { userId: otherUserId, artifactId: created.artifactId },
        { userId, artifactId: 'not-an-id' },
      ]) {
        await expect(appendArtifactVersion({
          db: testDb.db,
          storage,
          content: 'x',
          createdBy: 'model',
          ...input,
        })).rejects.toMatchObject({ status: 404 })
      }
    })

    it('deletes the new R2 object when the D1 batch fails', async () => {
      const created = await create()

      vi.spyOn(testDb.db, 'batch').mockRejectedValueOnce(new Error('D1 down'))

      await expect(appendArtifactVersion({
        db: testDb.db,
        storage,
        userId,
        artifactId: created.artifactId,
        content: 'v2',
        createdBy: 'model',
        logger,
      })).rejects.toMatchObject({ status: 500 })
      expect(storage.objects.size).toBe(1)
      expect(readRows().artifacts).toEqual([
        expect.objectContaining({ current_version: 1 }),
      ])
    })
  })

  describe('readArtifactVersion', () => {
    it('reads the current version by default and a pinned one on request', async () => {
      const created = await create()

      await appendArtifactVersion({
        db: testDb.db,
        storage,
        userId,
        artifactId: created.artifactId,
        content: 'second',
        createdBy: 'model',
      })

      await expect(readArtifactVersion({
        db: testDb.db,
        storage,
        userId,
        artifactId: created.artifactId,
      })).resolves.toMatchObject({ version: 2, content: 'second' })
      await expect(readArtifactVersion({
        db: testDb.db,
        storage,
        userId,
        artifactId: created.artifactId,
        version: 1,
      })).resolves.toMatchObject({
        version: 1,
        content: '<p>Question 1</p>',
        kind: 'html',
      })
    })

    it('answers 404 for another user, 451 after a takedown, 410 without the object', async () => {
      const created = await create()
      const internalId = decodeArtifactId(created.artifactId)
      const read = (readerId: number) => readArtifactVersion({
        db: testDb.db,
        storage,
        userId: readerId,
        artifactId: created.artifactId,
      })

      await expect(read(otherUserId)).rejects.toMatchObject({ status: 404 })

      storage.objects.clear()
      await expect(read(userId)).rejects.toMatchObject({
        status: 410,
        code: 'artifact_content_missing',
      })

      testDb.sqlite.prepare(
        'update artifacts set takedown_at = 1 where id = ?',
      ).run(internalId)
      await expect(read(userId)).rejects.toMatchObject({
        status: 451,
        code: 'artifact_taken_down',
      })
    })
  })

  describe('deleteArtifacts', () => {
    it('deletes objects in one batch and rows, keeps reports, skips held and foreign ids', async () => {
      const first = await create()
      const second = await create({ title: 'Second' })
      const held = await create({ title: 'Held' })
      const foreign = await create({ userId: otherUserId, title: 'Foreign' })

      await appendArtifactVersion({
        db: testDb.db,
        storage,
        userId,
        artifactId: first.artifactId,
        content: 'v2',
        createdBy: 'model',
      })

      const firstId = decodeArtifactId(first.artifactId)
      const heldId = decodeArtifactId(held.artifactId)
      const future = Math.floor(Date.now() / 1000) + 3600

      testDb.sqlite.prepare(
        'update artifacts set legal_hold_until = ? where id = ?',
      ).run(future, heldId)
      testDb.sqlite.prepare(`
        insert into artifact_reports
          (artifact_id, reason, status, created_at)
        values (?, 'harmful', 'open', 1)
      `).run(firstId)
      testDb.sqlite.prepare(`
        insert into artifact_storage
          (artifact_id, viewer_user_id, key, value, bytes, updated_at)
        values (?, ?, 'score', '1', 1, 1)
      `).run(firstId, userId)

      const result = await deleteArtifacts({
        db: testDb.db,
        storage,
        userId,
        artifactIds: [
          first.artifactId,
          second.artifactId,
          held.artifactId,
          foreign.artifactId,
          'garbage',
        ],
      })

      expect(result).toEqual({
        deletedIds: [first.artifactId, second.artifactId],
        heldIds: [held.artifactId],
        objectsDeleted: 3,
      })
      expect(storage.deleteCalls).toHaveLength(1)
      expect(storage.deleteCalls[0]).toHaveLength(3)
      expect(storage.objects.size).toBe(2)
      expect(readRows().artifacts.map((row: any) => row.title)).toEqual([
        'Held',
        'Foreign',
      ])
      expect(testDb.sqlite.prepare(
        'select count(*) as count from artifact_reports',
      ).get()).toEqual({ count: 1 })
      expect(testDb.sqlite.prepare(
        'select count(*) as count from artifact_storage',
      ).get()).toEqual({ count: 0 })
    })
  })

  describe('detachArtifactsFromChats', () => {
    it('nulls the origin chat of the user and keeps the message id', async () => {
      const chat = await seedChat(testDb.db, userId)
      const otherChat = await seedChat(testDb.db, otherUserId)

      await create({ originChatId: chat.id, originMessageId: 'm-1' })
      await create({
        userId: otherUserId,
        originChatId: otherChat.id,
        title: 'Other',
      })

      const detached = await detachArtifactsFromChats({
        db: testDb.db,
        userId,
        chatIds: [chat.id, otherChat.id],
      })

      expect(detached).toBe(1)

      const rows = testDb.db.select().from(schema.artifacts)
      const artifacts = await rows

      expect(artifacts.map((artifact) => {
        return [artifact.title, artifact.originChatId, artifact.originMessageId]
      })).toEqual([
        ['Photosynthesis quiz', null, 'm-1'],
        ['Other', otherChat.id, null],
      ])
    })
  })

  describe('purgeUserArtifacts', () => {
    it('removes the user artifacts and viewer storage, keeps held and foreign ones', async () => {
      const own = await create()
      const held = await create({ title: 'Held' })
      const foreign = await create({ userId: otherUserId, title: 'Foreign' })
      const heldId = decodeArtifactId(held.artifactId)

      testDb.sqlite.prepare(
        'update artifacts set legal_hold_until = ? where id = ?',
      ).run(Math.floor(Date.now() / 1000) + 3600, heldId)
      testDb.sqlite.prepare(`
        insert into artifact_storage
          (artifact_id, viewer_user_id, key, value, bytes, updated_at)
        values (?, ?, 'score', '1', 1, 1), (?, ?, 'score', '2', 1, 1)
      `).run(
        decodeArtifactId(foreign.artifactId),
        userId,
        decodeArtifactId(foreign.artifactId),
        otherUserId,
      )

      const result = await purgeUserArtifacts({
        db: testDb.db,
        storage,
        userId,
      })

      expect(result).toEqual({
        artifactsDeleted: 1,
        artifactsHeld: 1,
        artifactObjectsDeleted: 1,
        artifactViewerStorageDeleted: 1,
      })
      expect(readRows().artifacts.map((row: any) => row.title)).toEqual([
        'Held',
        'Foreign',
      ])
      expect(await getArtifactUsageBytes(testDb.db, userId)).toBe(17)
      expect(own.artifactId).not.toBe(held.artifactId)
    })
  })

  describe('sweepClosedArtifactReports', () => {
    it('keeps open, recent, copyright-removal and held reports', async () => {
      const now = new Date('2027-12-01T00:00:00.000Z')
      const seconds = (iso: string) => Math.floor(Date.parse(iso) / 1000)
      const held = await create({ title: 'Held' })
      const heldId = decodeArtifactId(held.artifactId)

      testDb.sqlite.prepare(
        'update artifacts set legal_hold_until = ? where id = ?',
      ).run(seconds('2028-06-01T00:00:00.000Z'), heldId)

      const insert = testDb.sqlite.prepare(`
        insert into artifact_reports
          (artifact_id, reason, status, decision, resolved_at, created_at)
        values (?, ?, ?, ?, ?, 1)
      `)

      insert.run(1000, 'harmful', 'actioned', 'removed',
        seconds('2026-11-01T00:00:00.000Z'))
      insert.run(1000, 'other', 'rejected', null,
        seconds('2026-10-01T00:00:00.000Z'))
      insert.run(1000, 'harmful', 'actioned', 'removed',
        seconds('2027-01-01T00:00:00.000Z'))
      insert.run(1000, 'copyright', 'actioned', 'removed',
        seconds('2026-06-01T00:00:00.000Z'))
      insert.run(1000, 'copyright', 'actioned', 'removed',
        seconds('2025-11-01T00:00:00.000Z'))
      insert.run(1000, 'copyright', 'rejected', null,
        seconds('2026-06-01T00:00:00.000Z'))
      insert.run(1000, 'harmful', 'open', null, null)
      insert.run(heldId, 'terrorism', 'actioned', 'removed',
        seconds('2026-01-01T00:00:00.000Z'))

      const deleted = await sweepClosedArtifactReports({
        db: testDb.db,
        now,
      })
      const remaining = testDb.sqlite.prepare(
        'select reason, status, resolved_at from artifact_reports order by id',
      ).all() as Array<{ reason: string, status: string }>

      expect(deleted).toBe(4)
      expect(remaining.map((row) => {
        return `${row.reason}:${row.status}`
      })).toEqual([
        'harmful:actioned',
        'copyright:actioned',
        'harmful:open',
        'terrorism:actioned',
      ])
    })
  })

  it('stores the chat id through the public id type', async () => {
    const chat = await seedChat(testDb.db, userId)
    const created = await create({ originChatId: chat.id })
    const [row] = await testDb.db.select()
      .from(schema.artifacts)
      .where(eq(schema.artifacts.id, decodeArtifactId(created.artifactId)!))

    expect(row?.originChatId).toBe(chat.id)
  })
})
