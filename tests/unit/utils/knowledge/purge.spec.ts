import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  deleteKnowledgePrefix,
  purgeProjectKnowledge,
  purgeProjectKnowledgeForProject,
} from '~~/server/utils/knowledge/purge'

interface FakeBucketOptions {
  keys: string[]
  pageSize?: number
}

function createFakeBucket(options: FakeBucketOptions) {
  const remaining = new Set(options.keys)
  const pageSize = options.pageSize ?? 1000
  const callLog: string[] = []
  let inFlight = 0
  let maxInFlight = 0

  async function trackConcurrency<T>(action: () => T): Promise<T> {
    inFlight++
    maxInFlight = Math.max(maxInFlight, inFlight)
    await Promise.resolve()

    const value = action()

    inFlight--

    return value
  }

  const list = vi.fn(async (listOptions: {
    prefix: string
    cursor?: string
    limit: number
  }) => {
    return trackConcurrency(() => {
      callLog.push('list')

      const matching = [...remaining]
        .filter((key) => {
          return key.startsWith(listOptions.prefix)
        })
        .sort()
      const page = matching.slice(0, Math.min(pageSize, listOptions.limit))
      const truncated = matching.length > page.length

      return {
        objects: page.map((key) => {
          return { key }
        }),
        truncated,
        cursor: truncated ? `cursor-${page.length}` : undefined,
      }
    })
  })
  const deleteKeys = vi.fn(async (keys: string[]) => {
    return trackConcurrency(() => {
      callLog.push('delete')

      for (const key of keys) {
        remaining.delete(key)
      }
    })
  })

  return {
    list,
    delete: deleteKeys,
    remaining,
    callLog,
    getMaxInFlight: () => maxInFlight,
  }
}

function buildKeys(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_key, index) => {
    return `${prefix}items/${String(index).padStart(5, '0')}.md`
  })
}

describe('deleteKnowledgePrefix', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deletes nothing and makes no delete call for an empty prefix', async () => {
    const bucket = createFakeBucket({ keys: [] })
    const result = await deleteKnowledgePrefix('knowledge/u1/', bucket)

    expect(result).toEqual({ objectsDeleted: 0, batches: 0 })
    expect(bucket.delete).not.toHaveBeenCalled()
  })

  it('deletes a single page in one batch call', async () => {
    const keys = buildKeys('knowledge/u1/p1/', 3)
    const bucket = createFakeBucket({ keys })
    const result = await deleteKnowledgePrefix('knowledge/u1/', bucket)

    expect(bucket.delete).toHaveBeenCalledTimes(1)
    expect(bucket.delete).toHaveBeenCalledWith(keys)
    expect(result).toEqual({ objectsDeleted: 3, batches: 1 })
  })

  it('paginates over more than 1000 keys with the cursor', async () => {
    const keys = buildKeys('knowledge/u1/p1/', 2500)
    const bucket = createFakeBucket({ keys })
    const result = await deleteKnowledgePrefix('knowledge/u1/', bucket)

    expect(result).toEqual({ objectsDeleted: 2500, batches: 3 })
    expect(bucket.remaining.size).toBe(0)
    expect(bucket.delete.mock.calls.map(([batch]) => batch.length)).toEqual([
      1000,
      1000,
      500,
    ])
    expect(bucket.list).toHaveBeenCalledTimes(3)
    expect(bucket.list.mock.calls[0]![0]).toEqual({
      prefix: 'knowledge/u1/',
      cursor: undefined,
      limit: 1000,
    })
    expect(bucket.list.mock.calls[1]![0].cursor).toBe('cursor-1000')
  })

  it('processes pages sequentially with one connection at a time', async () => {
    const bucket = createFakeBucket({
      keys: buildKeys('knowledge/u1/p1/', 25),
      pageSize: 10,
    })

    await deleteKnowledgePrefix('knowledge/u1/', bucket)

    expect(bucket.getMaxInFlight()).toBe(1)
    expect(bucket.callLog).toEqual([
      'list',
      'delete',
      'list',
      'delete',
      'list',
      'delete',
    ])
  })

  it('only removes objects under the given prefix', async () => {
    const ownKeys = buildKeys('knowledge/u1/p1/', 2)
    const strangerKeys = buildKeys('knowledge/u12/p1/', 2)
    const bucket = createFakeBucket({ keys: [...ownKeys, ...strangerKeys] })

    await deleteKnowledgePrefix('knowledge/u1/', bucket)

    expect([...bucket.remaining].sort()).toEqual(strangerKeys)
  })

  it.each([
    '',
    'knowledge/',
    'knowledge',
    'users/1/',
    'knowledge/u1',
    '/knowledge/u1/',
    'files/knowledge/u1/',
    'knowledge/u/',
    'knowledge/uploads/',
    'knowledge/u0/',
    'knowledge/u01/',
    'knowledge/u1/p/',
    'knowledge/u1/p0/',
    'knowledge/u1/p1/items/',
  ])('refuses the prefix "%s" before touching the bucket', async (prefix) => {
    const bucket = createFakeBucket({ keys: ['users/1/a.png'] })

    await expect(deleteKnowledgePrefix(prefix, bucket)).rejects.toThrow()
    expect(bucket.list).not.toHaveBeenCalled()
    expect(bucket.delete).not.toHaveBeenCalled()
  })

  it('rethrows a delete failure without continuing', async () => {
    const bucket = createFakeBucket({
      keys: buildKeys('knowledge/u1/p1/', 30),
      pageSize: 10,
    })

    bucket.delete.mockRejectedValueOnce(new Error('r2 unavailable'))

    await expect(deleteKnowledgePrefix('knowledge/u1/', bucket))
      .rejects.toThrow('r2 unavailable')
    expect(bucket.list).toHaveBeenCalledTimes(1)
  })

  it('rethrows a list failure', async () => {
    const bucket = createFakeBucket({ keys: [] })

    bucket.list.mockRejectedValueOnce(new Error('list failed'))

    await expect(deleteKnowledgePrefix('knowledge/u1/', bucket))
      .rejects.toThrow('list failed')
    expect(bucket.delete).not.toHaveBeenCalled()
  })

  it('throws when a truncated page carries no cursor', async () => {
    const bucket = createFakeBucket({ keys: [] })

    bucket.list.mockResolvedValueOnce({
      objects: [{ key: 'knowledge/u1/p1/items/1.md' }],
      truncated: true,
      cursor: undefined,
    })

    await expect(deleteKnowledgePrefix('knowledge/u1/', bucket))
      .rejects.toThrow('Knowledge purge stopped before listing finished')
    expect(bucket.list).toHaveBeenCalledTimes(1)
  })
})

describe('purgeProjectKnowledge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('purges the user prefix through the file storage binding', async () => {
    const ownKeys = [
      ...buildKeys('knowledge/u42/p1/', 2),
      ...buildKeys('knowledge/u42/p2/', 1),
    ]
    const strangerKeys = buildKeys('knowledge/u420/p1/', 1)
    const bucket = createFakeBucket({ keys: [...ownKeys, ...strangerKeys] })

    vi.stubGlobal('useFileStorage', () => bucket)

    const result = await purgeProjectKnowledge(42)

    expect(result).toEqual({ objectsDeleted: 3, batches: 1 })
    expect([...bucket.remaining]).toEqual(strangerKeys)
    expect(bucket.list.mock.calls[0]![0].prefix).toBe('knowledge/u42/')
  })

  it('rejects an invalid user id before touching the bucket', async () => {
    const bucket = createFakeBucket({ keys: [] })

    vi.stubGlobal('useFileStorage', () => bucket)

    await expect(purgeProjectKnowledge(0)).rejects.toThrow()
    expect(bucket.list).not.toHaveBeenCalled()
  })
})

describe('purgeProjectKnowledgeForProject', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('purges only the project prefix of that user', async () => {
    const projectKeys = buildKeys('knowledge/u42/p1/', 2)
    const otherProjectKeys = buildKeys('knowledge/u42/p10/', 1)
    const otherUserKeys = buildKeys('knowledge/u43/p1/', 1)
    const bucket = createFakeBucket({
      keys: [...projectKeys, ...otherProjectKeys, ...otherUserKeys],
    })

    vi.stubGlobal('useFileStorage', () => bucket)

    const result = await purgeProjectKnowledgeForProject(42, 1)

    expect(result).toEqual({ objectsDeleted: 2, batches: 1 })
    expect([...bucket.remaining].sort()).toEqual(
      [...otherProjectKeys, ...otherUserKeys].sort(),
    )
    expect(bucket.list.mock.calls[0]![0].prefix).toBe('knowledge/u42/p1/')
  })
})
