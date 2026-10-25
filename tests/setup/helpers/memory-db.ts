import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { relations } from '~~/server/db/relations'

export interface MemoryTestDb {
  sqlite: InstanceType<typeof Database>
  db: ReturnType<typeof import('~~/server/utils/db').useDb>
  insertUserSettings: (input: {
    userId: number
    memoryEnabled?: boolean | null
    chatSearchEnabled?: boolean | null
    memoryIncludeSensitive?: boolean | null
    aboutMe?: string | null
  }) => void
  insertProject: (input: {
    id: number
    userId: number
    name?: string
    memory?: string | null
    useAccountMemory?: boolean | null
  }) => void
  insertEntry: (input: {
    id?: number
    userId: number
    projectId?: number | null
    category?: string
    slug: string
    title?: string
    description?: string
    body?: string
    sensitivity?: string
    sensitiveCategory?: string | null
    origin?: string
    sourceChatIds?: string[]
    sourceMessageId?: string | null
    updatedAt?: number
  }) => void
  countEntries: (userId?: number) => number
  close: () => void
}

/**
 * Creates an in-memory SQLite DB with the `memory_entries`, `user_settings`
 * and `projects` tables as the migrations define them, minus the foreign
 * keys, so a spec can seed a user or a project without a `users` row. The
 * `memory_entries` DDL and its two partial unique indexes are the exact
 * `20261025130157_memory_contract` migration statements.
 */
export function createMemoryTestDb(): MemoryTestDb {
  const sqlite = new Database(':memory:')

  sqlite.exec(`
    CREATE TABLE memory_entries (
      id integer PRIMARY KEY,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      user_id integer NOT NULL,
      project_id integer,
      category text NOT NULL,
      slug text NOT NULL,
      title text NOT NULL,
      description text NOT NULL,
      body text NOT NULL,
      sensitivity text NOT NULL,
      sensitive_category text,
      origin text NOT NULL,
      source_chat_ids text NOT NULL,
      source_message_id text,
      last_used_at integer
    );

    CREATE UNIQUE INDEX uq_memory_entries_account_slug
      ON memory_entries (user_id, category, slug)
      WHERE project_id is null;
    CREATE UNIQUE INDEX uq_memory_entries_project_slug
      ON memory_entries (user_id, project_id, category, slug)
      WHERE project_id is not null;
    CREATE INDEX idx_memory_entries_user_project
      ON memory_entries (user_id, project_id);
    CREATE INDEX idx_memory_entries_user_sensitivity
      ON memory_entries (user_id, sensitivity);

    CREATE TABLE user_settings (
      id integer PRIMARY KEY AUTOINCREMENT,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      user_id integer NOT NULL,
      reasoning_expanded integer NOT NULL DEFAULT 0,
      reasoning_auto_hide integer NOT NULL DEFAULT 1,
      allow_external_links integer,
      notification_prompt_state integer,
      sidebar_pinned integer,
      favorite_models text,
      favorite_gateway_models text,
      memory_enabled integer,
      chat_search_enabled integer,
      memory_include_sensitive integer,
      memory_extraction_enabled integer,
      about_me text,
      profile_memory_model text,
      profile_memory_gateway text,
      project_memory_model text,
      project_memory_gateway text
    );

    CREATE UNIQUE INDEX uq_user_settings_user ON user_settings (user_id);

    CREATE TABLE projects (
      id integer PRIMARY KEY,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      user_id integer NOT NULL,
      name text NOT NULL,
      instructions text,
      memory text,
      memory_status text NOT NULL DEFAULT 'idle',
      memory_updated_at integer,
      memory_dirty_at integer,
      memory_provider text,
      memory_model text,
      memory_error text,
      use_account_memory integer,
      memory_migrated_at integer,
      pinned_at integer,
      archived_at integer,
      activity_at integer NOT NULL
    );
  `)

  const db = drizzle({ client: sqlite, relations }) as unknown as ReturnType<
    typeof import('~~/server/utils/db').useDb
  >

  function nowSeconds(): number {
    return Math.floor(Date.now() / 1000)
  }

  function toFlag(value: boolean | null | undefined): number | null {
    if (value === null || value === undefined) {
      return null
    }

    return value ? 1 : 0
  }

  function insertUserSettings(input: {
    userId: number
    memoryEnabled?: boolean | null
    chatSearchEnabled?: boolean | null
    memoryIncludeSensitive?: boolean | null
    aboutMe?: string | null
  }): void {
    sqlite.prepare(
      'insert into user_settings (created_at, updated_at, user_id,'
      + ' memory_enabled, chat_search_enabled, memory_include_sensitive,'
      + ' about_me) values (?, ?, ?, ?, ?, ?, ?)',
    ).run(
      nowSeconds(),
      nowSeconds(),
      input.userId,
      toFlag(input.memoryEnabled),
      toFlag(input.chatSearchEnabled),
      toFlag(input.memoryIncludeSensitive),
      input.aboutMe ?? null,
    )
  }

  function insertProject(input: {
    id: number
    userId: number
    name?: string
    memory?: string | null
    useAccountMemory?: boolean | null
  }): void {
    sqlite.prepare(
      'insert into projects (id, created_at, updated_at, user_id, name,'
      + ' memory, use_account_memory, activity_at)'
      + ' values (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      input.id,
      nowSeconds(),
      nowSeconds(),
      input.userId,
      input.name ?? `Project ${input.id}`,
      input.memory ?? null,
      toFlag(input.useAccountMemory),
      nowSeconds(),
    )
  }

  function insertEntry(input: {
    id?: number
    userId: number
    projectId?: number | null
    category?: string
    slug: string
    title?: string
    description?: string
    body?: string
    sensitivity?: string
    sensitiveCategory?: string | null
    origin?: string
    sourceChatIds?: string[]
    sourceMessageId?: string | null
    updatedAt?: number
  }): void {
    const timestamp = input.updatedAt ?? nowSeconds()

    sqlite.prepare(
      'insert into memory_entries (id, created_at, updated_at, user_id,'
      + ' project_id, category, slug, title, description, body,'
      + ' sensitivity, sensitive_category, origin, source_chat_ids,'
      + ' source_message_id) values'
      + ' (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      input.id ?? null,
      timestamp,
      timestamp,
      input.userId,
      input.projectId ?? null,
      input.category ?? 'topics',
      input.slug,
      input.title ?? input.slug,
      input.description ?? `About ${input.slug}`,
      input.body ?? `Body of ${input.slug}`,
      input.sensitivity ?? 'none',
      input.sensitiveCategory ?? null,
      input.origin ?? 'user',
      JSON.stringify(input.sourceChatIds ?? []),
      input.sourceMessageId ?? null,
    )
  }

  function countEntries(userId?: number): number {
    const row = userId === undefined
      ? sqlite.prepare('select count(*) as total from memory_entries').get()
      : sqlite.prepare(
        'select count(*) as total from memory_entries where user_id = ?',
      ).get(userId)

    return (row as { total: number }).total
  }

  return {
    sqlite,
    db,
    insertUserSettings,
    insertProject,
    insertEntry,
    countEntries,
    close: () => sqlite.close(),
  }
}
