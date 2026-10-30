import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { relations } from '~~/server/db/relations'

export interface KnowledgeTestDb {
  sqlite: InstanceType<typeof Database>
  db: ReturnType<typeof import('~~/server/utils/db').useDb>
  insertProject: (input: {
    id: number
    userId: number
    name?: string
    knowledgeMode?: string | null
    knowledgeVersion?: number | null
    knowledgePackVersion?: number | null
  }) => void
  insertFile: (input: {
    id: number
    userId: number
    storageKey?: string
    name?: string
    size?: number
    type?: string
    source?: 'upload' | 'assistant'
    expiresAt?: number | null
    createdAt?: number
  }) => void
  insertStorage: (input: {
    userId: number
    storage?: number
    tier?: 'free' | 'vip'
    fileRetentionDays?: number | null
  }) => void
  insertItem: (input: {
    id?: number
    userId: number
    projectId: number
    kind?: 'file' | 'note'
    fileId?: number | null
    title?: string
    description?: string | null
    relativePath?: string | null
    folderId?: string | null
    mediaType?: string | null
    contentHash?: string | null
    textBytes?: number
    latinChars?: number
    cyrillicChars?: number
    otherChars?: number
    extractStatus?: string
    extractor?: string
    updatedAt?: number
    createdAt?: number
  }) => number
  countItems: (projectId?: number) => number
  getProjectRow: (projectId: number) => {
    knowledge_mode: string | null
    knowledge_version: number | null
    knowledge_pack_version: number | null
  } | undefined
  getFileRow: (fileId: number) => {
    expires_at: number | null
  } | undefined
  close: () => void
}

/**
 * Creates an in-memory SQLite DB with the tables the project knowledge code
 * touches (`project_knowledge_items`, `projects`, `files`, `storages`) as the
 * migrations define them, minus the foreign keys, so a spec can seed a user,
 * a project or a file without a `users` row. The `project_knowledge_items`
 * DDL and its indexes are the exact `20261025214938_project_knowledge`
 * migration statements. Foreign-key cascades are NOT emulated: a spec that
 * needs one must delete the dependent rows itself.
 */
export function createKnowledgeTestDb(): KnowledgeTestDb {
  const sqlite = new Database(':memory:')

  sqlite.exec(`
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

    CREATE UNIQUE INDEX uq_project_knowledge_items_project_hash
      ON project_knowledge_items (project_id, content_hash)
      WHERE content_hash is not null;
    CREATE UNIQUE INDEX uq_project_knowledge_items_project_file
      ON project_knowledge_items (project_id, file_id)
      WHERE file_id is not null;
    CREATE INDEX idx_project_knowledge_items_user_project
      ON project_knowledge_items (user_id, project_id);
    CREATE INDEX idx_project_knowledge_items_file
      ON project_knowledge_items (file_id);

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
      knowledge_mode text,
      knowledge_version integer,
      knowledge_pack_version integer,
      pinned_at integer,
      archived_at integer,
      activity_at integer NOT NULL
    );

    CREATE TABLE files (
      id integer PRIMARY KEY,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      user_id integer NOT NULL,
      storage_key text NOT NULL,
      name text NOT NULL,
      size integer NOT NULL,
      type text NOT NULL,
      source text NOT NULL DEFAULT 'upload',
      expires_at integer,
      origin_message_id integer,
      origin_provider text,
      origin_model text,
      generation_cost real
    );

    CREATE UNIQUE INDEX uq_file_storageKey ON files (storage_key);
    CREATE INDEX idx_files_expires_at ON files (expires_at);
    CREATE INDEX idx_files_user_id ON files (user_id);

    CREATE TABLE storages (
      id integer PRIMARY KEY,
      created_at integer NOT NULL,
      updated_at integer NOT NULL,
      user_id integer NOT NULL,
      storage integer NOT NULL DEFAULT 20971520,
      tier text NOT NULL DEFAULT 'free',
      max_files_per_message integer NOT NULL DEFAULT 10,
      max_message_files_bytes integer NOT NULL DEFAULT 1048576000,
      file_retention_days integer DEFAULT 30,
      image_transform_limit_total integer DEFAULT 0,
      image_transform_used_total integer NOT NULL DEFAULT 0
    );

    CREATE UNIQUE INDEX uq_storage_user ON storages (user_id);
  `)

  const db = drizzle({ client: sqlite, relations }) as unknown as ReturnType<
    typeof import('~~/server/utils/db').useDb
  >

  function nowSeconds(): number {
    return Math.floor(Date.now() / 1000)
  }

  function insertProject(input: {
    id: number
    userId: number
    name?: string
    knowledgeMode?: string | null
    knowledgeVersion?: number | null
    knowledgePackVersion?: number | null
  }): void {
    sqlite.prepare(
      'insert into projects (id, created_at, updated_at, user_id, name,'
      + ' knowledge_mode, knowledge_version, knowledge_pack_version,'
      + ' activity_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      input.id,
      nowSeconds(),
      nowSeconds(),
      input.userId,
      input.name ?? `Project ${input.id}`,
      input.knowledgeMode ?? null,
      input.knowledgeVersion ?? null,
      input.knowledgePackVersion ?? null,
      nowSeconds(),
    )
  }

  function insertFile(input: {
    id: number
    userId: number
    storageKey?: string
    name?: string
    size?: number
    type?: string
    source?: 'upload' | 'assistant'
    expiresAt?: number | null
    createdAt?: number
  }): void {
    const createdAt = input.createdAt ?? nowSeconds()

    sqlite.prepare(
      'insert into files (id, created_at, updated_at, user_id, storage_key,'
      + ' name, size, type, source, expires_at)'
      + ' values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      input.id,
      createdAt,
      createdAt,
      input.userId,
      input.storageKey ?? `files/test-${input.id}`,
      input.name ?? `file-${input.id}.pdf`,
      input.size ?? 1024,
      input.type ?? 'application/pdf',
      input.source ?? 'upload',
      input.expiresAt ?? null,
    )
  }

  function insertStorage(input: {
    userId: number
    storage?: number
    tier?: 'free' | 'vip'
    fileRetentionDays?: number | null
  }): void {
    sqlite.prepare(
      'insert into storages (id, created_at, updated_at, user_id, storage,'
      + ' tier, file_retention_days) values (?, ?, ?, ?, ?, ?, ?)',
    ).run(
      input.userId,
      nowSeconds(),
      nowSeconds(),
      input.userId,
      input.storage ?? 20 * 1024 * 1024,
      input.tier ?? 'free',
      input.fileRetentionDays === undefined ? 30 : input.fileRetentionDays,
    )
  }

  function insertItem(input: {
    id?: number
    userId: number
    projectId: number
    kind?: 'file' | 'note'
    fileId?: number | null
    title?: string
    description?: string | null
    relativePath?: string | null
    folderId?: string | null
    mediaType?: string | null
    contentHash?: string | null
    textBytes?: number
    latinChars?: number
    cyrillicChars?: number
    otherChars?: number
    extractStatus?: string
    extractor?: string
    updatedAt?: number
    createdAt?: number
  }): number {
    const createdAt = input.createdAt ?? nowSeconds()
    const result = sqlite.prepare(
      'insert into project_knowledge_items (id, created_at, updated_at,'
      + ' user_id, project_id, kind, file_id, title, description,'
      + ' relative_path, folder_id, media_type, content_hash, text_bytes,'
      + ' latin_chars, cyrillic_chars, other_chars, extract_status,'
      + ' extractor) values'
      + ' (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      input.id ?? null,
      createdAt,
      input.updatedAt ?? createdAt,
      input.userId,
      input.projectId,
      input.kind ?? 'note',
      input.fileId ?? null,
      input.title ?? 'Item',
      input.description ?? null,
      input.relativePath ?? null,
      input.folderId ?? null,
      input.mediaType ?? null,
      input.contentHash ?? null,
      input.textBytes ?? 0,
      input.latinChars ?? 0,
      input.cyrillicChars ?? 0,
      input.otherChars ?? 0,
      input.extractStatus ?? 'ready',
      input.extractor ?? 'text',
    )

    return Number(result.lastInsertRowid)
  }

  function countItems(projectId?: number): number {
    const row = projectId === undefined
      ? sqlite.prepare(
        'select count(*) as total from project_knowledge_items',
      ).get()
      : sqlite.prepare(
        'select count(*) as total from project_knowledge_items'
        + ' where project_id = ?',
      ).get(projectId)

    return (row as { total: number }).total
  }

  function getProjectRow(projectId: number) {
    return sqlite.prepare(
      'select knowledge_mode, knowledge_version, knowledge_pack_version'
      + ' from projects where id = ?',
    ).get(projectId) as ReturnType<KnowledgeTestDb['getProjectRow']>
  }

  function getFileRow(fileId: number) {
    return sqlite.prepare(
      'select expires_at from files where id = ?',
    ).get(fileId) as ReturnType<KnowledgeTestDb['getFileRow']>
  }

  return {
    sqlite,
    db,
    insertProject,
    insertFile,
    insertStorage,
    insertItem,
    countItems,
    getProjectRow,
    getFileRow,
    close: () => sqlite.close(),
  }
}
