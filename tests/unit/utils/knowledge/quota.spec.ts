import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getUserStorageUsageBytes } from '~~/server/utils/files/file-governance'
import { getUserKnowledgeTextBytes } from '~~/server/utils/knowledge/quota'

type SqliteDatabase = InstanceType<typeof Database>

/**
 * The better-sqlite3 driver has no select `.get()`, which the D1 driver
 * used in production provides, so the shim runs the real built SQL through
 * better-sqlite3 and exposes the same single-row `.get()`.
 */

function createDb(sqlite: SqliteDatabase) {
  sqlite.exec(`
    CREATE TABLE files (
      id integer PRIMARY KEY,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      user_id integer NOT NULL,
      storage_key text NOT NULL,
      name text NOT NULL,
      size integer NOT NULL
    );

    CREATE TABLE project_knowledge_items (
      id integer PRIMARY KEY,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      user_id integer NOT NULL,
      project_id integer NOT NULL,
      text_bytes integer NOT NULL
    );
  `)

  const builder = drizzle({ client: sqlite })

  return {
    select(fields: Parameters<typeof builder.select>[0]) {
      return {
        from(table: Parameters<ReturnType<typeof builder.select>['from']>[0]) {
          return {
            where(condition: Parameters<
              ReturnType<ReturnType<typeof builder.select>['from']>['where']
            >[0]) {
              const query = builder
                .select(fields as never)
                .from(table)
                .where(condition)

              return {
                async get() {
                  const { sql, params } = query.toSQL()
                  const row = sqlite
                    .prepare(sql)
                    .raw()
                    .get(...params) as unknown[] | undefined

                  return row ? { used: row[0] } : undefined
                },
              }
            },
          }
        },
      }
    },
  }
}

describe('knowledge quota', () => {
  let sqlite: SqliteDatabase
  let nextId: number

  function insertFile(userId: number, size: number): void {
    nextId++
    sqlite
      .prepare(`
        INSERT INTO files
          (id, created_at, updated_at, user_id, storage_key, name, size)
        VALUES (?, 0, 0, ?, ?, 'f', ?)
      `)
      .run(nextId, userId, `key-${nextId}`, size)
  }

  function insertKnowledgeItem(userId: number, textBytes: number): void {
    nextId++
    sqlite
      .prepare(`
        INSERT INTO project_knowledge_items
          (id, created_at, updated_at, user_id, project_id, text_bytes)
        VALUES (?, 0, 0, ?, 1, ?)
      `)
      .run(nextId, userId, textBytes)
  }

  beforeEach(() => {
    nextId = 0
    sqlite = new Database(':memory:')

    const db = createDb(sqlite)

    vi.stubGlobal('useDb', () => db)
  })

  afterEach(() => {
    sqlite.close()
  })

  describe('getUserKnowledgeTextBytes', () => {
    it('returns zero when the user has no items', async () => {
      expect(await getUserKnowledgeTextBytes(1)).toBe(0)
    })

    it('sums the extracted text bytes of the user items', async () => {
      insertKnowledgeItem(1, 100)
      insertKnowledgeItem(1, 250)

      expect(await getUserKnowledgeTextBytes(1)).toBe(350)
    })

    it('ignores the items of other users', async () => {
      insertKnowledgeItem(1, 100)
      insertKnowledgeItem(2, 9_999)

      expect(await getUserKnowledgeTextBytes(1)).toBe(100)
    })

    it('ignores uploaded files', async () => {
      insertFile(1, 5_000)
      insertKnowledgeItem(1, 10)

      expect(await getUserKnowledgeTextBytes(1)).toBe(10)
    })
  })

  describe('getUserStorageUsageBytes', () => {
    it('returns zero for a user with neither files nor items', async () => {
      expect(await getUserStorageUsageBytes(1)).toBe(0)
    })

    it('returns the files sum alone when there is no knowledge', async () => {
      insertFile(1, 1_000)
      insertFile(1, 500)

      expect(await getUserStorageUsageBytes(1)).toBe(1_500)
    })

    it('returns the knowledge sum alone when there are no files', async () => {
      insertKnowledgeItem(1, 700)

      expect(await getUserStorageUsageBytes(1)).toBe(700)
    })

    it('adds the files sum and the knowledge sum', async () => {
      insertFile(1, 1_000)
      insertFile(1, 500)
      insertKnowledgeItem(1, 700)
      insertKnowledgeItem(1, 300)

      expect(await getUserStorageUsageBytes(1)).toBe(2_500)
    })

    it('does not count rows of other users', async () => {
      insertFile(1, 1_000)
      insertFile(2, 50_000)
      insertKnowledgeItem(1, 200)
      insertKnowledgeItem(2, 70_000)

      expect(await getUserStorageUsageBytes(1)).toBe(1_200)
      expect(await getUserStorageUsageBytes(2)).toBe(120_000)
    })

    it('runs as a single query ending in one get call', async () => {
      const get = vi.fn(async () => ({ used: 42 }))
      const where = vi.fn(() => ({ get }))
      const from = vi.fn(() => ({ where }))
      const select = vi.fn(() => ({ from }))

      vi.stubGlobal('useDb', () => ({ select }))

      expect(await getUserStorageUsageBytes(1)).toBe(42)
      expect(select).toHaveBeenCalledTimes(1)
      expect(get).toHaveBeenCalledTimes(1)
    })
  })
})
