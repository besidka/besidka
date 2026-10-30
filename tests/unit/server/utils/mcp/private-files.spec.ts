import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { encodePublicId } from '~~/server/utils/custom-db-types'
import { createKnowledgeTestDb } from '../../../../setup/helpers/knowledge-db'
import type { KnowledgeTestDb } from '../../../../setup/helpers/knowledge-db'

const mocks = vi.hoisted(() => {
  return {
    persistFile: vi.fn(),
    deleteOwnedFiles: vi.fn(),
    getObject: vi.fn(),
    logger: { set: vi.fn() },
  }
})

vi.mock('~~/server/utils/files/persist-file', () => {
  return { persistFile: mocks.persistFile }
})

vi.mock('~~/server/utils/files/delete-files', () => {
  return { deleteOwnedFiles: mocks.deleteOwnedFiles }
})

const OWNER = 1
const STRANGER = 2
const MEGABYTE = 1024 * 1024

describe('mcp file tools', () => {
  let testDb: KnowledgeTestDb

  function fileId(id: number): string {
    return encodePublicId(id)
  }

  function storedName(id: number): string | undefined {
    const row = testDb.sqlite.prepare('select name from files where id = ?')
      .get(id) as { name: string } | undefined

    return row?.name
  }

  function storeObject(text: string) {
    mocks.getObject.mockResolvedValue({ text: async () => text })
  }

  async function load() {
    return await import('~~/server/utils/mcp/private/files')
  }

  beforeEach(() => {
    vi.resetModules()
    mocks.persistFile.mockReset()
    mocks.deleteOwnedFiles.mockReset()
    mocks.getObject.mockReset()
    mocks.logger.set.mockReset()
    testDb = createKnowledgeTestDb()
    vi.stubGlobal('useDb', () => testDb.db)
    vi.stubGlobal('useFileStorage', () => {
      return { get: mocks.getObject }
    })
    testDb.insertStorage({ userId: OWNER, storage: 100 * MEGABYTE })
    testDb.insertFile({
      id: 1,
      userId: OWNER,
      name: 'notes.md',
      type: 'text/plain',
      size: 2048,
      storageKey: 'key-1',
      createdAt: 1_000,
    })
    testDb.insertFile({
      id: 2,
      userId: OWNER,
      name: 'scan.pdf',
      type: 'application/pdf',
      size: 4096,
      storageKey: 'key-2',
      createdAt: 2_000,
    })
    testDb.insertFile({
      id: 3,
      userId: OWNER,
      name: 'generated.png',
      type: 'image/png',
      size: 512,
      source: 'assistant',
      storageKey: 'key-3',
      createdAt: 3_000,
    })
    testDb.insertFile({
      id: 4,
      userId: OWNER,
      name: 'project-brief.txt',
      type: 'text/plain',
      size: 100,
      storageKey: 'key-4',
      createdAt: 4_000,
    })
    testDb.insertFile({
      id: 5,
      userId: STRANGER,
      name: 'stranger.txt',
      type: 'text/plain',
      size: 100,
      storageKey: 'key-5',
    })
    testDb.insertItem({
      userId: OWNER,
      projectId: 10,
      kind: 'file',
      fileId: 4,
    })
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  describe('listMcpFiles', () => {
    it('lists the files the web list shows, newest first', async () => {
      const { listMcpFiles } = await load()
      const result = await listMcpFiles(testDb.db, OWNER, {})

      expect(result.files.map(file => file.name)).toEqual([
        'generated.png',
        'scan.pdf',
        'notes.md',
      ])
      expect(result.total).toBe(3)
      expect(result.nextOffset).toBeNull()
      expect(result.files[0]).toEqual({
        id: fileId(3),
        name: 'generated.png',
        type: 'image/png',
        size: 512,
        source: 'assistant',
        createdAt: '1970-01-01T00:50:00.000Z',
        expiresAt: null,
      })
    })

    it('filters by source and marks project files as linked', async () => {
      const { listMcpFiles } = await load()
      const uploads = await listMcpFiles(testDb.db, OWNER, {
        source: 'upload',
      })
      const assistant = await listMcpFiles(testDb.db, OWNER, {
        source: 'assistant',
      })
      const project = await listMcpFiles(testDb.db, OWNER, {
        source: 'project',
      })

      expect(uploads.files.map(file => file.name))
        .toEqual(['scan.pdf', 'notes.md'])
      expect(assistant.files.map(file => file.name)).toEqual(['generated.png'])
      expect(project.files).toHaveLength(1)
      expect(project.files[0]).toMatchObject({
        name: 'project-brief.txt',
        linkedToProject: true,
      })
      expect(uploads.files[0]).not.toHaveProperty('linkedToProject')
    })

    it('never lists another user file', async () => {
      const { listMcpFiles } = await load()

      for (const source of ['all', 'upload', 'assistant', 'project'] as const) {
        const result = await listMcpFiles(testDb.db, OWNER, { source })

        expect(result.files.map(file => file.name))
          .not.toContain('stranger.txt')
      }
    })

    it('searches names with the wildcard characters taken literally',
      async () => {
        testDb.insertFile({ id: 6, userId: OWNER, name: '100%_done.txt' })
        testDb.insertFile({ id: 7, userId: OWNER, name: '100x-done.txt' })

        const { listMcpFiles } = await load()
        const percent = await listMcpFiles(testDb.db, OWNER, { search: '%' })
        const plain = await listMcpFiles(testDb.db, OWNER, { search: 'NOTES' })

        expect(percent.files.map(file => file.name))
          .toEqual(['100%_done.txt'])
        expect(plain.files.map(file => file.name)).toEqual(['notes.md'])
      })

    it('pages with offset and limit and clamps the limit', async () => {
      const { listMcpFiles } = await load()
      const firstPage = await listMcpFiles(testDb.db, OWNER, { limit: 2 })
      const secondPage = await listMcpFiles(testDb.db, OWNER, {
        limit: 2,
        offset: firstPage.nextOffset ?? 0,
      })
      const clamped = await listMcpFiles(testDb.db, OWNER, { limit: 500 })

      expect(firstPage.files).toHaveLength(2)
      expect(firstPage.nextOffset).toBe(2)
      expect(firstPage.total).toBe(3)
      expect(secondPage.files.map(file => file.name)).toEqual(['notes.md'])
      expect(secondPage.nextOffset).toBeNull()
      expect(clamped.files).toHaveLength(3)
    })

    it('reports the storage usage and policy of the user', async () => {
      const { listMcpFiles } = await load()
      const result = await listMcpFiles(testDb.db, OWNER, {})

      expect(result.storage).toEqual({
        usedBytes: 2048 + 4096 + 512 + 100,
        totalBytes: 100 * MEGABYTE,
        retentionDays: 30,
        tier: 'free',
      })
    })
  })

  describe('readMcpFile', () => {
    it('reads a text file and pages with nextOffset', async () => {
      storeObject('abcdefghij')

      const { readMcpFile } = await load()
      const firstPage = await readMcpFile(testDb.db, OWNER, {
        fileId: fileId(1),
        maxChars: 4,
      })
      const lastPage = await readMcpFile(testDb.db, OWNER, {
        fileId: fileId(1),
        offset: 8,
        maxChars: 4,
      })

      expect(mocks.getObject).toHaveBeenCalledWith('key-1')
      expect(firstPage).toEqual({
        id: fileId(1),
        name: 'notes.md',
        type: 'text/plain',
        text: 'abcd',
        offset: 0,
        totalChars: 10,
        nextOffset: 4,
      })
      expect(lastPage).toMatchObject({
        text: 'ij',
        offset: 8,
        nextOffset: null,
      })
    })

    it('refuses a file that is not text', async () => {
      const { readMcpFile } = await load()

      await expect(readMcpFile(testDb.db, OWNER, {
        fileId: fileId(2),
      })).rejects.toMatchObject({
        status: 400,
        message: 'Only text files can be read here; this is application/pdf.',
      })
      await expect(readMcpFile(testDb.db, OWNER, {
        fileId: fileId(3),
      })).rejects.toMatchObject({ status: 400 })
      expect(mocks.getObject).not.toHaveBeenCalled()
    })

    it('accepts markdown and csv media types', async () => {
      storeObject('a,b')
      testDb.insertFile({
        id: 8,
        userId: OWNER,
        type: 'text/csv; charset=utf-8',
        size: 3,
      })

      const { readMcpFile } = await load()
      const result = await readMcpFile(testDb.db, OWNER, {
        fileId: fileId(8),
      })

      expect(result.text).toBe('a,b')
    })

    it('answers 404 for another user file and for malformed ids',
      async () => {
        const { readMcpFile } = await load()

        await expect(readMcpFile(testDb.db, OWNER, {
          fileId: fileId(5),
        })).rejects.toMatchObject({ status: 404 })
        await expect(readMcpFile(testDb.db, OWNER, {
          fileId: 'not-a-file-id',
        })).rejects.toMatchObject({ status: 404 })
        await expect(readMcpFile(testDb.db, OWNER, {
          fileId: fileId(99),
        })).rejects.toMatchObject({ status: 404 })
        expect(mocks.getObject).not.toHaveBeenCalled()
      })

    it('answers 404 when the stored object is gone', async () => {
      mocks.getObject.mockResolvedValue(null)

      const { readMcpFile } = await load()

      await expect(readMcpFile(testDb.db, OWNER, {
        fileId: fileId(1),
      })).rejects.toMatchObject({ status: 404 })
    })

    it('refuses a text file larger than the 2 MiB read cap', async () => {
      testDb.insertFile({
        id: 9,
        userId: OWNER,
        type: 'text/plain',
        size: 2 * MEGABYTE + 1,
      })

      const { readMcpFile } = await load()

      await expect(readMcpFile(testDb.db, OWNER, {
        fileId: fileId(9),
      })).rejects.toMatchObject({ status: 400 })
      expect(mocks.getObject).not.toHaveBeenCalled()
    })
  })

  describe('createMcpFile', () => {
    beforeEach(() => {
      mocks.persistFile.mockImplementation(async (input: {
        fileName: string
        mediaType: string
        fileData: Uint8Array
      }) => {
        return {
          id: fileId(50),
          storageKey: 'new-key',
          name: input.fileName,
          size: input.fileData.byteLength,
          type: input.mediaType,
          source: 'upload',
          expiresAt: null,
        }
      })
    })

    it('stores the text as text/plain with the upload policy arguments',
      async () => {
        const { createMcpFile } = await load()
        const result = await createMcpFile(
          OWNER,
          { name: '  report.md ', text: 'héllo' },
          mocks.logger,
        )
        const [call] = mocks.persistFile.mock.calls[0]!

        expect(call).toMatchObject({
          userId: OWNER,
          fileName: 'report.md',
          mediaType: 'text/plain',
          quotaSizeBytes: 6,
          source: 'upload',
          totalFilesSize: 2048 + 4096 + 512 + 100,
          logger: mocks.logger,
        })
        expect(new TextDecoder().decode(call.fileData)).toBe('héllo')
        expect(call.policy).toMatchObject({
          maxStorageBytes: 100 * MEGABYTE,
          tier: 'free',
        })
        expect(result).toMatchObject({
          id: fileId(50),
          name: 'report.md',
          type: 'text/plain',
          size: 6,
          source: 'upload',
        })
      })

    it('refuses a text larger than the remaining quota with a 413',
      async () => {
        testDb.sqlite.prepare('update storages set storage = ?')
          .run(6_900)

        const { createMcpFile } = await load()

        await expect(createMcpFile(
          OWNER,
          { name: 'big.txt', text: 'x'.repeat(500) },
          mocks.logger,
        )).rejects.toMatchObject({
          status: 413,
          message: 'Not enough storage space. Please delete some files.',
        })
        expect(mocks.persistFile).not.toHaveBeenCalled()
      })

    it('passes a persistFile quota error through', async () => {
      mocks.persistFile.mockRejectedValue(Object.assign(
        new Error('Not enough storage space. Please delete some files.'),
        { status: 400 },
      ))

      const { createMcpFile } = await load()

      await expect(createMcpFile(
        OWNER,
        { name: 'a.txt', text: 'hello' },
        mocks.logger,
      )).rejects.toMatchObject({ status: 400 })
    })

    it('rejects names with invisible or control characters', async () => {
      const { createMcpFile } = await load()

      for (const name of ['re‮port.md', 'zero​width.md', 'a\u0000b']) {
        await expect(createMcpFile(
          OWNER,
          { name, text: 'hello' },
          mocks.logger,
        )).rejects.toMatchObject({ status: 400 })
      }

      expect(mocks.persistFile).not.toHaveBeenCalled()
    })

    it('rejects empty and over-long names and bad text lengths', async () => {
      const { createMcpFile } = await load()
      const invalidInputs = [
        { name: '   ', text: 'hello' },
        { name: 'x'.repeat(256), text: 'hello' },
        { name: 'a.md', text: '' },
        { name: 'a.md', text: 'x'.repeat(200_001) },
      ]

      for (const input of invalidInputs) {
        await expect(createMcpFile(OWNER, input, mocks.logger))
          .rejects.toMatchObject({ status: 400 })
      }

      expect(mocks.persistFile).not.toHaveBeenCalled()
    })
  })

  describe('renameMcpFile', () => {
    it('renames an owned file', async () => {
      const { renameMcpFile } = await load()
      const result = await renameMcpFile(testDb.db, OWNER, {
        fileId: fileId(1),
        name: '  renamed.md ',
      })

      expect(result).toEqual({ id: fileId(1), name: 'renamed.md' })
      expect(storedName(1)).toBe('renamed.md')
    })

    it('answers 404 for another user file and changes nothing', async () => {
      const { renameMcpFile } = await load()

      await expect(renameMcpFile(testDb.db, OWNER, {
        fileId: fileId(5),
        name: 'taken.txt',
      })).rejects.toMatchObject({ status: 404 })
      await expect(renameMcpFile(testDb.db, OWNER, {
        fileId: 'bogus',
        name: 'taken.txt',
      })).rejects.toMatchObject({ status: 404 })
      expect(storedName(5)).toBe('stranger.txt')
    })

    it('rejects invisible characters and bad lengths', async () => {
      const { renameMcpFile } = await load()

      for (const name of ['', 'x'.repeat(256), 'a‏b', 'a\nb']) {
        await expect(renameMcpFile(testDb.db, OWNER, {
          fileId: fileId(1),
          name,
        })).rejects.toMatchObject({ status: 400 })
      }

      expect(storedName(1)).toBe('notes.md')
    })
  })

  describe('deleteMcpFiles', () => {
    it('reports deleted ids and skips with a reason', async () => {
      mocks.deleteOwnedFiles.mockResolvedValue({
        deleted: [fileId(1)],
        notFound: [fileId(5)],
        failed: [fileId(2)],
        errored: [fileId(6)],
      })

      const { deleteMcpFiles } = await load()
      const result = await deleteMcpFiles(OWNER, {
        fileIds: [
          fileId(1),
          fileId(5),
          fileId(2),
          fileId(6),
          'not-a-file-id',
        ],
      }, mocks.logger)

      expect(mocks.deleteOwnedFiles).toHaveBeenCalledWith({
        userId: OWNER,
        fileIds: [fileId(1), fileId(5), fileId(2), fileId(6)],
        logger: mocks.logger,
      })
      expect(result).toEqual({
        deleted: [fileId(1)],
        skipped: [
          { id: 'not-a-file-id', reason: 'not_found' },
          { id: fileId(5), reason: 'not_found' },
          { id: fileId(2), reason: 'storage_error' },
          { id: fileId(6), reason: 'error' },
        ],
      })
    })

    it('sends each id once and skips the call for malformed ids only',
      async () => {
        mocks.deleteOwnedFiles.mockResolvedValue({
          deleted: [],
          notFound: [],
          failed: [],
          errored: [],
        })

        const { deleteMcpFiles } = await load()
        const result = await deleteMcpFiles(OWNER, {
          fileIds: [fileId(1), fileId(1)],
        }, mocks.logger)

        expect(mocks.deleteOwnedFiles).toHaveBeenCalledWith(
          expect.objectContaining({ fileIds: [fileId(1)] }),
        )
        expect(result.skipped).toEqual([])
      })

    it('refuses an empty list and more than 100 ids', async () => {
      const { deleteMcpFiles } = await load()
      const tooMany = Array.from({ length: 101 }, (_id, index) => {
        return fileId(index + 1)
      })

      await expect(deleteMcpFiles(OWNER, { fileIds: [] }, mocks.logger))
        .rejects.toMatchObject({ status: 400 })
      await expect(deleteMcpFiles(OWNER, { fileIds: tooMany }, mocks.logger))
        .rejects.toMatchObject({ status: 400 })
      expect(mocks.deleteOwnedFiles).not.toHaveBeenCalled()
    })
  })
})
