import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { relations } from '~~/server/db/relations'

export interface SearchIndexTestDb {
  sqlite: InstanceType<typeof Database>
  db: ReturnType<typeof import('~~/server/utils/db').useDb>
  insertChat: (input: {
    id: number
    userId: number
    slug?: string
    title?: string
    projectId?: number
    memoryExcluded?: boolean
  }) => void
  insertMessage: (input: {
    id: number
    chatId: number
    parts?: unknown
    publicId?: string
    role?: string
    createdAt?: number
  }) => void
  close: () => void
}

/**
 * Creates an in-memory SQLite DB with chats/messages/idx_messages_chat_id
 * and the exact message_search DDL from the migration. Returns raw
 * better-sqlite3 handles plus small insert helpers.
 */
export function createSearchIndexTestDb(): SearchIndexTestDb {
  const sqlite = new Database(':memory:')

  sqlite.exec(`
    CREATE TABLE chats (
      id integer PRIMARY KEY,
      user_id integer NOT NULL,
      slug text,
      title text,
      project_id integer,
      memory_excluded integer
    );

    CREATE TABLE messages (
      id integer PRIMARY KEY,
      chat_id integer NOT NULL,
      parts text NOT NULL DEFAULT '[]',
      public_id text,
      role text,
      created_at integer
    );

    CREATE INDEX idx_messages_chat_id ON messages (chat_id);

    CREATE VIRTUAL TABLE message_search USING fts5(
      owner,
      body,
      body_stem,
      tokenize = 'unicode61 remove_diacritics 2'
    );
  `)

  const db = drizzle({ client: sqlite, relations }) as unknown as ReturnType<
    typeof import('~~/server/utils/db').useDb
  >

  function insertChat(input: {
    id: number
    userId: number
    slug?: string
    title?: string
    projectId?: number
    memoryExcluded?: boolean
  }): void {
    sqlite.prepare(
      'insert into chats'
      + ' (id, user_id, slug, title, project_id, memory_excluded)'
      + ' values (?, ?, ?, ?, ?, ?)',
    ).run(
      input.id,
      input.userId,
      input.slug ?? null,
      input.title ?? null,
      input.projectId ?? null,
      input.memoryExcluded === undefined ? null : Number(input.memoryExcluded),
    )
  }

  function insertMessage(input: {
    id: number
    chatId: number
    parts?: unknown
    publicId?: string
    role?: string
    createdAt?: number
  }): void {
    sqlite.prepare(
      'insert into messages (id, chat_id, parts, public_id, role, created_at)'
      + ' values (?, ?, ?, ?, ?, ?)',
    ).run(
      input.id,
      input.chatId,
      JSON.stringify(input.parts ?? []),
      input.publicId ?? null,
      input.role ?? null,
      input.createdAt ?? null,
    )
  }

  function close(): void {
    sqlite.close()
  }

  return {
    sqlite, db, insertChat, insertMessage, close,
  }
}
