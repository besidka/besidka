import { beforeEach, describe, expect, it, vi } from 'vitest'

function createDb(row: Record<string, number> | null) {
  return {
    get: vi.fn(async () => row),
  }
}

async function importStats() {
  return import('../../../../server/utils/landing/stats')
}

describe('landing stats', () => {
  let capturedCacheOptions: Record<string, unknown> | undefined

  beforeEach(() => {
    vi.resetModules()
    capturedCacheOptions = undefined
    vi.stubGlobal('defineCachedFunction', vi.fn((
      fn: unknown,
      options: Record<string, unknown>,
    ) => {
      capturedCacheOptions = options

      return fn
    }))
  })

  it('maps every counted table into the stats shape, including researches', async () => {
    const db = createDb({
      users: 10,
      chats: 20,
      messages: 30,
      files: 40,
      sharedChats: 5,
      researches: 7,
    })

    vi.stubGlobal('useDb', () => db)

    const { readStatsFromDb } = await importStats()
    const result = await readStatsFromDb()

    expect(result).toEqual({
      users: 10,
      chats: 20,
      messages: 30,
      files: 40,
      sharedChats: 5,
      researches: 7,
      updatedAt: expect.any(String),
    })
    expect(db.get).toHaveBeenCalledTimes(1)
  })

  it('defaults every count to zero when the query returns no row', async () => {
    const db = createDb(null)

    vi.stubGlobal('useDb', () => db)

    const { readStatsFromDb } = await importStats()
    const result = await readStatsFromDb()

    expect(result).toEqual({
      users: 0,
      chats: 0,
      messages: 0,
      files: 0,
      sharedChats: 0,
      researches: 0,
      updatedAt: expect.any(String),
    })
  })

  it('bumps the cache name to v3 so the researches field cannot be served stale', async () => {
    vi.stubGlobal('useDb', () => createDb(null))

    await importStats()

    expect(capturedCacheOptions).toMatchObject({
      name: 'landing-stats-v3',
      group: 'landing',
    })
  })
})
