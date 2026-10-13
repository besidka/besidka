import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { and, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { accounts } from '~~/server/db/schemas/auth'

const MIGRATIONS_DIR = join(process.cwd(), '.drizzle/migrations')
const INITIAL_MIGRATION = '20250617221739_fast_the_call'
const TARGET_MIGRATION = '20261013154526_yummy_penance'

const GOOGLE_SUBJECT = '123456789012345678901'
const NEIGHBOUR_GOOGLE_SUBJECT = '123456789012345678902'
const SEVENTEEN_DIGIT_ID = '12345678901234567'

type SqliteDatabase = InstanceType<typeof Database>

interface LegacyAccountRow {
  id: number
  account_id: unknown
  account_id_type: string
  provider_account_id: string
}

const openDatabases: SqliteDatabase[] = []

afterEach(() => {
  while (openDatabases.length > 0) {
    openDatabases.pop()?.close()
  }
})

function readMigrationSql(migrationName: string): string {
  return readFileSync(
    join(MIGRATIONS_DIR, migrationName, 'migration.sql'),
    'utf-8',
  )
}

function extractCreateTable(sql: string, table: string): string {
  const start = sql.indexOf(`CREATE TABLE \`${table}\``)
  const end = sql.indexOf(');', start)

  if (start === -1 || end === -1) {
    throw new Error(`CREATE TABLE ${table} not found`)
  }

  return sql.slice(start, end + 2)
}

function createDatabase(withTargetMigration: boolean): SqliteDatabase {
  const sqlite = new Database(':memory:')
  const initialSql = readMigrationSql(INITIAL_MIGRATION)

  openDatabases.push(sqlite)
  sqlite.pragma('foreign_keys = ON')
  sqlite.exec(extractCreateTable(initialSql, 'users'))
  sqlite.exec(extractCreateTable(initialSql, 'accounts'))

  if (withTargetMigration) {
    sqlite.exec(readMigrationSql(TARGET_MIGRATION))
  }

  return sqlite
}

function insertUser(sqlite: SqliteDatabase, id: number): void {
  sqlite.prepare(
    `insert into users
      (id, created_at, updated_at, name, email, email_verified)
      values (?, 0, 0, ?, ?, 1)`,
  ).run(id, `User ${id}`, `user-${id}@example.com`)
}

function insertLegacyAccount(
  sqlite: SqliteDatabase,
  id: number,
  accountId: string,
  providerId: string,
  userId: number,
): void {
  sqlite.prepare(
    `insert into accounts
      (id, created_at, updated_at, account_id, provider_id, user_id)
      values (?, 0, 0, ?, ?, ?)`,
  ).run(id, accountId, providerId, userId)
}

function countRows(sqlite: SqliteDatabase, table: string): number {
  const row = sqlite.prepare(`select count(*) as total from ${table}`)
    .get() as { total: number }

  return row.total
}

describe('accounts.provider_account_id migration', () => {
  it('only adds a column or an index, never rebuilds a table', () => {
    const statements = readMigrationSql(TARGET_MIGRATION)
      .split('--> statement-breakpoint')
      .map((statement) => {
        return statement.trim()
      })
      .filter(Boolean)

    expect(statements.length).toBeGreaterThan(0)

    for (const statement of statements) {
      expect(statement).toMatch(
        /^(ALTER TABLE `accounts` ADD `[a-z_]+`|CREATE (UNIQUE )?INDEX)/,
      )
      expect(statement).not.toMatch(/DROP|__new_/i)
    }
  })

  it('keeps every legacy row and its account_id while adding an empty column', () => {
    const sqlite = createDatabase(false)

    insertUser(sqlite, 1)
    insertUser(sqlite, 2)
    insertLegacyAccount(sqlite, 1, '1', 'credential', 1)
    insertLegacyAccount(sqlite, 2, '9', 'github', 1)
    insertLegacyAccount(sqlite, 3, SEVENTEEN_DIGIT_ID, 'github', 2)
    insertLegacyAccount(sqlite, 4, GOOGLE_SUBJECT, 'google', 2)
    insertLegacyAccount(sqlite, 5, GOOGLE_SUBJECT, 'google', 2)

    const usersBefore = countRows(sqlite, 'users')
    const accountsBefore = countRows(sqlite, 'accounts')

    sqlite.exec(readMigrationSql(TARGET_MIGRATION))

    const rows = sqlite.prepare(
      `select id, account_id, typeof(account_id) as account_id_type,
        provider_account_id
        from accounts order by id`,
    ).all() as LegacyAccountRow[]

    expect(countRows(sqlite, 'users')).toBe(usersBefore)
    expect(countRows(sqlite, 'accounts')).toBe(accountsBefore)
    expect(rows.map((row) => {
      return [row.id, row.account_id_type, row.provider_account_id]
    })).toEqual([
      [1, 'integer', ''],
      [2, 'integer', ''],
      [3, 'integer', ''],
      [4, 'real', ''],
      [5, 'real', ''],
    ])
  })

  it('writes provider ids as exact text through the drizzle schema', () => {
    const sqlite = createDatabase(true)
    const db = drizzle({ client: sqlite })

    insertUser(sqlite, 1)

    db.insert(accounts).values({
      accountId: GOOGLE_SUBJECT,
      providerId: 'google',
      userId: 1,
    }).run()
    db.insert(accounts).values({
      accountId: '1',
      providerId: 'credential',
      userId: 1,
    }).run()

    const storedRows = sqlite.prepare(
      `select account_id, typeof(provider_account_id) as provider_type,
        provider_account_id
        from accounts order by id`,
    ).all()

    expect(storedRows).toEqual([
      {
        account_id: 0,
        provider_type: 'text',
        provider_account_id: GOOGLE_SUBJECT,
      },
      { account_id: 0, provider_type: 'text', provider_account_id: '1' },
    ])

    const credentialAccount = db.select().from(accounts)
      .where(eq(accounts.providerId, 'credential'))
      .get()

    expect(credentialAccount?.accountId).toBe('1')
  })

  it('no longer matches a neighbouring Google subject that rounds to the same double', () => {
    const sqlite = createDatabase(true)
    const db = drizzle({ client: sqlite })

    insertUser(sqlite, 1)

    db.insert(accounts).values({
      accountId: GOOGLE_SUBJECT,
      providerId: 'google',
      userId: 1,
    }).run()

    function findGoogleAccounts(subject: string) {
      return db.select().from(accounts)
        .where(and(
          eq(accounts.providerId, 'google'),
          eq(accounts.accountId, subject),
        ))
        .all()
    }

    expect(findGoogleAccounts(GOOGLE_SUBJECT)).toHaveLength(1)
    expect(findGoogleAccounts(NEIGHBOUR_GOOGLE_SUBJECT)).toHaveLength(0)
  })
})
