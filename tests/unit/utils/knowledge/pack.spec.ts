import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KNOWLEDGE_LIMITS } from '#shared/utils/project-knowledge-policy'
import { encodePublicId } from '~~/server/utils/custom-db-types'
import { chunkKnowledgeText } from '~~/server/utils/knowledge/chunk'
import {
  buildKnowledgePack,
  commitKnowledgeChange,
  ensureKnowledgePackFresh,
  readKnowledgePack,
} from '~~/server/utils/knowledge/pack'
import { acquireKnowledgePackLease } from '~~/server/utils/knowledge/pack-lease'
import { createKnowledgeTestDb } from '../../../setup/helpers/knowledge-db'

const OWNER = 1
const STRANGER = 2
const PROJECT = 10
const OTHER_PROJECT = 11
const MEBIBYTE = 1024 * 1024

interface StoredObject {
  bytes: Uint8Array
  reportedSize?: number
}

function toBytes(value: string | ArrayBuffer | Uint8Array): Uint8Array {
  if (typeof value === 'string') {
    return new TextEncoder().encode(value)
  }

  return value instanceof Uint8Array ? value : new Uint8Array(value)
}

function createFakeBucket() {
  const objects = new Map<string, StoredObject>()
  const operations: string[] = []
  const deleteCalls: string[][] = []
  const hooks: {
    beforePut?: (key: string) => Promise<void>
    failPut?: (key: string) => boolean
    failDelete?: (keys: string[]) => boolean
    pageSize?: number
  } = {}
  let inFlight = 0
  let maxInFlight = 0

  async function track<T>(action: () => Promise<T> | T): Promise<T> {
    inFlight++
    maxInFlight = Math.max(maxInFlight, inFlight)

    try {
      await Promise.resolve()

      return await action()
    } finally {
      inFlight--
    }
  }

  return {
    objects,
    operations,
    deleteCalls,
    hooks,
    getMaxInFlight: () => maxInFlight,
    put: vi.fn(async (key: string, value: string | ArrayBuffer) => {
      await hooks.beforePut?.(key)

      return await track(() => {
        operations.push(`put:${key}`)

        if (hooks.failPut?.(key)) {
          throw new Error('R2 put failed')
        }

        objects.set(key, { bytes: toBytes(value) })
      })
    }),
    get: vi.fn(async (key: string) => {
      return await track(() => {
        operations.push(`get:${key}`)

        const stored = objects.get(key)

        if (!stored) {
          return null
        }

        return {
          size: stored.reportedSize ?? stored.bytes.length,
          body: new Blob([stored.bytes as BlobPart]).stream(),
          text: async () => new TextDecoder().decode(stored.bytes),
        }
      })
    }),
    delete: vi.fn(async (keys: string | string[]) => {
      return await track(() => {
        const keyList = Array.isArray(keys) ? keys : [keys]

        operations.push(`delete:${keyList.join(',')}`)
        deleteCalls.push(keyList)

        if (hooks.failDelete?.(keyList)) {
          throw new Error('R2 delete failed')
        }

        for (const key of keyList) {
          objects.delete(key)
        }
      })
    }),
    list: vi.fn(async (options: {
      prefix: string
      cursor?: string
      limit: number
    }) => {
      return await track(() => {
        operations.push(`list:${options.prefix}`)

        const keys = [...objects.keys()]
          .filter((key) => {
            return key.startsWith(options.prefix)
          })
          .sort()
        const offset = options.cursor ? Number(options.cursor) : 0
        const pageSize = Math.min(options.limit, hooks.pageSize ?? Infinity)
        const page = keys.slice(offset, offset + pageSize)
        const truncated = offset + pageSize < keys.length

        return {
          objects: page.map((key) => {
            return { key }
          }),
          truncated,
          cursor: truncated ? String(offset + pageSize) : undefined,
        }
      })
    }),
  }
}

function createKv(options: { neverHeld?: boolean } = {}) {
  const entries = new Map<string, number>()

  return {
    entries,
    get: vi.fn(async (key: string) => {
      if (options.neverHeld) {
        return null
      }

      const expiresAt = entries.get(key)

      return expiresAt !== undefined && expiresAt > Date.now() ? '1' : null
    }),
    put: vi.fn(async (
      key: string,
      _value: string,
      putOptions: { expirationTtl: number },
    ) => {
      entries.set(key, Date.now() + putOptions.expirationTtl * 1000)
    }),
    delete: vi.fn(async (key: string) => {
      entries.delete(key)
    }),
  }
}

async function gzip(
  input: string | Uint8Array,
): Promise<Uint8Array> {
  const source = typeof input === 'string' ? toBytes(input) : input
  const stream = new Blob([source as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream('gzip'))

  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function gunzip(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'))

  return await new Response(stream).text()
}

function ndjson(lines: unknown[]): string {
  return lines.map((line) => {
    return JSON.stringify(line)
  }).join('\n').concat('\n')
}

function packHeader(
  version: number,
  items: Array<{ itemId: string, updatedAt?: string, chunks: number }>,
) {
  return {
    type: 'header',
    version,
    builtAt: '2026-10-25T00:00:00.000Z',
    items: items.map((item) => {
      return {
        itemId: item.itemId,
        updatedAt: item.updatedAt ?? '2026-10-25T00:00:00.000Z',
        chunks: item.chunks,
      }
    }),
  }
}

function chunkLine(itemId: string, ordinal: number, text = 'text') {
  return { type: 'chunk', itemId, ordinal, breadcrumb: 'crumb', text }
}

function isoOf(seconds: number): string {
  return new Date(seconds * 1000).toISOString()
}

describe('knowledge pack', () => {
  let testDb: ReturnType<typeof createKnowledgeTestDb>
  let bucket: ReturnType<typeof createFakeBucket>
  let kv: ReturnType<typeof createKv>
  let logger: { set: ReturnType<typeof vi.fn> }

  function textKey(itemId: number, projectId = PROJECT, userId = OWNER) {
    return `knowledge/u${userId}/p${projectId}/items/${itemId}.md`
  }

  function packKey(version: number, projectId = PROJECT, userId = OWNER) {
    return `knowledge/u${userId}/p${projectId}/pack/v${version}.jsonl.gz`
  }

  function seedItem(input: {
    text: string | null
    id?: number
    projectId?: number
    userId?: number
    title?: string
    relativePath?: string | null
    createdAt?: number
    updatedAt?: number
    extractStatus?: string
  }): number {
    const projectId = input.projectId ?? PROJECT
    const userId = input.userId ?? OWNER
    const itemId = testDb.insertItem({
      id: input.id,
      userId,
      projectId,
      title: input.title ?? 'Note',
      relativePath: input.relativePath ?? null,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
      extractStatus: input.extractStatus,
    })

    if (input.text !== null) {
      bucket.objects.set(textKey(itemId, projectId, userId), {
        bytes: toBytes(input.text),
      })
    }

    return itemId
  }

  function setProject(version: number | null, packVersion: number | null) {
    testDb.sqlite
      .prepare(
        'update projects set knowledge_version = ?,'
        + ' knowledge_pack_version = ? where id = ?',
      )
      .run(version, packVersion, PROJECT)
  }

  function projectRow() {
    return testDb.getProjectRow(PROJECT)!
  }

  function itemReads(): string[] {
    return bucket.operations.filter((operation) => {
      return operation.startsWith('get:') && operation.includes('/items/')
    })
  }

  function loggedOperations(): string[] {
    return logger.set.mock.calls.flatMap(([data]) => {
      const operation = data?.attributes?.knowledgePack?.operation

      return operation ? [operation as string] : []
    })
  }

  async function writePack(version: number, content: string | Uint8Array) {
    bucket.objects.set(packKey(version), {
      bytes: await gzip(content),
    })
  }

  async function writeRawPack(version: number, bytes: Uint8Array) {
    bucket.objects.set(packKey(version), { bytes })
  }

  async function readPack(version: number, projectId = PROJECT) {
    return await readKnowledgePack({ userId: OWNER, projectId, version })
  }

  function build() {
    return buildKnowledgePack({ userId: OWNER, projectId: PROJECT, logger })
  }

  beforeEach(() => {
    testDb = createKnowledgeTestDb()
    bucket = createFakeBucket()
    kv = createKv()
    logger = { set: vi.fn() }
    vi.stubGlobal('useDb', () => testDb.db)
    vi.stubGlobal('useFileStorage', () => bucket)
    vi.stubGlobal('useKV', () => kv)
    testDb.insertProject({ id: PROJECT, userId: OWNER })
    testDb.insertProject({ id: OTHER_PROJECT, userId: OWNER })
    testDb.insertProject({ id: 12, userId: STRANGER })
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  describe('buildKnowledgePack', () => {
    it('writes a gzip NDJSON pack and advances the pack version', async () => {
      const first = seedItem({
        text: '# Intro\n\nHello world.',
        title: 'Readme',
        createdAt: 1_000,
        updatedAt: 1_500,
      })
      const second = seedItem({
        text: 'Привіт, світе.',
        title: 'Нотатка',
        relativePath: 'docs/note.md',
        createdAt: 2_000,
        updatedAt: 2_500,
      })

      setProject(1, null)

      expect(await build()).toEqual({ packVersion: 1, built: true })
      expect(projectRow().knowledge_pack_version).toBe(1)

      const raw = await gunzip(bucket.objects.get(packKey(1))!.bytes)
      const rawLines = raw.trimEnd().split('\n').map((line) => {
        return JSON.parse(line)
      })

      expect(rawLines[0]).toMatchObject({
        type: 'header',
        version: 1,
        items: [
          { itemId: encodePublicId(first), updatedAt: isoOf(1_500), chunks: 1 },
          {
            itemId: encodePublicId(second),
            updatedAt: isoOf(2_500),
            chunks: 1,
          },
        ],
      })
      expect(new Date(rawLines[0].builtAt).toISOString())
        .toBe(rawLines[0].builtAt)
      expect(rawLines.slice(1)).toEqual([
        {
          type: 'chunk',
          itemId: encodePublicId(first),
          ordinal: 0,
          breadcrumb: 'Readme › Intro',
          text: '# Intro\n\nHello world.',
        },
        {
          type: 'chunk',
          itemId: encodePublicId(second),
          ordinal: 0,
          breadcrumb: 'docs/note.md',
          text: 'Привіт, світе.',
        },
      ])
    })

    it('round-trips through readKnowledgePack', async () => {
      seedItem({ text: 'alpha. '.repeat(500), title: 'A', createdAt: 1_000 })
      seedItem({ text: 'beta. '.repeat(500), title: 'B', createdAt: 2_000 })
      setProject(3, null)

      await build()

      const pack = await readPack(3)

      expect(pack).not.toBeNull()
      expect(pack!.header.version).toBe(3)
      expect(pack!.header.items.map((item) => {
        return item.chunks
      })).toEqual([2, 2])
      expect(pack!.lines.map((line) => {
        return [line.itemId === pack!.header.items[0]!.itemId, line.ordinal]
      })).toEqual([[true, 0], [true, 1], [false, 0], [false, 1]])
    })

    it('groups chunks by item in createdAt order with ordinals from 0', async () => {
      const late = seedItem({ text: 'late', createdAt: 5_000 })
      const early = seedItem({ text: 'early', createdAt: 1_000 })

      setProject(1, null)
      await build()

      const pack = await readPack(1)

      expect(pack!.header.items.map((item) => {
        return item.itemId
      })).toEqual([encodePublicId(early), encodePublicId(late)])
    })

    it('does nothing and reports pack version 0 when there is no version', async () => {
      seedItem({ text: 'x' })

      expect(await build()).toEqual({ packVersion: 0, built: false })
      expect(bucket.operations).toEqual([])
      expect(kv.put).not.toHaveBeenCalled()
    })

    it('does nothing when the pack is already fresh', async () => {
      setProject(4, 4)

      expect(await build()).toEqual({ packVersion: 4, built: false })
      expect(bucket.operations).toEqual([])
      expect(kv.put).not.toHaveBeenCalled()
    })

    it('rejects with 404 for a missing or foreign project', async () => {
      await expect(buildKnowledgePack({
        userId: OWNER,
        projectId: 999,
      })).rejects.toMatchObject({ status: 404 })
      await expect(buildKnowledgePack({
        userId: OWNER,
        projectId: 12,
      })).rejects.toMatchObject({ status: 404 })
    })

    it('leaves out items without extracted text', async () => {
      const ready = seedItem({ text: 'readable', createdAt: 1_000 })

      seedItem({
        text: null,
        extractStatus: 'no-text',
        createdAt: 2_000,
      })
      seedItem({
        text: null,
        extractStatus: 'failed',
        createdAt: 3_000,
      })
      setProject(1, null)

      await build()

      const pack = await readPack(1)

      expect(pack!.header.items.map((item) => {
        return item.itemId
      })).toEqual([encodePublicId(ready)])
    })

    it('does not include items of other projects or users', async () => {
      const mine = seedItem({ text: 'mine', createdAt: 1_000 })

      seedItem({ text: 'other project', projectId: OTHER_PROJECT })
      seedItem({ text: 'stranger', projectId: 12, userId: STRANGER })
      setProject(1, null)

      await build()

      const pack = await readPack(1)

      expect(pack!.header.items.map((item) => {
        return item.itemId
      })).toEqual([encodePublicId(mine)])
    })

    it('skips an item whose text object is missing and picks it up later', async () => {
      const present = seedItem({ text: 'here', createdAt: 1_000 })
      const pending = seedItem({ text: null, createdAt: 2_000 })

      setProject(1, null)
      await build()

      const firstPack = await readPack(1)

      expect(firstPack!.header.items.map((item) => {
        return item.itemId
      })).toEqual([encodePublicId(present)])

      bucket.objects.set(textKey(pending), { bytes: toBytes('now here') })
      setProject(2, 1)
      await build()

      const secondPack = await readPack(2)

      expect(secondPack!.header.items.map((item) => {
        return item.itemId
      })).toEqual([encodePublicId(present), encodePublicId(pending)])
    })

    it('fails the build when a text read fails, leaving the pack version alone', async () => {
      seedItem({ text: 'x' })
      setProject(1, null)
      bucket.get.mockRejectedValueOnce(new Error('R2 down'))

      await expect(build()).rejects.toThrow('R2 down')
      expect(projectRow().knowledge_pack_version).toBeNull()
      expect(kv.entries.size).toBe(0)
    })

    describe('incremental rebuild', () => {
      it('does not re-read the text of unchanged items', async () => {
        const first = seedItem({ text: 'first text', createdAt: 1_000 })
        const second = seedItem({ text: 'second text', createdAt: 2_000 })

        setProject(1, null)
        await build()
        expect(itemReads()).toHaveLength(2)

        const third = seedItem({ text: 'third text', createdAt: 3_000 })

        bucket.operations.length = 0
        setProject(2, 1)

        expect(await build()).toEqual({ packVersion: 2, built: true })
        expect(itemReads()).toEqual([`get:${textKey(third)}`])

        const pack = await readPack(2)

        expect(pack!.header.items.map((item) => {
          return item.itemId
        })).toEqual([
          encodePublicId(first),
          encodePublicId(second),
          encodePublicId(third),
        ])
        expect(pack!.lines.map((line) => {
          return line.text
        })).toEqual(['first text', 'second text', 'third text'])
      })

      it('re-reads and re-chunks an item whose updatedAt changed', async () => {
        seedItem({ text: 'stays', createdAt: 1_000, updatedAt: 1_000 })

        const changed = seedItem({
          text: 'old text',
          createdAt: 2_000,
          updatedAt: 2_000,
        })

        setProject(1, null)
        await build()

        bucket.objects.set(textKey(changed), { bytes: toBytes('new text') })
        testDb.sqlite
          .prepare('update project_knowledge_items set updated_at = 9000'
            + ' where id = ?')
          .run(changed)
        bucket.operations.length = 0
        setProject(2, 1)
        await build()

        expect(itemReads()).toEqual([`get:${textKey(changed)}`])

        const pack = await readPack(2)

        expect(pack!.lines.map((line) => {
          return line.text
        })).toEqual(['stays', 'new text'])
        expect(pack!.header.items[1]!.updatedAt).toBe(isoOf(9_000))
      })

      it('drops items whose row is gone', async () => {
        const removed = seedItem({ text: 'going away', createdAt: 1_000 })
        const kept = seedItem({ text: 'kept', createdAt: 2_000 })

        setProject(1, null)
        await build()

        testDb.sqlite
          .prepare('delete from project_knowledge_items where id = ?')
          .run(removed)
        bucket.operations.length = 0
        setProject(2, 1)
        await build()

        expect(itemReads()).toEqual([])

        const pack = await readPack(2)

        expect(pack!.header.items.map((item) => {
          return item.itemId
        })).toEqual([encodePublicId(kept)])
        expect(pack!.lines.map((line) => {
          return line.text
        })).toEqual(['kept'])
      })

      it('rebuilds everything when the previous pack is corrupt', async () => {
        seedItem({ text: 'one', createdAt: 1_000 })
        seedItem({ text: 'two', createdAt: 2_000 })
        setProject(1, null)
        await build()

        await writeRawPack(1, toBytes('not a gzip stream'))
        bucket.operations.length = 0
        setProject(2, 1)
        await build()

        expect(itemReads()).toHaveLength(2)
        expect(loggedOperations()).toContain('previous-unreadable')
        expect((await readPack(2))!.lines).toHaveLength(2)
      })

      it('builds on the newest earlier pack even when versions skip', async () => {
        const item = seedItem({
          text: 'text from the item object',
          createdAt: 1_000,
          updatedAt: 1_000,
        })
        const itemId = encodePublicId(item)

        await writePack(1, ndjson([
          packHeader(1, [{ itemId, updatedAt: isoOf(1_000), chunks: 1 }]),
          chunkLine(itemId, 0, 'stale text from v1'),
        ]))
        await writePack(3, ndjson([
          packHeader(3, [{ itemId, updatedAt: isoOf(1_000), chunks: 1 }]),
          chunkLine(itemId, 0, 'reused text from v3'),
        ]))
        setProject(7, 3)

        await build()

        expect(itemReads()).toEqual([])
        expect((await readPack(7))!.lines[0]!.text).toBe('reused text from v3')
      })

      it('ignores a stale pack version at or above the target', async () => {
        const item = seedItem({ text: 'fresh', createdAt: 1_000 })
        const itemId = encodePublicId(item)

        await writePack(9, ndjson([
          packHeader(9, [{ itemId, updatedAt: isoOf(1_000), chunks: 1 }]),
          chunkLine(itemId, 0, 'from the future'),
        ]))
        setProject(2, null)

        await build()

        expect((await readPack(2))!.lines[0]!.text).toBe('fresh')
      })
    })

    describe('lease', () => {
      it('does not build while another build holds the lease', async () => {
        seedItem({ text: 'x' })
        setProject(1, null)

        const held = await acquireKnowledgePackLease(PROJECT)

        try {
          expect(await build()).toEqual({ packVersion: 0, built: false })
          expect(bucket.operations).toEqual([])
          expect(projectRow().knowledge_pack_version).toBeNull()
          expect(loggedOperations()).toContain('leased')
        } finally {
          await held!.release()
        }
      })

      it('takes and releases the lease under the project key', async () => {
        seedItem({ text: 'x' })
        setProject(1, null)

        await build()

        expect(kv.put).toHaveBeenCalledWith(
          `knowledge-pack-build:${PROJECT}`,
          '1',
          { expirationTtl: 120 },
        )
        expect(kv.entries.size).toBe(0)
        expect(kv.delete).toHaveBeenCalledWith(`knowledge-pack-build:${PROJECT}`)
      })

      it('releases the lease when the build fails', async () => {
        seedItem({ text: 'x' })
        setProject(1, null)
        bucket.hooks.failPut = () => true

        await expect(build()).rejects.toThrow('R2 put failed')
        expect(kv.entries.size).toBe(0)
        expect(projectRow().knowledge_pack_version).toBeNull()
      })

      it('can build again after the lease is released', async () => {
        seedItem({ text: 'x' })
        setProject(1, null)

        const held = await acquireKnowledgePackLease(PROJECT)

        await build()
        await held!.release()

        expect(await build()).toEqual({ packVersion: 1, built: true })
      })

      it('does not rebuild when a finished build advanced the pack while waiting', async () => {
        seedItem({ text: 'x' })
        setProject(1, null)
        kv.get.mockImplementationOnce(async () => {
          setProject(1, 1)

          return null
        })

        expect(await build()).toEqual({ packVersion: 1, built: false })
        expect(bucket.put).not.toHaveBeenCalled()
      })
    })

    describe('pack version advance', () => {
      it('never moves the pack version backwards when two builds race', async () => {
        const kvNeverHeld = createKv({ neverHeld: true })

        vi.stubGlobal('useKV', () => kvNeverHeld)
        seedItem({ text: 'racing', createdAt: 1_000 })
        setProject(3, null)

        let hasRaced = false

        bucket.hooks.beforePut = async (key) => {
          if (key !== packKey(3) || hasRaced) {
            return
          }

          hasRaced = true
          setProject(4, null)
          await build()
        }

        const result = await build()

        expect(hasRaced).toBe(true)
        expect(result).toEqual({ packVersion: 4, built: true })
        expect(projectRow().knowledge_pack_version).toBe(4)
        expect(bucket.objects.has(packKey(3))).toBe(true)
        expect(bucket.objects.has(packKey(4))).toBe(true)
      })

      it('advances from null and from a lower version only', async () => {
        seedItem({ text: 'x' })
        setProject(2, null)
        await build()

        expect(projectRow().knowledge_pack_version).toBe(2)

        setProject(5, 2)
        await build()

        expect(projectRow().knowledge_pack_version).toBe(5)
      })
    })

    describe('retention', () => {
      it('keeps the two newest pack versions across gaps in numbering', async () => {
        for (const version of [1, 2, 5]) {
          await writePack(version, ndjson([packHeader(version, [])]))
        }

        bucket.objects.set(
          'knowledge/u1/p10/pack/v2.index.json.gz',
          { bytes: toBytes('index') },
        )
        seedItem({ text: 'x' })
        setProject(8, 5)

        await build()

        expect([...bucket.objects.keys()]
          .filter((key) => {
            return key.includes('/pack/')
          })
          .sort()).toEqual([packKey(5), packKey(8)])
        expect(bucket.deleteCalls).toHaveLength(1)
        expect(bucket.deleteCalls[0]!.sort()).toEqual([
          'knowledge/u1/p10/pack/v1.jsonl.gz',
          'knowledge/u1/p10/pack/v2.index.json.gz',
          'knowledge/u1/p10/pack/v2.jsonl.gz',
        ])
      })

      it('keeps everything while at most two versions exist', async () => {
        await writePack(1, ndjson([packHeader(1, [])]))
        seedItem({ text: 'x' })
        setProject(2, 1)

        await build()

        expect(bucket.deleteCalls).toEqual([])
        expect([...bucket.objects.keys()].sort()).toEqual([
          textKey(1),
          packKey(1),
          packKey(2),
        ])
      })

      it('never deletes unrelated keys under the pack prefix', async () => {
        for (const version of [1, 2, 3]) {
          await writePack(version, ndjson([packHeader(version, [])]))
        }

        bucket.objects.set('knowledge/u1/p10/pack/notes.txt', {
          bytes: toBytes('keep me'),
        })
        bucket.objects.set('knowledge/u1/p10/pack/vX.jsonl.gz', {
          bytes: toBytes('keep me too'),
        })
        seedItem({ text: 'x' })
        setProject(4, 3)

        await build()

        expect(bucket.objects.has('knowledge/u1/p10/pack/notes.txt')).toBe(true)
        expect(bucket.objects.has('knowledge/u1/p10/pack/vX.jsonl.gz')).toBe(true)
        expect(bucket.objects.has(packKey(1))).toBe(false)
        expect(bucket.objects.has(packKey(2))).toBe(false)
      })

      it('only touches packs of this project', async () => {
        for (const version of [1, 2, 3]) {
          await writePack(version, ndjson([packHeader(version, [])]))
          bucket.objects.set(packKey(version, OTHER_PROJECT), {
            bytes: toBytes('other'),
          })
        }

        seedItem({ text: 'x' })
        setProject(4, 3)

        await build()

        for (const version of [1, 2, 3]) {
          expect(bucket.objects.has(packKey(version, OTHER_PROJECT))).toBe(true)
        }
      })

      it('follows R2 listing pages', async () => {
        for (const version of [1, 2, 3, 4, 5]) {
          await writePack(version, ndjson([packHeader(version, [])]))
        }

        bucket.hooks.pageSize = 2
        seedItem({ text: 'x' })
        setProject(6, 5)

        await build()

        expect(bucket.list.mock.calls.length).toBeGreaterThanOrEqual(3)
        expect([...bucket.objects.keys()]
          .filter((key) => {
            return key.includes('/pack/')
          })
          .sort()).toEqual([packKey(5), packKey(6)])
      })

      it('survives a failed retention delete and still reports the build', async () => {
        for (const version of [1, 2, 3]) {
          await writePack(version, ndjson([packHeader(version, [])]))
        }

        bucket.hooks.failDelete = () => true
        seedItem({ text: 'x' })
        setProject(4, 3)

        expect(await build()).toEqual({ packVersion: 4, built: true })
        expect(projectRow().knowledge_pack_version).toBe(4)
      })
    })

    describe('limits', () => {
      it('reads and writes R2 one operation at a time', async () => {
        for (let index = 0; index < 40; index++) {
          seedItem({
            text: `item ${index} text`,
            createdAt: 1_000 + index,
          })
        }

        setProject(1, null)
        await build()

        expect(bucket.getMaxInFlight()).toBe(1)
        expect(itemReads()).toHaveLength(40)
      })

      it('refuses to write a pack that readKnowledgePack would reject', async () => {
        const hugeText = 'word '.repeat(KNOWLEDGE_LIMITS.maxItemTextBytes / 5)

        for (let index = 0; index < 6; index++) {
          seedItem({ text: hugeText, createdAt: 1_000 + index })
        }

        setProject(1, null)

        await expect(build()).rejects.toMatchObject({ status: 422 })
        expect(bucket.objects.has(packKey(1))).toBe(false)
        expect(projectRow().knowledge_pack_version).toBeNull()
      })
    })
  })

  describe('readKnowledgePack', () => {
    it('returns null for a missing pack', async () => {
      expect(await readPack(1)).toBeNull()
    })

    it('returns null instead of throwing for an invalid version or ids', async () => {
      expect(await readPack(0)).toBeNull()
      expect(await readPack(-1)).toBeNull()
      expect(await readPack(Number.NaN)).toBeNull()
      expect(await readKnowledgePack({
        userId: 0,
        projectId: PROJECT,
        version: 1,
      })).toBeNull()
    })

    it('returns null when the storage binding is unavailable', async () => {
      vi.stubGlobal('useFileStorage', () => {
        throw new Error('no binding')
      })

      expect(await readPack(1)).toBeNull()
    })

    it('returns null for a wrong-version pack', async () => {
      await writePack(4, ndjson([packHeader(3, [])]))

      expect(await readPack(4)).toBeNull()
    })

    it('accepts a header-only pack', async () => {
      await writePack(2, ndjson([packHeader(2, [])]))

      expect(await readPack(2)).toEqual({
        header: packHeader(2, []),
        lines: [],
      })
    })

    it('accepts a pack without a trailing newline', async () => {
      await writePack(2, ndjson([
        packHeader(2, [{ itemId: 'a', chunks: 1 }]),
        chunkLine('a', 0),
      ]).trimEnd())

      expect((await readPack(2))!.lines).toHaveLength(1)
    })

    it('accepts header items with zero chunks between others', async () => {
      await writePack(2, ndjson([
        packHeader(2, [
          { itemId: 'a', chunks: 1 },
          { itemId: 'b', chunks: 0 },
          { itemId: 'c', chunks: 2 },
        ]),
        chunkLine('a', 0),
        chunkLine('c', 0),
        chunkLine('c', 1),
      ]))

      expect((await readPack(2))!.lines.map((line) => {
        return `${line.itemId}${line.ordinal}`
      })).toEqual(['a0', 'c0', 'c1'])
    })

    it('returns null for bytes that are not gzip', async () => {
      await writeRawPack(1, toBytes('{"type":"header"}\n'))

      expect(await readPack(1)).toBeNull()
    })

    it('returns null for a truncated gzip stream', async () => {
      const bytes = await gzip(ndjson([
        packHeader(1, [{ itemId: 'a', chunks: 1 }]),
        chunkLine('a', 0, 'x'.repeat(10_000)),
      ]))

      await writeRawPack(1, bytes.slice(0, Math.floor(bytes.length / 2)))

      expect(await readPack(1)).toBeNull()
    })

    it('returns null for a gzip stream with a corrupted body', async () => {
      const bytes = await gzip(ndjson([
        packHeader(1, [{ itemId: 'a', chunks: 1 }]),
        chunkLine('a', 0, 'y'.repeat(5_000)),
      ]))

      bytes[Math.floor(bytes.length / 2)] ^= 0xFF

      await writeRawPack(1, bytes)

      expect(await readPack(1)).toBeNull()
    })

    it('returns null when the declared object size is above the cap', async () => {
      await writePack(1, ndjson([packHeader(1, [])]))
      bucket.objects.get(packKey(1))!.reportedSize = 64 * MEBIBYTE

      expect(await readPack(1)).toBeNull()
    })

    it('abandons a valid pack that inflates past the byte cap', async () => {
      const lineCount = 400
      const item = { itemId: 'a', chunks: lineCount }
      const text = 'z'.repeat(60_000)
      const content = ndjson([
        packHeader(1, [item]),
        ...Array.from({ length: lineCount }, (_value, ordinal) => {
          return chunkLine('a', ordinal, text)
        }),
      ])

      expect(content.length).toBeGreaterThan(
        4 * KNOWLEDGE_LIMITS.maxProjectTextBytes + 2 * MEBIBYTE,
      )

      await writePack(1, content)

      expect(bucket.objects.get(packKey(1))!.bytes.length)
        .toBeLessThan(MEBIBYTE)
      expect(await readPack(1)).toBeNull()
    })

    it('rejects a gzip bomb of zero bytes without throwing', async () => {
      await writePack(1, new Uint8Array(48 * MEBIBYTE))

      const startedAt = Date.now()

      expect(await readPack(1)).toBeNull()
      expect(Date.now() - startedAt).toBeLessThan(5_000)
    })

    it('rejects a header line that is too long', async () => {
      const items = Array.from({ length: 5_000 }, (_value, index) => {
        return { itemId: `item-${index}-${'x'.repeat(60)}`, chunks: 0 }
      })

      await writePack(1, ndjson([packHeader(1, items)]))

      expect(await readPack(1)).toBeNull()
    })

    it('rejects a header listing more items than a project may hold', async () => {
      const items = Array.from({
        length: KNOWLEDGE_LIMITS.maxItemsPerProject + 1,
      }, (_value, index) => {
        return { itemId: `i${index}`, chunks: 0 }
      })

      await writePack(1, ndjson([packHeader(1, items)]))

      expect(await readPack(1)).toBeNull()
    })

    it('rejects a header that promises too many chunks', async () => {
      await writePack(1, ndjson([
        packHeader(1, [{ itemId: 'a', chunks: 20_001 }]),
      ]))

      expect(await readPack(1)).toBeNull()
    })

    it('rejects duplicate item ids in the header', async () => {
      await writePack(1, ndjson([
        packHeader(1, [
          { itemId: 'a', chunks: 1 },
          { itemId: 'a', chunks: 1 },
        ]),
        chunkLine('a', 0),
        chunkLine('a', 0),
      ]))

      expect(await readPack(1)).toBeNull()
    })

    it('rejects a chunk line above the per-line cap', async () => {
      await writePack(1, ndjson([
        packHeader(1, [{ itemId: 'a', chunks: 1 }]),
        chunkLine('a', 0, 'x'.repeat(70_000)),
      ]))

      expect(await readPack(1)).toBeNull()
    })

    it.each([
      ['an invalid header', ['{"type":"header","version":"1"}']],
      ['a non-JSON header', ['not json']],
      ['a chunk line in the header position', [
        JSON.stringify(chunkLine('a', 0)),
      ]],
      ['an unparsable chunk line', [
        JSON.stringify(packHeader(1, [{ itemId: 'a', chunks: 1 }])),
        '{broken',
      ]],
      ['a chunk line with a missing field', [
        JSON.stringify(packHeader(1, [{ itemId: 'a', chunks: 1 }])),
        JSON.stringify({ type: 'chunk', itemId: 'a', ordinal: 0, text: 'x' }),
      ]],
      ['a chunk line with a negative ordinal', [
        JSON.stringify(packHeader(1, [{ itemId: 'a', chunks: 1 }])),
        JSON.stringify(chunkLine('a', -1)),
      ]],
      ['a chunk line with a fractional ordinal', [
        JSON.stringify(packHeader(1, [{ itemId: 'a', chunks: 1 }])),
        JSON.stringify(chunkLine('a', 0.5)),
      ]],
      ['a second header line', [
        JSON.stringify(packHeader(1, [{ itemId: 'a', chunks: 1 }])),
        JSON.stringify(packHeader(1, [])),
      ]],
      ['a chunk of an item missing from the header', [
        JSON.stringify(packHeader(1, [{ itemId: 'a', chunks: 1 }])),
        JSON.stringify(chunkLine('ghost', 0)),
      ]],
      ['chunks out of ordinal order', [
        JSON.stringify(packHeader(1, [{ itemId: 'a', chunks: 2 }])),
        JSON.stringify(chunkLine('a', 1)),
        JSON.stringify(chunkLine('a', 0)),
      ]],
      ['items out of header order', [
        JSON.stringify(packHeader(1, [
          { itemId: 'a', chunks: 1 },
          { itemId: 'b', chunks: 1 },
        ])),
        JSON.stringify(chunkLine('b', 0)),
        JSON.stringify(chunkLine('a', 0)),
      ]],
      ['fewer chunk lines than the header says', [
        JSON.stringify(packHeader(1, [{ itemId: 'a', chunks: 2 }])),
        JSON.stringify(chunkLine('a', 0)),
      ]],
      ['more chunk lines than the header says', [
        JSON.stringify(packHeader(1, [{ itemId: 'a', chunks: 1 }])),
        JSON.stringify(chunkLine('a', 0)),
        JSON.stringify(chunkLine('a', 1)),
      ]],
      ['an empty line in the middle', [
        JSON.stringify(packHeader(1, [{ itemId: 'a', chunks: 2 }])),
        JSON.stringify(chunkLine('a', 0)),
        '',
        JSON.stringify(chunkLine('a', 1)),
      ]],
      ['an empty pack', []],
    ])('rejects %s', async (_label, lines) => {
      await writePack(1, lines.length > 0 ? `${lines.join('\n')}\n` : '')

      expect(await readPack(1)).toBeNull()
    })

    it('rejects invalid UTF-8', async () => {
      const prefix = toBytes(`${JSON.stringify(packHeader(1, [
        { itemId: 'a', chunks: 1 },
      ]))}\n{"type":"chunk","itemId":"a","ordinal":0,"breadcrumb":"b","text":"`)
      const suffix = toBytes('"}\n')
      const content = new Uint8Array(prefix.length + 1 + suffix.length)

      content.set(prefix, 0)
      content[prefix.length] = 0xFF
      content.set(suffix, prefix.length + 1)

      await writePack(1, content)

      expect(await readPack(1)).toBeNull()
    })

    it('strips unknown fields from valid lines', async () => {
      await writePack(1, ndjson([
        { ...packHeader(1, [{ itemId: 'a', chunks: 1 }]), extra: true },
        { ...chunkLine('a', 0), extra: 'ignored' },
      ]))

      const pack = await readPack(1)

      expect(pack!.lines[0]).toEqual(chunkLine('a', 0))
      expect(pack!.header).not.toHaveProperty('extra')
    })

    it('reads a pack written by the builder byte for byte', async () => {
      const text = 'Привіт 😀 "quotes" \\ backslash\n\ttab and  separator.'
      const item = seedItem({ text, title: 'Mixed' })

      setProject(1, null)
      await build()

      const pack = await readPack(1)
      const expected = chunkKnowledgeText({
        itemId: encodePublicId(item),
        title: 'Mixed',
        relativePath: null,
        text,
      })

      expect(pack!.lines).toEqual(expected)
    })
  })

  describe('commitKnowledgeChange', () => {
    function commit(removeItemIds?: number[]) {
      return commitKnowledgeChange({
        userId: OWNER,
        projectId: PROJECT,
        removeItemIds,
        logger,
      })
    }

    it('bumps the version once and builds the next pack', async () => {
      seedItem({ text: 'hello' })

      expect(await commit()).toEqual({ version: 1, packVersion: 1 })
      expect(projectRow()).toMatchObject({
        knowledge_version: 1,
        knowledge_pack_version: 1,
      })
      expect(bucket.objects.has(packKey(1))).toBe(true)
    })

    it('increments an existing version by exactly one', async () => {
      seedItem({ text: 'hello' })
      setProject(6, 6)

      expect(await commit()).toEqual({ version: 7, packVersion: 7 })
    })

    it('removes the listed items: text object first, then the row', async () => {
      const removed = seedItem({ text: 'drop me', createdAt: 1_000 })
      const kept = seedItem({ text: 'keep me', createdAt: 2_000 })

      expect(await commit([removed])).toEqual({ version: 1, packVersion: 1 })
      expect(bucket.objects.has(textKey(removed))).toBe(false)
      expect(bucket.objects.has(textKey(kept))).toBe(true)
      expect(testDb.countItems(PROJECT)).toBe(1)

      const pack = await readPack(1)

      expect(pack!.lines.map((line) => {
        return line.text
      })).toEqual(['keep me'])
    })

    it('scopes removal to this project and user', async () => {
      const mine = seedItem({ text: 'mine', createdAt: 1_000 })
      const sibling = seedItem({
        text: 'sibling',
        projectId: OTHER_PROJECT,
      })
      const foreign = seedItem({
        text: 'foreign',
        projectId: 12,
        userId: STRANGER,
      })

      await commit([mine, sibling, foreign, 987_654])

      expect(testDb.countItems(PROJECT)).toBe(0)
      expect(testDb.countItems(OTHER_PROJECT)).toBe(1)
      expect(testDb.countItems(12)).toBe(1)
      expect(bucket.objects.has(textKey(sibling, OTHER_PROJECT))).toBe(true)
      expect(bucket.objects.has(textKey(foreign, 12, STRANGER))).toBe(true)
      expect(bucket.operations.join('\n')).not.toContain(
        textKey(sibling, OTHER_PROJECT),
      )
      expect(bucket.operations.join('\n')).not.toContain(
        textKey(foreign, 12, STRANGER),
      )
    })

    it('removes many items in batches', async () => {
      const ids: number[] = []

      for (let index = 0; index < 205; index++) {
        ids.push(seedItem({ text: `item ${index}`, createdAt: 1_000 + index }))
      }

      await commit(ids)

      expect(testDb.countItems(PROJECT)).toBe(0)
      expect(bucket.deleteCalls.every((keys) => {
        return keys.length <= 90
      })).toBe(true)
      expect([...bucket.objects.keys()].filter((key) => {
        return key.includes('/items/')
      })).toEqual([])
    })

    it('ignores repeated and invalid ids in the removal list', async () => {
      const item = seedItem({ text: 'x' })

      await commit([item, item, 0, -3, 1.5, Number.NaN])

      expect(testDb.countItems(PROJECT)).toBe(0)
    })

    it('rejects with 404 for a foreign project without touching anything', async () => {
      const foreign = seedItem({
        text: 'foreign',
        projectId: 12,
        userId: STRANGER,
      })

      await expect(commitKnowledgeChange({
        userId: OWNER,
        projectId: 12,
        removeItemIds: [foreign],
      })).rejects.toMatchObject({ status: 404 })
      expect(testDb.countItems(12)).toBe(1)
      expect(bucket.operations).toEqual([])
      expect(testDb.getProjectRow(12)!.knowledge_version).toBeNull()
    })

    it('keeps the version bump when the build fails', async () => {
      seedItem({ text: 'x' })
      setProject(3, 3)
      bucket.hooks.failPut = (key) => {
        return key.includes('/pack/')
      }

      expect(await commit()).toEqual({ version: 4, packVersion: 3 })
      expect(projectRow()).toMatchObject({
        knowledge_version: 4,
        knowledge_pack_version: 3,
      })
      expect(loggedOperations()).toContain('commit-build')
      expect(kv.entries.size).toBe(0)
    })

    it('returns a null pack version when the first build fails', async () => {
      seedItem({ text: 'x' })
      bucket.hooks.failPut = () => true

      expect(await commit()).toEqual({ version: 1, packVersion: null })
    })

    it('returns the previous pack version while another build holds the lease', async () => {
      seedItem({ text: 'x' })
      setProject(2, 2)

      const held = await acquireKnowledgePackLease(PROJECT)

      try {
        expect(await commit()).toEqual({ version: 3, packVersion: 2 })
        expect(projectRow().knowledge_version).toBe(3)
      } finally {
        await held!.release()
      }
    })

    it('still bumps the version and rethrows when a removal fails', async () => {
      const item = seedItem({ text: 'x' })

      setProject(1, 1)
      bucket.hooks.failDelete = () => true

      await expect(commit([item])).rejects.toThrow('R2 delete failed')
      expect(projectRow().knowledge_version).toBe(2)
      expect(testDb.countItems(PROJECT)).toBe(1)
      expect(loggedOperations()).toContain('remove')
    })

    it('lets the next ensure rebuild after a failed removal', async () => {
      const item = seedItem({ text: 'x' })

      setProject(1, 1)
      bucket.hooks.failDelete = () => true
      await expect(commit([item])).rejects.toThrow()

      bucket.hooks.failDelete = undefined
      await ensureKnowledgePackFresh({
        userId: OWNER,
        projectId: PROJECT,
        logger,
      })

      expect(projectRow().knowledge_pack_version).toBe(2)
    })
  })

  describe('ensureKnowledgePackFresh', () => {
    function ensure() {
      return ensureKnowledgePackFresh({
        userId: OWNER,
        projectId: PROJECT,
        logger,
      })
    }

    it('rebuilds a stale pack', async () => {
      seedItem({ text: 'x' })
      setProject(2, 1)

      await ensure()

      expect(projectRow().knowledge_pack_version).toBe(2)
      expect(bucket.objects.has(packKey(2))).toBe(true)
    })

    it('builds the first pack when none exists yet', async () => {
      seedItem({ text: 'x' })
      setProject(1, null)

      await ensure()

      expect(projectRow().knowledge_pack_version).toBe(1)
    })

    it('does nothing when the pack is fresh', async () => {
      setProject(3, 3)

      await ensure()

      expect(bucket.operations).toEqual([])
      expect(kv.get).not.toHaveBeenCalled()
      expect(kv.put).not.toHaveBeenCalled()
    })

    it('does nothing for a project that never committed', async () => {
      seedItem({ text: 'x' })

      await ensure()

      expect(bucket.operations).toEqual([])
      expect(kv.put).not.toHaveBeenCalled()
    })

    it('does nothing while another build holds the lease', async () => {
      seedItem({ text: 'x' })
      setProject(2, 1)

      const held = await acquireKnowledgePackLease(PROJECT)

      try {
        await ensure()

        expect(bucket.operations).toEqual([])
        expect(projectRow().knowledge_pack_version).toBe(1)
      } finally {
        await held!.release()
      }
    })

    it('never throws for a missing or foreign project', async () => {
      await expect(ensureKnowledgePackFresh({
        userId: OWNER,
        projectId: 999,
      })).resolves.toBeUndefined()
      await expect(ensureKnowledgePackFresh({
        userId: OWNER,
        projectId: 12,
      })).resolves.toBeUndefined()
    })

    it('never throws when the build fails, and logs it', async () => {
      seedItem({ text: 'x' })
      setProject(2, 1)
      bucket.hooks.failPut = () => true

      await expect(ensure()).resolves.toBeUndefined()
      expect(loggedOperations()).toContain('ensure')
      expect(projectRow().knowledge_pack_version).toBe(1)
      expect(kv.entries.size).toBe(0)
    })

    it('never throws when the database is unavailable', async () => {
      vi.stubGlobal('useDb', () => {
        throw new Error('db down')
      })

      await expect(ensure()).resolves.toBeUndefined()
    })

    it('never throws when the logger itself fails', async () => {
      seedItem({ text: 'x' })
      setProject(2, 1)
      bucket.hooks.failPut = () => true
      logger.set.mockImplementation(() => {
        throw new Error('logger down')
      })

      await expect(ensure()).resolves.toBeUndefined()
    })

    it('works without a logger', async () => {
      seedItem({ text: 'x' })
      setProject(1, null)

      await expect(ensureKnowledgePackFresh({
        userId: OWNER,
        projectId: PROJECT,
      })).resolves.toBeUndefined()
      expect(projectRow().knowledge_pack_version).toBe(1)
    })
  })
})
