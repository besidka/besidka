import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { relations } from '~~/server/db/relations'
import * as schema from '~~/server/db/schema'
import { grantedLegalConsentValues } from '../fixtures/legal-consent'

type TestDb = ReturnType<typeof import('~~/server/utils/db').useDb>

export interface MemoryExtractionTestDb {
  sqlite: InstanceType<typeof Database>
  db: TestDb
  close: () => void
}

export const EXTRACTION_NOW = new Date('2026-10-25T12:00:00.000Z')

const MIGRATIONS_DIR = join(process.cwd(), '.drizzle/migrations')

const UNREPLAYABLE_MIGRATIONS_WITH_QUOTED_TOOLS = new Set([
  '20250708162612_icy_zombie',
  '20260226161520_silky_scourge',
])

const REQUIRED_COLUMNS: Record<string, string[]> = {
  chats: [
    'memory_extracted_at',
    'memory_extraction_attempted_at',
    'memory_extraction_failures',
    'memory_excluded',
  ],
  projects: ['memory_migrated_at'],
  user_settings: ['memory_extraction_enabled'],
}

function isKnownUnreplayableStatement(
  migrationName: string,
  statement: string,
  exception: unknown,
): boolean {
  return UNREPLAYABLE_MIGRATIONS_WITH_QUOTED_TOOLS.has(migrationName)
    && statement.includes('"tools"')
    && String(exception).includes('no such column')
}

function assertRequiredColumns(sqlite: InstanceType<typeof Database>) {
  for (const [table, columns] of Object.entries(REQUIRED_COLUMNS)) {
    const present = (
      sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
    ).map(column => column.name)

    for (const column of columns) {
      if (!present.includes(column)) {
        throw new Error(`Migration replay is missing ${table}.${column}`)
      }
    }
  }
}

export function minutesBefore(minutes: number, from = EXTRACTION_NOW): Date {
  return new Date(from.getTime() - minutes * 60 * 1000)
}

export function createMemoryExtractionTestDb(): MemoryExtractionTestDb {
  const sqlite = new Database(':memory:')

  sqlite.pragma('foreign_keys = OFF')

  const migrationNames = readdirSync(MIGRATIONS_DIR)
    .filter(name => /^\d{14}_/.test(name))
    .sort()

  for (const name of migrationNames) {
    const migrationSql = readFileSync(
      join(MIGRATIONS_DIR, name, 'migration.sql'),
      'utf-8',
    )

    for (const statement of migrationSql.split('--> statement-breakpoint')) {
      try {
        sqlite.exec(statement)
      } catch (exception) {
        if (!isKnownUnreplayableStatement(name, statement, exception)) {
          throw exception
        }
      }
    }
  }

  assertRequiredColumns(sqlite)

  sqlite.pragma('foreign_keys = ON')

  const db = drizzle({ client: sqlite, relations }) as unknown as TestDb

  Object.assign(db, {
    batch: async (statements: PromiseLike<unknown>[]) => {
      const results: unknown[] = []

      for (const statement of statements) {
        results.push(await statement)
      }

      return results
    },
  })

  return { sqlite, db, close: () => sqlite.close() }
}

let userSequence = 0

export async function seedUser(
  db: TestDb,
  settings: Partial<typeof schema.userSettings.$inferInsert> | null = {},
): Promise<number> {
  userSequence += 1

  const [user] = await db.insert(schema.users).values({
    name: `User ${userSequence}`,
    email: `user-${userSequence}-${Math.random()}@example.test`,
    emailVerified: true,
  }).returning({ id: schema.users.id })

  if (settings) {
    await db.insert(schema.userSettings).values({
      userId: user!.id,
      memoryExtractionEnabled: true,
      ...grantedLegalConsentValues,
      ...settings,
    })
  }

  return user!.id
}

export async function seedProject(
  db: TestDb,
  userId: number,
  values: Partial<typeof schema.projects.$inferInsert> = {},
): Promise<string> {
  const [project] = await db.insert(schema.projects).values({
    userId,
    name: 'Project',
    ...values,
  }).returning({ id: schema.projects.id })

  return project!.id
}

export async function seedChat(
  db: TestDb,
  userId: number,
  values: Partial<typeof schema.chats.$inferInsert> = {},
): Promise<{ id: string, slug: string }> {
  const [chat] = await db.insert(schema.chats).values({
    userId,
    createdAt: minutesBefore(120),
    activityAt: minutesBefore(60),
    ...values,
  }).returning({ id: schema.chats.id, slug: schema.chats.slug })

  return chat!
}

export async function seedMessage(
  db: TestDb,
  chatId: string,
  role: 'user' | 'assistant',
  parts: unknown[],
  createdAt: Date,
  values: Partial<typeof schema.messages.$inferInsert> = {},
): Promise<void> {
  await db.insert(schema.messages).values({
    chatId,
    role,
    parts: parts as never,
    createdAt,
    ...values,
  })
}

export function textPart(text: string) {
  return { type: 'text', text }
}

export async function seedKey(
  db: TestDb,
  userId: number,
  provider: typeof schema.keys.$inferInsert['provider'],
): Promise<void> {
  await db.insert(schema.keys).values({
    userId,
    provider,
    apiKey: 'encrypted',
  })
}

export async function seedEntry(
  db: TestDb,
  userId: number,
  values: Partial<typeof schema.memoryEntries.$inferInsert> = {},
) {
  const [entry] = await db.insert(schema.memoryEntries).values({
    userId,
    category: 'topics',
    slug: 'seeded',
    title: 'Seeded',
    description: 'Seeded entry',
    body: 'Seeded body text',
    sensitivity: 'none',
    origin: 'extraction',
    sourceChatIds: [],
    ...values,
  }).returning({ id: schema.memoryEntries.id })

  return entry!.id
}
