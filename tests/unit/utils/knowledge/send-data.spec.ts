import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { encodePublicId } from '~~/server/utils/custom-db-types'
import { loadKnowledgeSendData } from '~~/server/utils/knowledge/send-data'
import { knowledgePackKey } from '~~/server/utils/knowledge/storage-keys'
import { createKnowledgeTestDb } from '../../../setup/helpers/knowledge-send-db'

const USER_ID = 1
const OTHER_USER_ID = 2
const PROJECT_ID = 5
const PACK_VERSION = 3
const PACK_KEY = knowledgePackKey(USER_ID, PROJECT_ID, PACK_VERSION)
const SECRET_TEXT = 'SECRET-DOCUMENT-TEXT'
const MAX_PACK_BYTES = 10 * 1024 * 1024
const MAX_PACK_LINES = 20_000
const MAX_PACK_LINE_LENGTH = 2 * 1024 * 1024

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text])
    .stream()
    .pipeThrough(new CompressionStream('gzip'))

  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function toBody(bytes: Uint8Array): ReadableStream {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
  })
}

function createFakeBucket() {
  const objects = new Map<string, Uint8Array>()
  const get = vi.fn(async (key: string) => {
    const bytes = objects.get(key)

    return bytes ? { body: toBody(bytes) } : null
  })

  return { objects, get }
}

function buildPackText(options: {
  itemId: string
  chunks: string[]
  version?: number
}): string {
  const header = {
    type: 'header',
    version: options.version ?? PACK_VERSION,
    builtAt: '2026-10-25T00:00:00.000Z',
    items: [{
      itemId: options.itemId,
      updatedAt: '2026-10-25T00:00:00.000Z',
      chunks: options.chunks.length,
    }],
  }
  const lines = options.chunks.map((text, ordinal) => {
    return JSON.stringify({
      type: 'chunk',
      itemId: options.itemId,
      ordinal,
      breadcrumb: `Section ${ordinal}`,
      text,
    })
  })

  return [JSON.stringify(header), ...lines].join('\n') + '\n'
}

describe('loadKnowledgeSendData', () => {
  let testDb: ReturnType<typeof createKnowledgeTestDb>
  let bucket: ReturnType<typeof createFakeBucket>
  let loggerSet: ReturnType<typeof vi.fn>

  beforeEach(() => {
    testDb = createKnowledgeTestDb()
    bucket = createFakeBucket()
    loggerSet = vi.fn()
    vi.stubGlobal('useDb', () => testDb.db)
    vi.stubGlobal('useFileStorage', () => bucket)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    testDb.close()
  })

  function load() {
    return loadKnowledgeSendData({
      userId: USER_ID,
      projectId: PROJECT_ID,
      logger: { set: loggerSet },
    })
  }

  function seedProject(packVersion: number | null = PACK_VERSION) {
    testDb.insertProject({
      id: PROJECT_ID,
      userId: USER_ID,
      knowledgeMode: 'search',
      knowledgeVersion: 4,
      knowledgePackVersion: packVersion,
    })
    testDb.insertItem({
      id: 11,
      userId: USER_ID,
      projectId: PROJECT_ID,
      title: 'Notes',
      latinChars: 20,
    })
  }

  async function seedPack(text: string) {
    bucket.objects.set(PACK_KEY, await gzip(text))
  }

  describe('items and state', () => {
    it('returns null without an R2 read when the project has no items', async () => {
      testDb.insertProject({ id: PROJECT_ID, userId: USER_ID })

      const data = await load()

      expect(data).toBeNull()
      expect(bucket.get).not.toHaveBeenCalled()
    })

    it('returns null when the items belong to another user', async () => {
      testDb.insertProject({ id: PROJECT_ID, userId: OTHER_USER_ID })
      testDb.insertItem({
        id: 11,
        userId: OTHER_USER_ID,
        projectId: PROJECT_ID,
      })

      expect(await load()).toBeNull()
    })

    it('returns null when the project row is not the user', async () => {
      testDb.insertProject({ id: PROJECT_ID, userId: OTHER_USER_ID })
      testDb.insertItem({ id: 11, userId: USER_ID, projectId: PROJECT_ID })

      expect(await load()).toBeNull()
    })

    it('reads the project state', async () => {
      seedProject()

      const data = await load()

      expect(data?.state).toEqual({
        mode: 'search',
        version: 4,
        packVersion: PACK_VERSION,
      })
    })

    it('defaults a never-built project to null mode and version 0', async () => {
      testDb.insertProject({ id: PROJECT_ID, userId: USER_ID })
      testDb.insertItem({ id: 11, userId: USER_ID, projectId: PROJECT_ID })

      const data = await load()

      expect(data?.state).toEqual({
        mode: null,
        version: 0,
        packVersion: null,
      })
    })

    it('maps items to the wire shape with public ids', async () => {
      seedProject()
      testDb.insertFile({ id: 7, userId: USER_ID, storageKey: 'users/1/a.pdf' })
      testDb.insertItem({
        id: 12,
        userId: USER_ID,
        projectId: PROJECT_ID,
        fileId: 7,
        title: 'Contract',
        relativePath: 'legal/contract.pdf',
        mediaType: 'application/pdf',
        sizeBytes: 2048,
        pageCount: 14,
        sendAsNativePdf: true,
        pinned: true,
        latinChars: 100,
        cyrillicChars: 50,
        otherChars: 5,
      })

      const data = await load()
      const note = data?.items.find(item => item.id === encodePublicId(11))
      const pdf = data?.items.find(item => item.id === encodePublicId(12))

      expect(data?.items).toHaveLength(2)
      expect(note).toMatchObject({
        projectId: encodePublicId(PROJECT_ID),
        fileId: null,
        storageKey: null,
        sendAsNativePdf: false,
        pinned: false,
      })
      expect(pdf).toMatchObject({
        projectId: encodePublicId(PROJECT_ID),
        fileId: encodePublicId(7),
        storageKey: 'users/1/a.pdf',
        title: 'Contract',
        relativePath: 'legal/contract.pdf',
        mediaType: 'application/pdf',
        sizeBytes: 2048,
        pageCount: 14,
        sendAsNativePdf: true,
        pinned: true,
        latinChars: 100,
        cyrillicChars: 50,
        otherChars: 5,
        extractStatus: 'ready',
      })
      expect(pdf?.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })

    it('does not join a file owned by another user', async () => {
      seedProject()
      testDb.insertFile({
        id: 7,
        userId: OTHER_USER_ID,
        storageKey: 'users/2/a.pdf',
      })
      testDb.insertItem({
        id: 12,
        userId: USER_ID,
        projectId: PROJECT_ID,
        fileId: 7,
      })

      const data = await load()
      const pdf = data?.items.find(item => item.id === encodePublicId(12))

      expect(pdf?.storageKey).toBeNull()
    })

    it('resolves to null and logs when the database fails', async () => {
      vi.stubGlobal('useDb', () => {
        throw new Error('d1 unavailable')
      })

      expect(await load()).toBeNull()
      expect(loggerSet).toHaveBeenCalledWith({
        attributes: { knowledge: { error: 'd1 unavailable' } },
      })
    })
  })

  describe('loadPack', () => {
    it('does not touch R2 until loadPack is called', async () => {
      seedProject()
      await seedPack(buildPackText({ itemId: 'x', chunks: ['one'] }))

      await load()

      expect(bucket.get).not.toHaveBeenCalled()
    })

    it('reads, gunzips and validates a real gzip NDJSON pack', async () => {
      seedProject()
      await seedPack(buildPackText({
        itemId: encodePublicId(11),
        chunks: ['first chunk', 'second chunk'],
      }))

      const data = await load()
      const pack = await data!.loadPack()

      expect(bucket.get).toHaveBeenCalledWith(PACK_KEY)
      expect(pack?.header.items).toEqual([{
        itemId: encodePublicId(11),
        updatedAt: '2026-10-25T00:00:00.000Z',
        chunks: 2,
      }])
      expect(pack?.lines).toEqual([
        {
          type: 'chunk',
          itemId: encodePublicId(11),
          ordinal: 0,
          breadcrumb: 'Section 0',
          text: 'first chunk',
        },
        {
          type: 'chunk',
          itemId: encodePublicId(11),
          ordinal: 1,
          breadcrumb: 'Section 1',
          text: 'second chunk',
        },
      ])
      expect(loggerSet).not.toHaveBeenCalled()
    })

    it('preserves multi-byte text through gzip', async () => {
      seedProject()
      await seedPack(buildPackText({
        itemId: encodePublicId(11),
        chunks: ['Привіт, світе — 日本語'],
      }))

      const data = await load()
      const pack = await data!.loadPack()

      expect(pack?.lines[0]?.text).toBe('Привіт, світе — 日本語')
    })

    it('memoizes the pack per call', async () => {
      seedProject()
      await seedPack(buildPackText({ itemId: 'x', chunks: ['one'] }))

      const data = await load()
      const [first, second] = await Promise.all([
        data!.loadPack(),
        data!.loadPack(),
      ])
      const third = await data!.loadPack()

      expect(first).not.toBeNull()
      expect(second).toBe(first)
      expect(third).toBe(first)
      expect(bucket.get).toHaveBeenCalledTimes(1)
    })

    it('memoizes a failure too, without a second R2 read', async () => {
      seedProject()

      const data = await load()

      expect(await data!.loadPack()).toBeNull()
      expect(await data!.loadPack()).toBeNull()
      expect(bucket.get).toHaveBeenCalledTimes(1)
    })

    it('returns null without an R2 read when no pack was built', async () => {
      seedProject(null)

      const data = await load()

      expect(await data!.loadPack()).toBeNull()
      expect(bucket.get).not.toHaveBeenCalled()
      expect(loggerSet).not.toHaveBeenCalled()
    })

    it('returns null and logs when the pack object is missing', async () => {
      seedProject()

      const data = await load()

      expect(await data!.loadPack()).toBeNull()
      expect(loggerSet).toHaveBeenCalledWith({
        attributes: { knowledge: { error: 'pack-object-missing' } },
      })
    })

    it('returns null and logs on a corrupt pack line without leaking text', async () => {
      seedProject()
      await seedPack(
        buildPackText({ itemId: 'x', chunks: ['one'] })
        + `{"type":"chunk","text":"${SECRET_TEXT}\n`,
      )

      const data = await load()

      expect(await data!.loadPack()).toBeNull()
      expect(loggerSet).toHaveBeenCalledWith({
        attributes: { knowledge: { error: 'pack-line-invalid' } },
      })
      expect(JSON.stringify(loggerSet.mock.calls)).not.toContain(SECRET_TEXT)
    })

    it('returns null and logs on a schema-invalid chunk line', async () => {
      seedProject()
      await seedPack(
        buildPackText({ itemId: 'x', chunks: ['one'] })
        + `${JSON.stringify({
          type: 'chunk',
          itemId: 'x',
          ordinal: -1,
          breadcrumb: '',
          text: SECRET_TEXT,
        })}\n`,
      )

      const data = await load()

      expect(await data!.loadPack()).toBeNull()
      expect(loggerSet).toHaveBeenCalledWith({
        attributes: { knowledge: { error: 'pack-line-invalid' } },
      })
    })

    it('returns null and logs on an invalid header', async () => {
      seedProject()
      await seedPack(`${JSON.stringify({ type: 'chunk' })}\n`)

      const data = await load()

      expect(await data!.loadPack()).toBeNull()
      expect(loggerSet).toHaveBeenCalledWith({
        attributes: { knowledge: { error: 'pack-header-invalid' } },
      })
    })

    it('returns null and logs on an empty pack', async () => {
      seedProject()
      await seedPack('')

      const data = await load()

      expect(await data!.loadPack()).toBeNull()
      expect(loggerSet).toHaveBeenCalledWith({
        attributes: { knowledge: { error: 'pack-header-invalid' } },
      })
    })

    it('returns null and logs when the object is not gzip', async () => {
      seedProject()
      bucket.objects.set(
        PACK_KEY,
        new TextEncoder().encode(buildPackText({
          itemId: 'x',
          chunks: [SECRET_TEXT],
        })),
      )

      const data = await load()

      expect(await data!.loadPack()).toBeNull()
      expect(loggerSet).toHaveBeenCalledWith({
        attributes: { knowledge: { error: 'pack-unreadable' } },
      })
    })

    it('returns null and logs when the compressed object exceeds the cap', async () => {
      seedProject()
      bucket.get.mockResolvedValueOnce({
        size: MAX_PACK_BYTES + 1,
        body: toBody(await gzip(buildPackText({
          itemId: 'x',
          chunks: ['one'],
        }))),
      })

      const data = await load()

      expect(await data!.loadPack()).toBeNull()
      expect(loggerSet).toHaveBeenCalledWith({
        attributes: { knowledge: { error: 'pack-too-large' } },
      })
    })

    it('aborts a gzip bomb that decompresses past the cap', async () => {
      seedProject()
      await seedPack(buildPackText({
        itemId: 'x',
        chunks: ['a'.repeat(MAX_PACK_BYTES + 1024)],
      }))

      const compressedSize = bucket.objects.get(PACK_KEY)!.byteLength
      const data = await load()

      expect(compressedSize).toBeLessThan(MAX_PACK_BYTES)
      expect(await data!.loadPack()).toBeNull()
      expect(loggerSet).toHaveBeenCalledWith({
        attributes: { knowledge: { error: 'pack-too-large' } },
      })
    })

    it('returns null and logs when the pack has too many lines', async () => {
      seedProject()
      await seedPack(buildPackText({
        itemId: 'x',
        chunks: Array.from({ length: MAX_PACK_LINES + 1 }, () => 'a'),
      }))

      const data = await load()

      expect(await data!.loadPack()).toBeNull()
      expect(loggerSet).toHaveBeenCalledWith({
        attributes: { knowledge: { error: 'pack-too-large' } },
      })
    })

    it('loads a pack with exactly the maximum number of lines', async () => {
      seedProject()
      await seedPack(buildPackText({
        itemId: 'x',
        chunks: Array.from({ length: MAX_PACK_LINES - 1 }, () => 'a'),
      }))

      const data = await load()
      const pack = await data!.loadPack()

      expect(pack?.lines).toHaveLength(MAX_PACK_LINES - 1)
      expect(loggerSet).not.toHaveBeenCalled()
    })

    it('returns null and logs when one line exceeds the line cap', async () => {
      seedProject()
      await seedPack(buildPackText({
        itemId: 'x',
        chunks: ['a'.repeat(MAX_PACK_LINE_LENGTH + 1)],
      }))

      const data = await load()

      expect(await data!.loadPack()).toBeNull()
      expect(loggerSet).toHaveBeenCalledWith({
        attributes: { knowledge: { error: 'pack-too-large' } },
      })
    })

    it('returns null and logs when the header version is not the pack version', async () => {
      seedProject()
      await seedPack(buildPackText({
        itemId: 'x',
        chunks: ['one'],
        version: PACK_VERSION + 1,
      }))

      const data = await load()

      expect(await data!.loadPack()).toBeNull()
      expect(loggerSet).toHaveBeenCalledWith({
        attributes: { knowledge: { error: 'pack-version-mismatch' } },
      })
    })

    it('returns null and logs when the R2 read throws', async () => {
      seedProject()
      bucket.get.mockRejectedValueOnce(new Error('r2 timeout'))

      const data = await load()

      expect(await data!.loadPack()).toBeNull()
      expect(loggerSet).toHaveBeenCalledWith({
        attributes: { knowledge: { error: 'r2 timeout' } },
      })
    })
  })
})
