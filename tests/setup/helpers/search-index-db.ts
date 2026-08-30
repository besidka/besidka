import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

export interface SearchIndexTestDb {
  sqlite: InstanceType<typeof Database>
  db: ReturnType<typeof import('~~/server/utils/db').useDb>
  insertChat: (input: { id: number, userId: number }) => void
  insertMessage: (input: {
    id: number
    chatId: number
    parts?: unknown
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
      user_id integer NOT NULL
    );

    CREATE TABLE messages (
      id integer PRIMARY KEY,
      chat_id integer NOT NULL,
      parts text NOT NULL DEFAULT '[]'
    );

    CREATE INDEX idx_messages_chat_id ON messages (chat_id);

    CREATE VIRTUAL TABLE message_search USING fts5(
      owner,
      body,
      body_stem,
      tokenize = 'unicode61 remove_diacritics 2'
    );
  `)

  const db = drizzle({ client: sqlite }) as unknown as ReturnType<
    typeof import('~~/server/utils/db').useDb
  >

  function insertChat(input: { id: number, userId: number }): void {
    sqlite.prepare(
      'insert into chats (id, user_id) values (?, ?)',
    ).run(input.id, input.userId)
  }

  function insertMessage(input: {
    id: number
    chatId: number
    parts?: unknown
  }): void {
    sqlite.prepare(
      'insert into messages (id, chat_id, parts) values (?, ?, ?)',
    ).run(input.id, input.chatId, JSON.stringify(input.parts ?? []))
  }

  function close(): void {
    sqlite.close()
  }

  return {
    sqlite, db, insertChat, insertMessage, close,
  }
}
