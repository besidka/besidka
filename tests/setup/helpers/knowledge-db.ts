import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { relations } from '~~/server/db/relations'

export interface KnowledgeTestItemInput {
  id: number
  userId: number
  projectId: number
  kind?: 'file' | 'note'
  fileId?: number | null
  title?: string
  description?: string | null
  relativePath?: string | null
  folderId?: string | null
  mediaType?: string | null
  sizeBytes?: number | null
  pageCount?: number | null
  textBytes?: number
  latinChars?: number
  cyrillicChars?: number
  otherChars?: number
  extractStatus?: 'ready' | 'no-text' | 'failed'
  extractor?: string
  sendAsNativePdf?: boolean | null
  pinned?: boolean | null
}

export interface KnowledgeTestDb {
  sqlite: InstanceType<typeof Database>
  db: ReturnType<typeof import('~~/server/utils/db').useDb>
  insertProject: (input: {
    id: number
    userId: number
    knowledgeMode?: string | null
    knowledgeVersion?: number | null
    knowledgePackVersion?: number | null
  }) => void
  insertFile: (input: {
    id: number
    userId: number
    storageKey: string
    name?: string
    size?: number
    type?: string
  }) => void
  insertItem: (input: KnowledgeTestItemInput) => void
  close: () => void
}

/**
 * Creates an in-memory SQLite DB with `projects`, `files` and
 * `project_knowledge_items` as the migrations define them, minus the foreign
 * keys, so a spec can seed a project or an item without a `users` row. The
 * `project_knowledge_items` DDL is the exact
 * `20261025214938_project_knowledge` migration statement.
 */
export function createKnowledgeTestDb(): KnowledgeTestDb {
  const sqlite = new Database(':memory:')

  sqlite.exec(`
    CREATE TABLE projects (
      id integer PRIMARY KEY,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      user_id integer NOT NULL,
      name text NOT NULL,
      knowledge_mode text,
      knowledge_version integer,
      knowledge_pack_version integer
    );

    CREATE TABLE files (
      id integer PRIMARY KEY NOT NULL,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      user_id integer NOT NULL,
      storage_key text NOT NULL,
      name text NOT NULL,
      size integer NOT NULL,
      type text NOT NULL,
      source text NOT NULL DEFAULT 'upload'
    );

    CREATE TABLE project_knowledge_items (
      id integer PRIMARY KEY,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      user_id integer NOT NULL,
      project_id integer NOT NULL,
      kind text NOT NULL,
      file_id integer,
      title text NOT NULL,
      description text,
      relative_path text,
      folder_id text,
      media_type text,
      size_bytes integer,
      page_count integer,
      content_hash text,
      text_bytes integer NOT NULL,
      latin_chars integer NOT NULL,
      cyrillic_chars integer NOT NULL,
      other_chars integer NOT NULL,
      extract_status text NOT NULL,
      extract_error text,
      extractor text NOT NULL,
      send_as_native_pdf integer,
      pinned integer
    );

    CREATE INDEX idx_project_knowledge_items_user_project
      ON project_knowledge_items (user_id, project_id);
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

  function insertProject(input: {
    id: number
    userId: number
    knowledgeMode?: string | null
    knowledgeVersion?: number | null
    knowledgePackVersion?: number | null
  }): void {
    sqlite.prepare(
      'insert into projects (id, created_at, updated_at, user_id, name,'
      + ' knowledge_mode, knowledge_version, knowledge_pack_version)'
      + ' values (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      input.id,
      nowSeconds(),
      nowSeconds(),
      input.userId,
      `Project ${input.id}`,
      input.knowledgeMode ?? null,
      input.knowledgeVersion ?? null,
      input.knowledgePackVersion ?? null,
    )
  }

  function insertFile(input: {
    id: number
    userId: number
    storageKey: string
    name?: string
    size?: number
    type?: string
  }): void {
    sqlite.prepare(
      'insert into files (id, created_at, updated_at, user_id, storage_key,'
      + ' name, size, type) values (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      input.id,
      nowSeconds(),
      nowSeconds(),
      input.userId,
      input.storageKey,
      input.name ?? input.storageKey,
      input.size ?? 1,
      input.type ?? 'application/octet-stream',
    )
  }

  function insertItem(input: KnowledgeTestItemInput): void {
    sqlite.prepare(
      'insert into project_knowledge_items (id, created_at, updated_at,'
      + ' user_id, project_id, kind, file_id, title, description,'
      + ' relative_path, folder_id, media_type, size_bytes, page_count,'
      + ' text_bytes, latin_chars, cyrillic_chars, other_chars,'
      + ' extract_status, extractor, send_as_native_pdf, pinned)'
      + ' values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,'
      + ' ?, ?, ?)',
    ).run(
      input.id,
      nowSeconds(),
      nowSeconds(),
      input.userId,
      input.projectId,
      input.kind ?? 'file',
      input.fileId ?? null,
      input.title ?? `Item ${input.id}`,
      input.description ?? null,
      input.relativePath ?? null,
      input.folderId ?? null,
      input.mediaType ?? null,
      input.sizeBytes ?? null,
      input.pageCount ?? null,
      input.textBytes ?? 0,
      input.latinChars ?? 0,
      input.cyrillicChars ?? 0,
      input.otherChars ?? 0,
      input.extractStatus ?? 'ready',
      input.extractor ?? 'text',
      toFlag(input.sendAsNativePdf),
      toFlag(input.pinned),
    )
  }

  return {
    sqlite,
    db,
    insertProject,
    insertFile,
    insertItem,
    close: () => sqlite.close(),
  }
}
