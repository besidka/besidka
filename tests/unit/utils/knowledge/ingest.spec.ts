import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { countKnowledgeChars } from '#shared/utils/project-knowledge-budget'
import { KNOWLEDGE_LIMITS } from '#shared/utils/project-knowledge-policy'
import { encodePublicId } from '~~/server/utils/custom-db-types'
import {
  commitKnowledgeProject,
  createKnowledgeNote,
  findKnowledgeRemovalTargets,
  hashKnowledgeText,
  ingestKnowledgeItems,
  normalizeKnowledgeRelativePath,
  removeKnowledgeItems,
  updateKnowledgeItemMetadata,
  updateKnowledgeMode,
  updateKnowledgeNote,
} from '~~/server/utils/knowledge/ingest'
import { knowledgeItemTextKey } from '~~/server/utils/knowledge/storage-keys'
import { createKnowledgeApiHarness } from '../../../setup/helpers/knowledge-api'
import type { KnowledgeApiHarness } from '../../../setup/helpers/knowledge-api'

const mocks = vi.hoisted(() => ({
  invalidateStorageCache: vi.fn(),
  commitKnowledgeChange: vi.fn(),
  loggerSet: vi.fn(),
}))

vi.mock('evlog', () => ({
  createError: (input: {
    message: string
    status?: number
    why?: string
    fix?: string
  }) => {
    const exception = new Error(input.message)

    Object.assign(exception, input)

    return exception
  },
  useLogger: () => ({ set: vi.fn() }),
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

vi.mock('~~/server/api/v1/storage/index.get', () => ({
  invalidateStorageCache: mocks.invalidateStorageCache,
}))

vi.mock('~~/server/utils/knowledge/pack', () => ({
  commitKnowledgeChange: mocks.commitKnowledgeChange,
  ensureKnowledgePackFresh: vi.fn(),
}))

const OWNER = 1
const STRANGER = 2
const PROJECT = 10
const OTHER_PROJECT = 11
const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const FILE_EXPIRY_SECONDS = 1_900_000_000

type BatchInput = Parameters<typeof ingestKnowledgeItems>[1]
type BatchItem = BatchInput['items'][number]

describe('knowledge ingestion', () => {
  let harness: KnowledgeApiHarness

  function context(
    userId: number = OWNER,
    projectId: number = PROJECT,
  ) {
    return { userId, projectId, logger: { set: mocks.loggerSet } }
  }

  function fileItem(overrides: Partial<BatchItem> = {}): BatchItem {
    return {
      title: 'Guide',
      mediaType: 'text/markdown',
      extractor: 'text',
      extractStatus: 'ready',
      text: 'hello world',
      ...overrides,
    } as BatchItem
  }

  async function ingest(
    items: BatchItem[],
    options: { commit?: boolean, userId?: number, projectId?: number } = {},
  ) {
    return await ingestKnowledgeItems(
      context(options.userId, options.projectId),
      { items, commit: options.commit },
    )
  }

  function itemRows(projectId: number = PROJECT) {
    return harness.testDb.sqlite.prepare(
      'select * from project_knowledge_items where project_id = ?'
      + ' order by id',
    ).all(projectId) as Array<Record<string, any>>
  }

  function objectKeys(): string[] {
    return [...harness.bucket.objects.keys()].sort()
  }

  async function expectRejection(
    action: Promise<unknown>,
    expected: { status: number, message?: string },
  ) {
    await expect(action).rejects.toMatchObject(expected)
  }

  beforeEach(() => {
    vi.clearAllMocks()
    harness = createKnowledgeApiHarness()
    harness.install()
    harness.testDb.insertProject({ id: PROJECT, userId: OWNER })
    harness.testDb.insertProject({ id: OTHER_PROJECT, userId: OWNER })
    harness.testDb.insertStorage({ userId: OWNER })
    mocks.invalidateStorageCache.mockResolvedValue(undefined)
    mocks.commitKnowledgeChange.mockImplementation(async (input: {
      userId: number
      projectId: number
      removeItemIds?: number[]
    }) => {
      for (const itemId of input.removeItemIds ?? []) {
        harness.testDb.sqlite.prepare(
          'delete from project_knowledge_items'
          + ' where id = ? and project_id = ? and user_id = ?',
        ).run(itemId, input.projectId, input.userId)
      }

      harness.testDb.sqlite.prepare(
        'update projects set knowledge_version'
        + ' = coalesce(knowledge_version, 0) + 1 where id = ?',
      ).run(input.projectId)

      const row = harness.testDb.getProjectRow(input.projectId)!

      return {
        version: row.knowledge_version,
        packVersion: row.knowledge_pack_version,
      }
    })
  })

  afterEach(() => {
    harness.close()
  })

  describe('ingestKnowledgeItems', () => {
    it('stores rows and text objects with server-computed sizes', async () => {
      const text = 'Привіт world\nsecond line'
      const result = await ingest([fileItem({ text })])
      const [row] = itemRows()
      const counts = countKnowledgeChars(text)

      expect(result.items).toHaveLength(1)
      expect(result.skipped).toEqual([])
      expect(result.items[0]).toMatchObject({
        kind: 'file',
        title: 'Guide',
        fileId: null,
        textBytes: new TextEncoder().encode(text).length,
        latinChars: counts.latinChars,
        cyrillicChars: counts.cyrillicChars,
        otherChars: counts.otherChars,
        extractor: 'text',
        extractStatus: 'ready',
      })
      expect(row).toMatchObject({
        user_id: OWNER,
        project_id: PROJECT,
        text_bytes: new TextEncoder().encode(text).length,
        latin_chars: counts.latinChars,
        cyrillic_chars: counts.cyrillicChars,
      })
      expect(objectKeys()).toEqual([
        knowledgeItemTextKey(OWNER, PROJECT, row!.id),
      ])
      expect(harness.bucket.objects.get(objectKeys()[0]!)).toBe(text)
      expect(mocks.invalidateStorageCache).toHaveBeenCalledWith(
        OWNER,
        expect.anything(),
      )
    })

    it('never trusts client counts or sizes', async () => {
      const item = {
        ...fileItem({ text: 'abc' }),
        latinChars: 9999,
        cyrillicChars: 9999,
        otherChars: 9999,
        textBytes: 9999,
      } as BatchItem

      await ingest([item])

      expect(itemRows()[0]).toMatchObject({
        text_bytes: 3,
        latin_chars: 3,
        cyrillic_chars: 0,
        other_chars: 0,
      })
    })

    it('writes the text objects one after another', async () => {
      await ingest([
        fileItem({ title: 'One', text: 'one' }),
        fileItem({ title: 'Two', text: 'two' }),
        fileItem({ title: 'Three', text: 'three' }),
      ])

      expect(harness.bucket.getMaxInFlight()).toBe(1)
      expect(objectKeys()).toHaveLength(3)
    })

    it('reports state without committing when commit is not set', async () => {
      harness.testDb.sqlite.prepare(
        'update projects set knowledge_version = 4,'
        + ' knowledge_pack_version = 3 where id = ?',
      ).run(PROJECT)

      const result = await ingest([fileItem()])

      expect(mocks.commitKnowledgeChange).not.toHaveBeenCalled()
      expect(result).toMatchObject({ version: 4, packVersion: 3 })
    })

    it('runs the commit flow once when commit is true', async () => {
      const result = await ingest(
        [fileItem({ title: 'One' }), fileItem({ title: 'Two', text: 'two' })],
        { commit: true },
      )

      expect(mocks.commitKnowledgeChange).toHaveBeenCalledOnce()
      expect(mocks.commitKnowledgeChange).toHaveBeenCalledWith(
        expect.objectContaining({ userId: OWNER, projectId: PROJECT }),
      )
      expect(result.version).toBe(1)
    })

    it('does not touch D1 or R2 when the batch fails commit', async () => {
      mocks.commitKnowledgeChange.mockRejectedValue(new Error('build down'))

      await expectRejection(
        ingest([fileItem()], { commit: true }),
        { status: 500 },
      )

      expect(itemRows()).toHaveLength(1)
      expect(objectKeys()).toHaveLength(1)
    })

    it('skips a duplicate content hash and reports its index', async () => {
      harness.testDb.insertItem({
        userId: OWNER,
        projectId: PROJECT,
        contentHash: HASH_A,
      })

      const result = await ingest([
        fileItem({ title: 'Existing', contentHash: HASH_A }),
        fileItem({ title: 'Fresh', contentHash: HASH_B, text: 'fresh' }),
        fileItem({ title: 'Again', contentHash: HASH_B, text: 'fresh' }),
      ])

      expect(result.skipped).toEqual([
        { index: 0, reason: 'duplicate' },
        { index: 2, reason: 'duplicate' },
      ])
      expect(result.items.map((item) => {
        return item.title
      })).toEqual(['Fresh'])
      expect(harness.testDb.countItems(PROJECT)).toBe(2)
      expect(objectKeys()).toHaveLength(1)
    })

    it('writes nothing when every item is a duplicate', async () => {
      harness.testDb.insertItem({
        userId: OWNER,
        projectId: PROJECT,
        contentHash: HASH_A,
      })

      const result = await ingest(
        [fileItem({ contentHash: HASH_A })],
        { commit: true },
      )

      expect(result.items).toEqual([])
      expect(result.skipped).toEqual([{ index: 0, reason: 'duplicate' }])
      expect(harness.bucket.calls).toEqual([])
      expect(mocks.commitKnowledgeChange).not.toHaveBeenCalled()
      expect(mocks.invalidateStorageCache).not.toHaveBeenCalled()
    })

    it('treats the same hash in another project as new', async () => {
      harness.testDb.insertItem({
        userId: OWNER,
        projectId: OTHER_PROJECT,
        contentHash: HASH_A,
      })

      const result = await ingest([fileItem({ contentHash: HASH_A })])

      expect(result.skipped).toEqual([])
      expect(result.items).toHaveLength(1)
    })

    it('recomputes nothing for a no-text item and writes no object', async () => {
      harness.testDb.insertFile({
        id: 5,
        userId: OWNER,
        type: 'application/pdf',
        size: 4096,
        name: 'scan.pdf',
        expiresAt: FILE_EXPIRY_SECONDS,
      })

      const result = await ingest([
        fileItem({
          fileId: encodePublicId(5),
          title: undefined,
          mediaType: undefined,
          extractor: 'client-unpdf',
          extractStatus: 'no-text',
          text: '',
          pageCount: 3,
        }),
      ])

      expect(result.items[0]).toMatchObject({
        title: 'scan.pdf',
        mediaType: 'application/pdf',
        sizeBytes: 4096,
        textBytes: 0,
        extractStatus: 'no-text',
        pageCount: 3,
        fileId: encodePublicId(5),
      })
      expect(harness.bucket.calls).toEqual([])
    })

    it('links a library file and clears its expiry in the same batch', async () => {
      harness.testDb.insertFile({
        id: 5,
        userId: OWNER,
        type: 'application/pdf',
        expiresAt: FILE_EXPIRY_SECONDS,
      })

      expect(harness.testDb.getFileRow(5)?.expires_at)
        .toBe(FILE_EXPIRY_SECONDS)

      await ingest([fileItem({ fileId: encodePublicId(5) })])

      expect(harness.testDb.getFileRow(5)?.expires_at).toBeNull()
      expect(itemRows()[0]).toMatchObject({ file_id: 5, kind: 'file' })
    })

    it('accepts an image original', async () => {
      harness.testDb.insertFile({
        id: 6,
        userId: OWNER,
        type: 'image/png',
        name: 'diagram.png',
      })

      const result = await ingest([
        fileItem({ fileId: encodePublicId(6), text: 'diagram caption' }),
      ])

      expect(result.items[0]).toMatchObject({ mediaType: 'image/png' })
    })

    it('rejects a file that is already linked to the project with 409', async () => {
      harness.testDb.insertFile({ id: 5, userId: OWNER })
      await ingest([fileItem({ fileId: encodePublicId(5) })])

      await expectRejection(
        ingest([fileItem({ fileId: encodePublicId(5), text: 'again' })]),
        { status: 409 },
      )

      expect(harness.testDb.countItems(PROJECT)).toBe(1)
      expect(objectKeys()).toHaveLength(1)
    })

    it('rejects the same file twice in one batch with 409', async () => {
      harness.testDb.insertFile({ id: 5, userId: OWNER })

      await expectRejection(
        ingest([
          fileItem({ fileId: encodePublicId(5) }),
          fileItem({ fileId: encodePublicId(5), text: 'twice' }),
        ]),
        { status: 409 },
      )

      expect(harness.testDb.countItems()).toBe(0)
      expect(harness.bucket.calls).toEqual([])
    })

    it('lets a file be linked to a second project', async () => {
      harness.testDb.insertFile({
        id: 5,
        userId: OWNER,
        expiresAt: FILE_EXPIRY_SECONDS,
      })
      await ingest([fileItem({ fileId: encodePublicId(5) })])

      const result = await ingest(
        [fileItem({ fileId: encodePublicId(5), text: 'second' })],
        { projectId: OTHER_PROJECT },
      )

      expect(result.items).toHaveLength(1)
      expect(harness.testDb.getFileRow(5)?.expires_at).toBeNull()
    })

    it('rejects another user file with 404 and leaves it untouched', async () => {
      harness.testDb.insertFile({
        id: 7,
        userId: STRANGER,
        expiresAt: FILE_EXPIRY_SECONDS,
      })

      await expectRejection(
        ingest([fileItem({ fileId: encodePublicId(7) })]),
        { status: 404 },
      )

      expect(harness.testDb.countItems()).toBe(0)
      expect(harness.testDb.getFileRow(7)?.expires_at)
        .toBe(FILE_EXPIRY_SECONDS)
      expect(harness.bucket.calls).toEqual([])
    })

    it('rejects a missing or malformed file id with 404', async () => {
      await expectRejection(
        ingest([fileItem({ fileId: encodePublicId(99) })]),
        { status: 404 },
      )
      await expectRejection(
        ingest([fileItem({ fileId: 'not-a-public-id' })]),
        { status: 404 },
      )
    })

    it('rejects a file that is not a PDF or an image', async () => {
      harness.testDb.insertFile({ id: 8, userId: OWNER, type: 'text/plain' })
      harness.testDb.insertFile({ id: 9, userId: OWNER, type: 'audio/mpeg' })

      await expectRejection(
        ingest([fileItem({ fileId: encodePublicId(8) })]),
        { status: 400 },
      )
      await expectRejection(
        ingest([fileItem({ fileId: encodePublicId(9) })]),
        { status: 400 },
      )

      expect(harness.testDb.countItems()).toBe(0)
    })

    it('rejects a batch that would pass the item cap with 422', async () => {
      for (
        let count = 0;
        count < KNOWLEDGE_LIMITS.maxItemsPerProject - 1;
        count++
      ) {
        harness.testDb.insertItem({ userId: OWNER, projectId: PROJECT })
      }

      await expect(
        ingest([fileItem({ title: 'A' }), fileItem({ title: 'B' })]),
      ).rejects.toMatchObject({
        status: 422,
        why: expect.stringContaining('500'),
        fix: expect.any(String),
      })

      expect(harness.bucket.calls).toEqual([])
      expect(harness.testDb.countItems(PROJECT))
        .toBe(KNOWLEDGE_LIMITS.maxItemsPerProject - 1)

      const result = await ingest([fileItem({ title: 'Last' })])

      expect(result.items).toHaveLength(1)
    })

    it('rejects a batch that would pass the project text cap with 422', async () => {
      harness.testDb.insertItem({
        userId: OWNER,
        projectId: PROJECT,
        textBytes: KNOWLEDGE_LIMITS.maxProjectTextBytes - 5,
      })

      await expect(
        ingest([fileItem({ text: '123456' })]),
      ).rejects.toMatchObject({
        status: 422,
        why: expect.stringContaining('bytes'),
        fix: expect.any(String),
      })

      expect(harness.bucket.calls).toEqual([])

      const result = await ingest([fileItem({ text: '12345' })])

      expect(result.items).toHaveLength(1)
    })

    it('counts text bytes, not characters, against the project cap', async () => {
      harness.testDb.insertItem({
        userId: OWNER,
        projectId: PROJECT,
        textBytes: KNOWLEDGE_LIMITS.maxProjectTextBytes - 5,
      })

      await expectRejection(
        ingest([fileItem({ text: 'ЄЄЄ' })]),
        { status: 422 },
      )
    })

    it('rejects an upload over the remaining quota with the upload wording', async () => {
      harness.testDb.sqlite.prepare('delete from storages').run()
      harness.testDb.insertStorage({ userId: OWNER, storage: 100 })
      harness.testDb.insertFile({ id: 5, userId: OWNER, size: 60 })

      await expect(
        ingest([fileItem({ text: 'x'.repeat(41) })]),
      ).rejects.toMatchObject({
        status: 413,
        message: 'Not enough storage space. Please delete some files.',
        why: 'The upload is larger than the remaining storage quota',
        fix: 'Delete some files or upload a smaller file',
      })

      expect(harness.testDb.countItems()).toBe(0)
      expect(harness.bucket.calls).toEqual([])

      const result = await ingest([fileItem({ text: 'x'.repeat(40) })])

      expect(result.items).toHaveLength(1)
    })

    it('counts existing knowledge text in the quota', async () => {
      harness.testDb.sqlite.prepare('delete from storages').run()
      harness.testDb.insertStorage({ userId: OWNER, storage: 100 })
      harness.testDb.insertItem({
        userId: OWNER,
        projectId: OTHER_PROJECT,
        textBytes: 90,
      })

      await expectRejection(
        ingest([fileItem({ text: 'x'.repeat(11) })]),
        { status: 413 },
      )
    })

    it('rolls back rows, objects and file expiry when a text write fails', async () => {
      harness.testDb.insertFile({
        id: 5,
        userId: OWNER,
        expiresAt: FILE_EXPIRY_SECONDS,
      })
      harness.bucket.failPutAt = 3

      await expectRejection(
        ingest([
          fileItem({ title: 'One', text: 'one' }),
          fileItem({ title: 'Two', text: 'two' }),
          fileItem({
            title: 'Three',
            text: 'three',
            fileId: encodePublicId(5),
          }),
        ]),
        { status: 500 },
      )

      expect(harness.testDb.countItems()).toBe(0)
      expect(objectKeys()).toEqual([])
      expect(harness.testDb.getFileRow(5)?.expires_at)
        .toBe(FILE_EXPIRY_SECONDS)
      expect(mocks.invalidateStorageCache).toHaveBeenCalled()
      expect(mocks.commitKnowledgeChange).not.toHaveBeenCalled()
    })

    it('rolls back when the first text write fails', async () => {
      harness.bucket.failPutAt = 1

      await expectRejection(ingest([fileItem()]), { status: 500 })

      expect(harness.testDb.countItems()).toBe(0)
      expect(objectKeys()).toEqual([])
    })

    it('keeps other projects untouched when rolling back', async () => {
      harness.testDb.insertItem({
        userId: OWNER,
        projectId: OTHER_PROJECT,
        title: 'Keep me',
      })
      harness.bucket.failPutAt = 2

      await expectRejection(
        ingest([fileItem({ title: 'One' }), fileItem({ title: 'Two' })]),
        { status: 500 },
      )

      expect(harness.testDb.countItems(OTHER_PROJECT)).toBe(1)
      expect(harness.testDb.countItems(PROJECT)).toBe(0)
    })

    it('maps a race-time unique violation to 409 and leaves nothing behind', async () => {
      harness.beforeBatchHooks.push(() => {
        harness.testDb.insertItem({
          userId: OWNER,
          projectId: PROJECT,
          contentHash: HASH_A,
          title: 'Won the race',
        })
      })

      await expectRejection(
        ingest([
          fileItem({ title: 'Fresh', contentHash: HASH_B, text: 'fresh' }),
          fileItem({ title: 'Racy', contentHash: HASH_A, text: 'racy' }),
        ]),
        { status: 409 },
      )

      expect(harness.testDb.countItems(PROJECT)).toBe(1)
      expect(harness.bucket.calls).toEqual([])
    })

    it('maps a race-time linked file to 409 and keeps the file expiry', async () => {
      harness.testDb.insertFile({
        id: 5,
        userId: OWNER,
        expiresAt: FILE_EXPIRY_SECONDS,
      })
      harness.beforeBatchHooks.push(() => {
        harness.testDb.insertItem({
          userId: OWNER,
          projectId: PROJECT,
          fileId: 5,
        })
      })

      await expectRejection(
        ingest([fileItem({ fileId: encodePublicId(5) })]),
        { status: 409 },
      )

      expect(harness.testDb.countItems(PROJECT)).toBe(1)
      expect(harness.testDb.getFileRow(5)?.expires_at)
        .toBe(FILE_EXPIRY_SECONDS)
    })

    it('normalises titles and paths to NFC and keeps them out of R2 keys', async () => {
      const combiningAcute = String.fromCharCode(0x301)
      const decomposed = `cafe${combiningAcute}.md`
      const composed = 'café.md'
      const result = await ingest([
        fileItem({
          title: decomposed,
          relativePath: `docs/${decomposed}`,
          folderId: 'folder-1',
        }),
      ])

      expect(result.items[0]).toMatchObject({
        title: composed,
        relativePath: `docs/${composed}`,
        folderId: 'folder-1',
      })
      expect(objectKeys()[0]).toMatch(/^knowledge\/u1\/p10\/items\/\d+\.md$/)
    })

    it.each([
      '../secret.md',
      'docs/../secret.md',
      '/etc/passwd',
      'docs\\guide.md',
      'docs//guide.md',
      './guide.md',
      'docs/',
      `docs/${String.fromCharCode(0)}guide.md`,
      `docs/guide${String.fromCharCode(10)}.md`,
    ])('rejects the path %j with 400', async (relativePath) => {
      await expectRejection(
        ingest([fileItem({ relativePath })]),
        { status: 400 },
      )

      expect(harness.testDb.countItems()).toBe(0)
      expect(harness.bucket.calls).toEqual([])
    })
  })

  describe('normalizeKnowledgeRelativePath', () => {
    it('accepts a plain nested path', () => {
      expect(normalizeKnowledgeRelativePath('docs/api/guide.md'))
        .toBe('docs/api/guide.md')
    })

    it('rejects a path over the length cap', () => {
      const longPath = 'a/'.repeat(KNOWLEDGE_LIMITS.maxRelativePathChars)

      expect(() => normalizeKnowledgeRelativePath(longPath))
        .toThrowError()
    })
  })

  describe('hashKnowledgeText', () => {
    it('returns the lowercase hex SHA-256 of the UTF-8 text', async () => {
      expect(await hashKnowledgeText('abc')).toBe(
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      )
    })
  })

  describe('notes', () => {
    async function createNote(
      overrides: Partial<Parameters<typeof createKnowledgeNote>[1]> = {},
      userId: number = OWNER,
    ) {
      return await createKnowledgeNote(context(userId), {
        title: 'Plan',
        body: 'Ship the thing.',
        ...overrides,
      })
    }

    async function selectRow() {
      return await harness.testDb.db.query.projectKnowledgeItems
        .findFirst({ where: { projectId: PROJECT } })
    }

    function noteRowByPublicId(publicId: string) {
      return itemRows().find((row) => {
        return encodePublicId(row.id) === publicId
      })
    }

    it('creates a note with a server-side hash and commits once', async () => {
      const note = await createNote({ description: 'Roadmap' })
      const row = noteRowByPublicId(note.id)

      expect(note).toMatchObject({
        kind: 'note',
        title: 'Plan',
        description: 'Roadmap',
        fileId: null,
        extractor: 'note',
        extractStatus: 'ready',
        textBytes: 15,
      })
      expect(row?.content_hash).toBe(await hashKnowledgeText('Ship the thing.'))
      expect(harness.bucket.objects.get(
        knowledgeItemTextKey(OWNER, PROJECT, row!.id),
      )).toBe('Ship the thing.')
      expect(mocks.commitKnowledgeChange).toHaveBeenCalledOnce()
      expect(mocks.invalidateStorageCache).toHaveBeenCalled()
    })

    it('rejects an identical note body with 409 and writes nothing', async () => {
      await createNote()
      mocks.commitKnowledgeChange.mockClear()
      harness.bucket.calls.length = 0

      await expectRejection(
        createNote({ title: 'Other title' }),
        { status: 409 },
      )

      expect(harness.testDb.countItems(PROJECT)).toBe(1)
      expect(harness.bucket.calls).toEqual([])
      expect(mocks.commitKnowledgeChange).not.toHaveBeenCalled()
    })

    it('rejects a whitespace-only body', async () => {
      await expectRejection(createNote({ body: '   \n ' }), { status: 400 })

      expect(harness.testDb.countItems()).toBe(0)
    })

    it('rolls a note back when its text write fails', async () => {
      harness.bucket.failPutAt = 1

      await expectRejection(createNote(), { status: 500 })

      expect(harness.testDb.countItems()).toBe(0)
      expect(mocks.commitKnowledgeChange).not.toHaveBeenCalled()
    })

    it('enforces the caps and quota for notes', async () => {
      harness.testDb.insertItem({
        userId: OWNER,
        projectId: PROJECT,
        textBytes: KNOWLEDGE_LIMITS.maxProjectTextBytes - 3,
      })

      await expectRejection(createNote({ body: 'abcd' }), { status: 422 })

      harness.testDb.sqlite.prepare('delete from storages').run()
      harness.testDb.insertStorage({ userId: OWNER, storage: 10 })
      harness.testDb.sqlite.prepare(
        'delete from project_knowledge_items',
      ).run()

      await expectRejection(
        createNote({ body: 'x'.repeat(11) }),
        { status: 413 },
      )
    })

    it('commits when the title changes and keeps the body object', async () => {
      const note = await createNote()

      mocks.commitKnowledgeChange.mockClear()
      harness.bucket.calls.length = 0

      const updated = await updateKnowledgeNote(
        context(),
        (await selectRow())!,
        { title: 'New title' },
      )

      expect(updated).toMatchObject({ id: note.id, title: 'New title' })
      expect(mocks.commitKnowledgeChange).toHaveBeenCalledOnce()
      expect(harness.bucket.calls).toEqual([])
    })

    it('rewrites the text and recomputes metadata when the body changes', async () => {
      await createNote()

      mocks.commitKnowledgeChange.mockClear()

      const current = (await selectRow())!
      const updated = await updateKnowledgeNote(
        context(),
        current,
        { body: 'Новий текст' },
      )
      const counts = countKnowledgeChars('Новий текст')

      expect(updated).toMatchObject({
        textBytes: new TextEncoder().encode('Новий текст').length,
        cyrillicChars: counts.cyrillicChars,
      })
      expect(itemRows()[0]?.content_hash)
        .toBe(await hashKnowledgeText('Новий текст'))
      expect([...harness.bucket.objects.values()]).toEqual(['Новий текст'])
      expect(mocks.commitKnowledgeChange).toHaveBeenCalledOnce()
    })

    it('does not commit for a description-only edit', async () => {
      await createNote()

      mocks.commitKnowledgeChange.mockClear()

      const updated = await updateKnowledgeNote(
        context(),
        (await selectRow())!,
        { description: 'Short summary' },
      )

      expect(updated.description).toBe('Short summary')
      expect(mocks.commitKnowledgeChange).not.toHaveBeenCalled()
    })

    it('does nothing when the update changes nothing', async () => {
      await createNote()

      mocks.commitKnowledgeChange.mockClear()
      harness.bucket.calls.length = 0

      await updateKnowledgeNote(
        context(),
        (await selectRow())!,
        { title: 'Plan', body: 'Ship the thing.' },
      )

      expect(mocks.commitKnowledgeChange).not.toHaveBeenCalled()
      expect(harness.bucket.calls).toEqual([])
    })

    it('rejects a body identical to another item with 409', async () => {
      await createNote({ title: 'First', body: 'First body' })
      await createNote({ title: 'Second', body: 'Second body' })

      const second = (await harness.testDb.db.query.projectKnowledgeItems
        .findFirst({ where: { title: 'Second' } }))!

      mocks.commitKnowledgeChange.mockClear()
      harness.bucket.calls.length = 0

      await expectRejection(
        updateKnowledgeNote(context(), second, { body: 'First body' }),
        { status: 409 },
      )

      expect(harness.bucket.calls).toEqual([])
      expect(mocks.commitKnowledgeChange).not.toHaveBeenCalled()
    })

    it('puts the previous row back when the new text cannot be written', async () => {
      await createNote()

      const current = (await selectRow())!
      const previous = itemRows()[0]!

      harness.bucket.failPutAt = 2

      await expectRejection(
        updateKnowledgeNote(
          context(),
          current,
          { title: 'Changed', body: 'Different body' },
        ),
        { status: 500 },
      )

      expect(itemRows()[0]).toMatchObject({
        title: previous.title,
        content_hash: previous.content_hash,
        text_bytes: previous.text_bytes,
      })
    })

    it('checks the growth against the quota on update', async () => {
      harness.testDb.sqlite.prepare('delete from storages').run()
      harness.testDb.insertStorage({ userId: OWNER, storage: 30 })
      await createNote({ body: 'x'.repeat(20) })

      await expectRejection(
        updateKnowledgeNote(
          context(),
          (await selectRow())!,
          { body: 'y'.repeat(40) },
        ),
        { status: 413 },
      )

      const updated = await updateKnowledgeNote(
        context(),
        (await selectRow())!,
        { body: 'z'.repeat(30) },
      )

      expect(updated.textBytes).toBe(30)
    })

    it('refuses to update a file item as a note', async () => {
      const [created] = (await ingest([fileItem()])).items

      expect(created).toBeDefined()

      await expectRejection(
        updateKnowledgeNote(
          context(),
          (await selectRow())!,
          { title: 'Hijack' },
        ),
        { status: 404 },
      )
    })
  })

  describe('updateKnowledgeItemMetadata', () => {
    it('updates description, pinned and the native PDF flag without a commit', async () => {
      harness.testDb.insertFile({ id: 5, userId: OWNER })

      await ingest([fileItem({
        fileId: encodePublicId(5),
        mediaType: undefined,
        title: undefined,
        extractor: 'client-unpdf',
      })])

      const current = (await harness.testDb.db.query.projectKnowledgeItems
        .findFirst({ where: { projectId: PROJECT } }))!
      const updated = await updateKnowledgeItemMetadata(context(), current, {
        description: '  Spec sheet  ',
        pinned: true,
        sendAsNativePdf: true,
      })

      expect(updated).toMatchObject({
        description: 'Spec sheet',
        pinned: true,
        sendAsNativePdf: true,
      })
      expect(mocks.commitKnowledgeChange).not.toHaveBeenCalled()
      expect(harness.testDb.getProjectRow(PROJECT)?.knowledge_version)
        .toBeNull()
    })

    it('clears the description with an empty string or null', async () => {
      await ingest([fileItem()])

      const current = (await harness.testDb.db.query.projectKnowledgeItems
        .findFirst({ where: { projectId: PROJECT } }))!

      await updateKnowledgeItemMetadata(
        context(),
        current,
        { description: 'Something' },
      )

      const cleared = await updateKnowledgeItemMetadata(
        context(),
        current,
        { description: '' },
      )

      expect(cleared.description).toBeNull()
    })

    it('rejects the native PDF flag on an item without a PDF original', async () => {
      await ingest([fileItem()])

      const current = (await harness.testDb.db.query.projectKnowledgeItems
        .findFirst({ where: { projectId: PROJECT } }))!

      await expectRejection(
        updateKnowledgeItemMetadata(
          context(),
          current,
          { sendAsNativePdf: true },
        ),
        { status: 422 },
      )
    })

    it('does not update an item of another account', async () => {
      await ingest([fileItem()])

      const current = (await harness.testDb.db.query.projectKnowledgeItems
        .findFirst({ where: { projectId: PROJECT } }))!

      await expectRejection(
        updateKnowledgeItemMetadata(
          context(STRANGER),
          current,
          { pinned: true },
        ),
        { status: 404 },
      )
      expect(itemRows()[0]?.pinned).toBeNull()
    })
  })

  describe('updateKnowledgeMode', () => {
    it('stores the mode and clears it with null without a version bump', async () => {
      expect(await updateKnowledgeMode(context(), 'full')).toBe('full')
      expect(harness.testDb.getProjectRow(PROJECT)).toMatchObject({
        knowledge_mode: 'full',
        knowledge_version: null,
      })
      expect(await updateKnowledgeMode(context(), null)).toBeNull()
      expect(harness.testDb.getProjectRow(PROJECT)?.knowledge_mode)
        .toBeNull()
    })

    it('does not write the mode of another account project', async () => {
      await expectRejection(
        updateKnowledgeMode(context(STRANGER), 'search'),
        { status: 404 },
      )
      expect(harness.testDb.getProjectRow(PROJECT)?.knowledge_mode)
        .toBeNull()
    })
  })

  describe('removeKnowledgeItems', () => {
    async function linkedPdf(fileId: number, projectId: number = PROJECT) {
      harness.testDb.insertFile({
        id: fileId,
        userId: OWNER,
        expiresAt: FILE_EXPIRY_SECONDS,
      })

      await ingest(
        [fileItem({
          fileId: encodePublicId(fileId),
          text: `text ${fileId}`,
        })],
        { projectId },
      )
    }

    function rowFor(projectId: number, fileId: number) {
      return harness.testDb.sqlite.prepare(
        'select id from project_knowledge_items'
        + ' where project_id = ? and file_id = ?',
      ).get(projectId, fileId) as { id: number }
    }

    it('commits with the removal ids and restores the file expiry', async () => {
      await linkedPdf(5)

      const row = rowFor(PROJECT, 5)
      const result = await removeKnowledgeItems(
        context(),
        [{ itemId: row.id, fileId: 5 }],
      )

      expect(mocks.commitKnowledgeChange).toHaveBeenCalledWith(
        expect.objectContaining({ removeItemIds: [row.id] }),
      )
      expect(result).toMatchObject({ removed: 1 })
      expect(harness.testDb.countItems(PROJECT)).toBe(0)

      const restored = harness.testDb.getFileRow(5)?.expires_at

      expect(restored).not.toBeNull()
      expect(restored!).toBeGreaterThan(Date.now() / 1000)
      expect(mocks.invalidateStorageCache).toHaveBeenCalled()
    })

    it('keeps a file non-expiring while another project links it', async () => {
      await linkedPdf(5)
      await ingest(
        [fileItem({ fileId: encodePublicId(5), text: 'other' })],
        { projectId: OTHER_PROJECT },
      )

      await removeKnowledgeItems(
        context(),
        [{ itemId: rowFor(PROJECT, 5).id, fileId: 5 }],
      )

      expect(harness.testDb.getFileRow(5)?.expires_at).toBeNull()
    })

    it('gives the vip tier no expiry back', async () => {
      harness.testDb.sqlite.prepare('delete from storages').run()
      harness.testDb.insertStorage({ userId: OWNER, tier: 'vip' })
      await linkedPdf(5)

      await removeKnowledgeItems(
        context(),
        [{ itemId: rowFor(PROJECT, 5).id, fileId: 5 }],
      )

      expect(harness.testDb.getFileRow(5)?.expires_at).toBeNull()
    })

    it('still refreshes the storage figure when the commit fails', async () => {
      mocks.commitKnowledgeChange.mockRejectedValue(new Error('down'))

      await expectRejection(
        removeKnowledgeItems(context(), [{ itemId: 1, fileId: null }]),
        { status: 500 },
      )

      expect(mocks.invalidateStorageCache).toHaveBeenCalled()
    })
  })

  describe('findKnowledgeRemovalTargets', () => {
    it('scopes ids to the project and reports the rest as skipped', async () => {
      const mine = harness.testDb.insertItem({
        userId: OWNER,
        projectId: PROJECT,
        folderId: 'folder-1',
      })
      const foreignProject = harness.testDb.insertItem({
        userId: OWNER,
        projectId: OTHER_PROJECT,
        folderId: 'folder-1',
      })
      const foreignUser = harness.testDb.insertItem({
        userId: STRANGER,
        projectId: PROJECT,
      })
      const remove = [
        encodePublicId(mine),
        encodePublicId(foreignProject),
        encodePublicId(foreignUser),
        encodePublicId(9999),
        'garbage',
        encodePublicId(mine),
      ]
      const result = await findKnowledgeRemovalTargets(
        context(),
        { remove, folderId: null },
      )

      expect(result.targets).toEqual([{ itemId: mine, fileId: null }])
      expect(result.skipped).toEqual([
        encodePublicId(foreignProject),
        encodePublicId(foreignUser),
        encodePublicId(9999),
        'garbage',
      ])
    })

    it('narrows the removal to the folder when one is given', async () => {
      const inFolder = harness.testDb.insertItem({
        userId: OWNER,
        projectId: PROJECT,
        folderId: 'folder-1',
      })
      const elsewhere = harness.testDb.insertItem({
        userId: OWNER,
        projectId: PROJECT,
        folderId: 'folder-2',
      })
      const result = await findKnowledgeRemovalTargets(context(), {
        remove: [encodePublicId(inFolder), encodePublicId(elsewhere)],
        folderId: 'folder-1',
      })

      expect(result.targets.map((target) => {
        return target.itemId
      })).toEqual([inFolder])
      expect(result.skipped).toEqual([encodePublicId(elsewhere)])
    })

    it('handles more ids than one statement can bind', async () => {
      const ids: number[] = []

      for (let count = 0; count < 120; count++) {
        ids.push(harness.testDb.insertItem({
          userId: OWNER,
          projectId: PROJECT,
        }))
      }

      const result = await findKnowledgeRemovalTargets(context(), {
        remove: ids.map((id) => {
          return encodePublicId(id)
        }),
        folderId: null,
      })

      expect(result.targets).toHaveLength(120)
      expect(result.skipped).toEqual([])
    })
  })

  describe('commitKnowledgeProject', () => {
    it('maps a commit failure to a retryable 500', async () => {
      mocks.commitKnowledgeChange.mockRejectedValue(new Error('boom'))

      await expect(commitKnowledgeProject(context())).rejects.toMatchObject({
        status: 500,
        why: expect.any(String),
        fix: expect.any(String),
      })
    })
  })
})
