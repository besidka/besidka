import { vi } from 'vitest'
import { eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'

type TestDb = ReturnType<typeof import('~~/server/utils/db').useDb>

type DocumentValues = Partial<typeof schema.documents.$inferInsert> & {
  userId: number
}

export interface FakeDocumentStorage {
  objects: Map<string, string>
  deleteCalls: string[][]
  listCalls: Array<{ prefix: string, cursor?: string, limit: number }>
  put: ReturnType<typeof vi.fn>
  get: ReturnType<typeof vi.fn>
  delete: ReturnType<typeof vi.fn>
  list: ReturnType<typeof vi.fn>
}

export function createFakeDocumentStorage(
  pageSize = 1000,
): FakeDocumentStorage {
  const objects = new Map<string, string>()
  const deleteCalls: string[][] = []
  const listCalls: FakeDocumentStorage['listCalls'] = []

  return {
    objects,
    deleteCalls,
    listCalls,
    put: vi.fn(async (key: string, body: string) => {
      objects.set(key, body)
    }),
    get: vi.fn(async (key: string) => {
      const text = objects.get(key)

      if (text === undefined) {
        return null
      }

      return { text: async () => text }
    }),
    delete: vi.fn(async (keys: string | string[]) => {
      const list = Array.isArray(keys) ? keys : [keys]

      deleteCalls.push([...list])

      for (const key of list) {
        objects.delete(key)
      }
    }),
    list: vi.fn(async (options: {
      prefix: string
      cursor?: string
      limit: number
    }) => {
      listCalls.push(options)

      const matching = [...objects.keys()]
        .filter(key => key.startsWith(options.prefix))
        .filter(key => !options.cursor || key > options.cursor)
        .sort()
      const page = matching.slice(0, pageSize)
      const isTruncated = matching.length > page.length

      return {
        objects: page.map(key => ({ key })),
        truncated: isTruncated,
        cursor: isTruncated ? page[page.length - 1] : undefined,
      }
    }),
  }
}

export async function seedDocument(
  db: TestDb,
  values: DocumentValues,
): Promise<typeof schema.documents.$inferSelect> {
  const [row] = await db.insert(schema.documents).values({
    format: 'pdf',
    title: 'Quarterly report',
    status: 'spec_ready',
    createdVia: 'chat',
    specVersion: 1,
    ...values,
  }).returning()

  return row!
}

export async function seedDocumentWithSpec(
  db: TestDb,
  storage: FakeDocumentStorage,
  values: DocumentValues,
): Promise<typeof schema.documents.$inferSelect> {
  const row = await seedDocument(db, values)
  const specR2Key = `documents/${values.userId}/${row.id}/spec.v1.json`

  storage.objects.set(specR2Key, '{"version":1}')

  await db.update(schema.documents)
    .set({ specR2Key, specBytes: 13, updatedAt: row.updatedAt })
    .where(eq(schema.documents.id, row.id))

  return { ...row, specR2Key, specBytes: 13 }
}

export async function readDocument(
  db: TestDb,
  documentId: string,
): Promise<typeof schema.documents.$inferSelect | undefined> {
  const [row] = await db.select()
    .from(schema.documents)
    .where(eq(schema.documents.id, documentId))

  return row
}
