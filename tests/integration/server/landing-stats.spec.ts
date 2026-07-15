import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('landing statistics', () => {
  let sqlite: InstanceType<typeof Database>

  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('defineCachedFunction', (handler: unknown) => handler)

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
    const { readStatsFromDb } = await import(
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
  })
})
