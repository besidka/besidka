import type { KVNamespace } from '@cloudflare/workers-types'
import { count, eq, max } from 'drizzle-orm'
import {
  REGISTRY_SYNC_NOW_LOCK_SECONDS,
  REGISTRY_SYNC_NOW_MAX_PAGES,
} from '#shared/utils/connectors-policy'
import * as schema from '~~/server/db/schema'
import type { LoggerLike } from '~~/server/utils/files/logger'
import {
  REGISTRY_PROGRESS_KEY,
  syncMcpRegistry,
} from '~~/server/utils/connectors/registry-sync'
import type {
  RegistrySyncOutcome,
  RegistrySyncResult,
} from '~~/server/utils/connectors/registry-sync'

export const REGISTRY_SYNC_NOW_LOCK_KEY = 'connectors:registry:sync-now-lock'

type RegistryDatabase = ReturnType<typeof useDb>

export interface RegistrySyncStatus {
  rows: number
  lastSyncedAt: string | null
  hasUnfinishedRun: boolean
  isRunning: boolean
}

export interface RegistrySyncNowResult extends RegistrySyncStatus {
  outcome: RegistrySyncOutcome | 'busy'
  pages: number
  upserted: number
  error?: string
}

export async function readRegistrySyncStatus(
  db: RegistryDatabase,
  kv: KVNamespace,
): Promise<RegistrySyncStatus> {
  const [row] = await db.select({
    rows: count(),
    lastSyncedAt: max(schema.mcpRegistryServers.syncedAt),
  })
    .from(schema.mcpRegistryServers)
    .where(eq(schema.mcpRegistryServers.status, 'active'))
  const [progress, lock] = await Promise.all([
    kv.get(REGISTRY_PROGRESS_KEY),
    kv.get(REGISTRY_SYNC_NOW_LOCK_KEY),
  ])

  return {
    rows: row?.rows ?? 0,
    lastSyncedAt: row?.lastSyncedAt
      ? new Date(row.lastSyncedAt).toISOString()
      : null,
    hasUnfinishedRun: progress !== null,
    isRunning: lock !== null,
  }
}

/**
 * The admin's "Sync now": one run of the same `syncMcpRegistry` the hourly
 * cron uses (same cursor, watermark and sweep rules), so a preview, where
 * crons never run, can be filled. A run reads at most
 * `REGISTRY_SYNC_NOW_MAX_PAGES` pages of 100 and saves its cursor, so the
 * caller repeats it while the outcome is `partial`. A best-effort KV lock
 * (KV is eventually consistent) answers `busy` instead of starting a second
 * run next to this one; the cron does not take it.
 */
export async function runRegistrySyncNow(input: {
  db: RegistryDatabase
  kv: KVNamespace
  now: Date
  logger?: LoggerLike
  fetchImpl?: typeof fetch
}): Promise<RegistrySyncNowResult> {
  const { db, kv } = input

  if (await kv.get(REGISTRY_SYNC_NOW_LOCK_KEY)) {
    return {
      ...await readRegistrySyncStatus(db, kv),
      outcome: 'busy',
      pages: 0,
      upserted: 0,
    }
  }

  await kv.put(REGISTRY_SYNC_NOW_LOCK_KEY, '1', {
    expirationTtl: REGISTRY_SYNC_NOW_LOCK_SECONDS,
  })

  let result: RegistrySyncResult

  try {
    result = await syncMcpRegistry({
      db,
      kv,
      now: input.now,
      fetchImpl: input.fetchImpl,
      logger: input.logger,
      maxPages: REGISTRY_SYNC_NOW_MAX_PAGES,
    })
  } finally {
    await kv.delete(REGISTRY_SYNC_NOW_LOCK_KEY).catch(() => undefined)
  }

  return {
    ...await readRegistrySyncStatus(db, kv),
    outcome: result.outcome,
    pages: result.pages,
    upserted: result.upserted,
    error: result.error,
  }
}
