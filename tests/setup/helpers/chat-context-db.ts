import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { relations } from '~~/server/db/relations'

export interface ChatContextTestDb {
  sqlite: InstanceType<typeof Database>
  db: ReturnType<typeof import('~~/server/utils/db').useDb>
  insertProject: (input: {
    id: number
    userId: number
    name: string
  }) => void
  insertChat: (input: {
    id: number
    userId: number
    slug: string
    title?: string | null
    projectId?: number | null
    memoryExcluded?: boolean | null
  }) => void
  insertMessage: (input: {
    id: number
    chatId: number
    publicId?: string | null
    role: 'user' | 'assistant'
    parts: unknown[]
    tools?: unknown[]
    usage?: Record<string, unknown> | null
    createdAtSeconds?: number
  }) => void
  insertShare: (input: {
    id: number
    chatId: number
    slug: string
    revoked?: boolean
    expiresAtSeconds?: number | null
    showFiles?: boolean
    showMetadata?: boolean
    allowBranch?: boolean
  }) => void
  insertArtifact: (input: ChatContextTestArtifact) => void
  close: () => void
}

export interface ChatContextTestArtifact {
  id: number
  userId: number
  title: string
  kind?: string
  currentVersion: number
  takedownAtSeconds?: number | null
}

const BASE_TIMESTAMP_SECONDS = 1_790_000_000

function toFlag(value: boolean): number {
  return value ? 1 : 0
}

/**
 * An in-memory SQLite DB with the `chats`, `messages`, `projects`,
 * `chat_shares` and `artifacts` columns the chat context loaders read, minus
 * the foreign keys, so a spec can seed a chat without a `users` row. Ids go
 * through the `publicIdMockFactory` (`pub-<n>`), so the spec that uses it
 * must mock `~~/server/utils/custom-db-types` with that factory.
 */
export function createChatContextTestDb(): ChatContextTestDb {
  const sqlite = new Database(':memory:')

  sqlite.exec(`
    CREATE TABLE projects (
      id integer PRIMARY KEY,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      user_id integer NOT NULL,
      name text NOT NULL
    );

    CREATE TABLE chats (
      id integer PRIMARY KEY,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      slug text NOT NULL UNIQUE,
      user_id integer NOT NULL,
      title text DEFAULT '',
      project_id integer,
      memory_excluded integer,
      activity_at integer NOT NULL
    );

    CREATE TABLE messages (
      id integer PRIMARY KEY AUTOINCREMENT,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      chat_id integer NOT NULL,
      role text NOT NULL,
      parts text NOT NULL DEFAULT '[]',
      tools text NOT NULL DEFAULT '[]',
      reasoning text NOT NULL DEFAULT 'off',
      usage text,
      public_id text UNIQUE
    );

    CREATE TABLE chat_shares (
      id integer PRIMARY KEY,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      slug text,
      chat_id integer NOT NULL,
      revoked integer NOT NULL DEFAULT 0,
      expires_at integer,
      indexable integer NOT NULL DEFAULT 1,
      show_files integer NOT NULL DEFAULT 1,
      show_metadata integer NOT NULL DEFAULT 1,
      show_author_avatar integer NOT NULL DEFAULT 1,
      allow_branch integer NOT NULL DEFAULT 1
    );

    CREATE TABLE artifacts (
      id integer PRIMARY KEY,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      user_id integer NOT NULL,
      origin_chat_id integer,
      origin_message_id text,
      kind text NOT NULL,
      title text NOT NULL,
      current_version integer NOT NULL,
      total_bytes integer NOT NULL,
      created_via text NOT NULL,
      takedown_at integer,
      takedown_reason text,
      legal_hold_until integer
    );
  `)

  const db = drizzle({ client: sqlite, relations }) as unknown as ReturnType<
    typeof import('~~/server/utils/db').useDb
  >

  function insertProject(input: {
    id: number
    userId: number
    name: string
  }): void {
    sqlite.prepare(
      'insert into projects (id, created_at, updated_at, user_id, name)'
      + ' values (?, ?, ?, ?, ?)',
    ).run(
      input.id,
      BASE_TIMESTAMP_SECONDS,
      BASE_TIMESTAMP_SECONDS,
      input.userId,
      input.name,
    )
  }

  function insertChat(input: {
    id: number
    userId: number
    slug: string
    title?: string | null
    projectId?: number | null
    memoryExcluded?: boolean | null
  }): void {
    sqlite.prepare(
      'insert into chats (id, created_at, updated_at, slug, user_id, title,'
      + ' project_id, memory_excluded, activity_at)'
      + ' values (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      input.id,
      BASE_TIMESTAMP_SECONDS,
      BASE_TIMESTAMP_SECONDS,
      input.slug,
      input.userId,
      input.title === undefined ? 'A chat' : input.title,
      input.projectId ?? null,
      input.memoryExcluded === undefined || input.memoryExcluded === null
        ? null
        : toFlag(input.memoryExcluded),
      BASE_TIMESTAMP_SECONDS,
    )
  }

  function insertMessage(input: {
    id: number
    chatId: number
    publicId?: string | null
    role: 'user' | 'assistant'
    parts: unknown[]
    tools?: unknown[]
    usage?: Record<string, unknown> | null
    createdAtSeconds?: number
  }): void {
    const createdAtSeconds = input.createdAtSeconds
      ?? BASE_TIMESTAMP_SECONDS + input.id

    sqlite.prepare(
      'insert into messages (id, created_at, updated_at, chat_id, role,'
      + ' parts, tools, usage, public_id) values (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      input.id,
      createdAtSeconds,
      createdAtSeconds,
      input.chatId,
      input.role,
      JSON.stringify(input.parts),
      JSON.stringify(input.tools ?? []),
      input.usage ? JSON.stringify(input.usage) : null,
      input.publicId === undefined ? `message-${input.id}` : input.publicId,
    )
  }

  function insertShare(input: {
    id: number
    chatId: number
    slug: string
    revoked?: boolean
    expiresAtSeconds?: number | null
    showFiles?: boolean
    showMetadata?: boolean
    allowBranch?: boolean
  }): void {
    sqlite.prepare(
      'insert into chat_shares (id, created_at, updated_at, slug, chat_id,'
      + ' revoked, expires_at, show_files, show_metadata, allow_branch)'
      + ' values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      input.id,
      BASE_TIMESTAMP_SECONDS,
      BASE_TIMESTAMP_SECONDS,
      input.slug,
      input.chatId,
      toFlag(input.revoked ?? false),
      input.expiresAtSeconds ?? null,
      toFlag(input.showFiles ?? true),
      toFlag(input.showMetadata ?? true),
      toFlag(input.allowBranch ?? true),
    )
  }

  function insertArtifact(input: ChatContextTestArtifact): void {
    sqlite.prepare(
      'insert into artifacts (id, created_at, updated_at, user_id, kind,'
      + ' title, current_version, total_bytes, created_via, takedown_at)'
      + ' values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      input.id,
      BASE_TIMESTAMP_SECONDS,
      BASE_TIMESTAMP_SECONDS,
      input.userId,
      input.kind ?? 'html',
      input.title,
      input.currentVersion,
      100,
      'chat',
      input.takedownAtSeconds ?? null,
    )
  }

  return {
    sqlite,
    db,
    insertProject,
    insertChat,
    insertMessage,
    insertShare,
    insertArtifact,
    close: () => {
      sqlite.close()
    },
  }
}
