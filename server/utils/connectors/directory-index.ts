import type { KVNamespace } from '@cloudflare/workers-types'
import { and, asc, eq, gt } from 'drizzle-orm'
import { CONNECTOR_CURATION_VERSION } from '~~/config/connectors-directory'
import {
  buildDirectoryIndex,
  indexDirectoryEntries,
} from '#shared/utils/connectors-directory'
import type {
  DirectoryEntry,
  DirectoryIndex,
  DirectorySourceRow,
} from '#shared/utils/connectors-directory'
import * as schema from '~~/server/db/schema'

const DIRECTORY_INDEX_SCHEMA = 1
const DIRECTORY_INDEX_TTL_SECONDS = 3600
const DIRECTORY_MEMO_TTL_MS = 5 * 60 * 1000
const DIRECTORY_READ_PAGE_SIZE = 2500
const DIRECTORY_LOCK_TTL_SECONDS = 60
const DIRECTORY_LOCK_HOLD_MS = 30_000
const DIRECTORY_LOCK_WAIT_MS = 3000
const DIRECTORY_LOCK_POLL_MS = 250

export const DIRECTORY_INDEX_KEY = 'connectors:registry:directory:'
  + `v${DIRECTORY_INDEX_SCHEMA}:${CONNECTOR_CURATION_VERSION}`
export const DIRECTORY_INDEX_LOCK_KEY = `${DIRECTORY_INDEX_KEY}:lock`

type RegistryDatabase = ReturnType<typeof useDb>

interface StoredDirectoryIndex {
  builtAt: number
  sourceRows: number
  excluded: DirectoryIndex['excluded']
  entries: DirectoryEntry[]
}

let memo: { index: DirectoryIndex, loadedAt: number } | null = null
let pending: Promise<DirectoryIndex> | null = null

export function resetDirectoryIndexMemo(): void {
  memo = null
  pending = null
}

/**
 * Every active registry row, read in pages by id (keyset paging), so each
 * row is read once however many pages there are.
 */
export async function readActiveRows(
  db: RegistryDatabase,
  pageSize: number = DIRECTORY_READ_PAGE_SIZE,
): Promise<DirectorySourceRow[]> {
  const rows: DirectorySourceRow[] = []
  let lastId: string | null = null

  for (;;) {
    const page = await db.select({
      id: schema.mcpRegistryServers.id,
      name: schema.mcpRegistryServers.name,
      title: schema.mcpRegistryServers.title,
      description: schema.mcpRegistryServers.description,
      remoteUrl: schema.mcpRegistryServers.remoteUrl,
      headerNames: schema.mcpRegistryServers.headerNames,
      registryUpdatedAt: schema.mcpRegistryServers.registryUpdatedAt,
    })
      .from(schema.mcpRegistryServers)
      .where(and(
        eq(schema.mcpRegistryServers.status, 'active'),
        lastId === null ? undefined : gt(schema.mcpRegistryServers.id, lastId),
      ))
      .orderBy(asc(schema.mcpRegistryServers.id))
      .limit(pageSize)

    for (const row of page) {
      rows.push({
        id: row.id,
        name: row.name,
        title: row.title,
        description: row.description,
        remoteUrl: row.remoteUrl,
        headerNames: Array.isArray(row.headerNames) ? row.headerNames : [],
        updatedAt: row.registryUpdatedAt.getTime(),
      })
    }

    if (page.length < pageSize) {
      return rows
    }

    lastId = page.at(-1)!.id
  }
}

function parseStoredIndex(raw: string | null): DirectoryIndex | null {
  if (!raw) {
    return null
  }

  try {
    const stored = JSON.parse(raw) as StoredDirectoryIndex

    if (!Array.isArray(stored.entries)) {
      return null
    }

    return indexDirectoryEntries(stored.entries, {
      excluded: stored.excluded ?? {},
      sourceRows: stored.sourceRows ?? stored.entries.length,
    })
  } catch {
    return null
  }
}

async function readStoredIndex(
  kv: KVNamespace,
): Promise<DirectoryIndex | null> {
  try {
    return parseStoredIndex(await kv.get(DIRECTORY_INDEX_KEY))
  } catch {
    return null
  }
}

async function storeIndex(
  kv: KVNamespace,
  index: DirectoryIndex,
): Promise<void> {
  if (index.sourceRows === 0) {
    return
  }

  const stored: StoredDirectoryIndex = {
    builtAt: Date.now(),
    sourceRows: index.sourceRows,
    excluded: index.excluded,
    entries: index.entries,
  }

  try {
    await kv.put(DIRECTORY_INDEX_KEY, JSON.stringify(stored), {
      expirationTtl: DIRECTORY_INDEX_TTL_SECONDS,
    })
  } catch {
    return
  }
}

async function acquireRebuildLock(kv: KVNamespace): Promise<boolean> {
  try {
    const busyUntil = Number(await kv.get(DIRECTORY_INDEX_LOCK_KEY))

    if (Number.isFinite(busyUntil) && busyUntil > Date.now()) {
      return false
    }

    await kv.put(
      DIRECTORY_INDEX_LOCK_KEY,
      String(Date.now() + DIRECTORY_LOCK_HOLD_MS),
      { expirationTtl: DIRECTORY_LOCK_TTL_SECONDS },
    )
  } catch {
    return true
  }

  return true
}

async function releaseRebuildLock(kv: KVNamespace): Promise<void> {
  try {
    await kv.delete(DIRECTORY_INDEX_LOCK_KEY)
  } catch {
    return
  }
}

async function waitForStoredIndex(
  kv: KVNamespace,
  wait: (ms: number) => Promise<void>,
): Promise<DirectoryIndex | null> {
  for (
    let waited = 0;
    waited < DIRECTORY_LOCK_WAIT_MS;
    waited += DIRECTORY_LOCK_POLL_MS
  ) {
    await wait(DIRECTORY_LOCK_POLL_MS)

    const stored = await readStoredIndex(kv)

    if (stored) {
      return stored
    }
  }

  return null
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function loadIndex(
  db: RegistryDatabase,
  kv: KVNamespace,
  wait: (ms: number) => Promise<void>,
): Promise<DirectoryIndex> {
  const stored = await readStoredIndex(kv)

  if (stored) {
    return stored
  }

  if (!await acquireRebuildLock(kv)) {
    const built = await waitForStoredIndex(kv, wait)

    if (built) {
      return built
    }
  }

  try {
    const index = buildDirectoryIndex(await readActiveRows(db))

    await storeIndex(kv, index)

    return index
  } finally {
    await releaseRebuildLock(kv)
  }
}

/**
 * The filtered, de-duplicated and categorized directory (docs/connectors.md
 * section 10.3). Kept in memory for five minutes per isolate and as one KV
 * copy for an hour, so a cold isolate parses it instead of reading every
 * registry row; only a miss on both rebuilds it from D1, under a
 * best-effort KV lock: an isolate that finds another one rebuilding waits up
 * to three seconds for its copy before building its own. A sync that changed
 * rows drops the KV copy (`invalidateDirectoryIndex`). An empty mirror is
 * never cached.
 */
export async function loadDirectoryIndex(
  db: RegistryDatabase,
  kv: KVNamespace,
  options: { wait?: (ms: number) => Promise<void> } = {},
): Promise<DirectoryIndex> {
  if (memo && Date.now() - memo.loadedAt < DIRECTORY_MEMO_TTL_MS) {
    return memo.index
  }

  pending ??= loadIndex(db, kv, options.wait ?? sleep)

  try {
    const index = await pending

    memo = index.sourceRows > 0 ? { index, loadedAt: Date.now() } : null

    return index
  } finally {
    pending = null
  }
}

/**
 * Drops the cached directory after a sync changed the mirror. Other isolates
 * keep their memory copy for up to five minutes. Best effort.
 */
export async function invalidateDirectoryIndex(
  kv: KVNamespace,
): Promise<void> {
  resetDirectoryIndexMemo()

  try {
    await kv.delete(DIRECTORY_INDEX_KEY)
  } catch {
    return
  }
}
