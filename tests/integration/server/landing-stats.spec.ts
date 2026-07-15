import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const defineCachedFunction = vi.fn((handler: unknown) => handler)

describe('landing statistics', () => {
  let sqlite: InstanceType<typeof Database>

  beforeEach(() => {
    vi.resetModules()
    defineCachedFunction.mockClear()
    vi.stubGlobal('defineCachedFunction', defineCachedFunction)

    sqlite = new Database(':memory:')
    sqlite.exec(`
      CREATE TABLE users (id integer PRIMARY KEY);
      CREATE TABLE chats (id integer PRIMARY KEY);
      CREATE TABLE messages (id integer PRIMARY KEY);
      CREATE TABLE files (
        id integer PRIMARY KEY,
        source text NOT NULL,
        type text NOT NULL
      );
      CREATE TABLE chat_shares (id integer PRIMARY KEY);

      INSERT INTO users (id) VALUES (1), (2);
      INSERT INTO chats (id) VALUES (1);
      INSERT INTO messages (id) VALUES (1), (2), (3);
      INSERT INTO files (id, source, type) VALUES
        (1, 'upload', 'image/jpeg'),
        (2, 'upload', 'application/pdf'),
        (3, 'assistant', 'image/webp'),
        (4, 'assistant', 'application/pdf');
      INSERT INTO chat_shares (id) VALUES (1), (2);
    `)

    const database = drizzle({ client: sqlite })

    vi.stubGlobal('useDb', () => database)
  })

  afterEach(() => {
    sqlite.close()
    vi.unstubAllGlobals()
  })

  it('separates uploaded files from assistant-generated images', async () => {
    const { LANDING_STATS_CACHE_NAME, readStatsFromDb } = await import(
      '../../../server/utils/landing/stats'
    )

    const result = await readStatsFromDb()

    expect(result).toEqual({
      users: 2,
      chats: 1,
      messages: 3,
      files: 4,
      uploadedFiles: 2,
      generatedImages: 1,
      sharedChats: 2,
      updatedAt: expect.any(String),
    })
    expect(LANDING_STATS_CACHE_NAME).toBe(
      'landing-stats-image-generation-v1',
    )
    expect(defineCachedFunction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ name: LANDING_STATS_CACHE_NAME }),
    )
  })
})
