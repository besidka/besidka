import type { KVNamespace } from '@cloudflare/workers-types'
import { and, count, eq, lt, ne } from 'drizzle-orm'
import {
  REGISTRY_BASE_URL,
  REGISTRY_CURSOR_MAX_LENGTH,
  REGISTRY_FULL_PASS_HOURS,
  REGISTRY_PAGE_SIZE,
  REGISTRY_PAGES_PER_RUN,
  REGISTRY_RUN_BUDGET_MS,
  REGISTRY_SERVERS_PATH,
  REGISTRY_SWEEP_MAX_SHARE,
  REGISTRY_UPSERT_BATCH,
} from '#shared/utils/connectors-policy'
import * as schema from '~~/server/db/schema'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { createSafeFetch } from '~~/server/utils/net/safe-fetch'
import {
  classifyRegistryEntry,
  registryPageSchema,
} from '~~/server/utils/connectors/registry-entry'
import type {
  RegistryServerRow,
  RegistrySkipReason,
} from '~~/server/utils/connectors/registry-entry'
import { invalidateDirectoryIndex } from '~~/server/utils/connectors/directory-index'

export const REGISTRY_UPDATED_SINCE_KEY = 'connectors:registry:updated-since'
export const REGISTRY_FULL_PASS_KEY = 'connectors:registry:full-pass'
export const REGISTRY_ERASURES_KEY = 'connectors:registry:erasures'
export const REGISTRY_PROGRESS_KEY = 'connectors:registry:progress'

const MILLISECONDS_PER_HOUR = 60 * 60 * 1000
const WATERMARK_SKEW_MS = 5 * 60 * 1000
const STATEMENTS_PER_BATCH = 2 * REGISTRY_UPSERT_BATCH

type RegistryDatabase = ReturnType<typeof useDb>

export type RegistrySyncMode = 'full' | 'incremental'

export type RegistrySyncOutcome = 'completed' | 'partial' | 'failed'

export interface RegistrySyncProgress {
  mode: RegistrySyncMode
  startedAt: string
  updatedSince: string | null
  cursor: string | null
  maxUpdatedAt: string | null
}

export interface RegistrySyncInput {
  db: RegistryDatabase
  kv: KVNamespace
  now: Date
  fetchImpl?: typeof fetch
  logger?: LoggerLike
  clock?: () => number
  maxPages?: number
}

export interface RegistrySyncResult {
  outcome: RegistrySyncOutcome
  mode: RegistrySyncMode | null
  pages: number
  upserted: number
  deleted: number
  skipped: number
  skippedByReason: Partial<Record<RegistrySkipReason, number>>
  swept: number
  sweepAborted?: { stale: number, total: number }
  error?: string
}

export async function hashRegistryName(name: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(name.toLowerCase()),
  )

  return Array.from(new Uint8Array(digest), (byte) => {
    return byte.toString(16).padStart(2, '0')
  }).join('')
}

async function findErasedNames(
  servers: unknown[],
  erasedHashes: ReadonlySet<string>,
): Promise<Set<string>> {
  const erasedNames = new Set<string>()

  if (erasedHashes.size === 0) {
    return erasedNames
  }

  for (const entry of servers) {
    const name = (entry as { server?: { name?: unknown } } | null)
      ?.server?.name

    if (
      typeof name === 'string'
      && erasedHashes.has(await hashRegistryName(name))
    ) {
      erasedNames.add(name)
    }
  }

  return erasedNames
}

async function readErasedHashes(kv: KVNamespace): Promise<Set<string>> {
  const raw = await kv.get(REGISTRY_ERASURES_KEY)

  if (!raw) {
    return new Set()
  }

  try {
    const parsed: unknown = JSON.parse(raw)

    if (!Array.isArray(parsed)) {
      return new Set()
    }

    return new Set(parsed.filter((value): value is string => {
      return typeof value === 'string'
    }).map((value) => {
      return value.toLowerCase()
    }))
  } catch {
    return new Set()
  }
}

function isValidDate(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

function parseProgress(raw: string | null): RegistrySyncProgress | null {
  if (!raw) {
    return null
  }

  try {
    const value = JSON.parse(raw) as Partial<RegistrySyncProgress>

    if (
      (value.mode !== 'full' && value.mode !== 'incremental')
      || !isValidDate(value.startedAt)
      || (value.cursor !== null && typeof value.cursor !== 'string')
      || (value.cursor && value.cursor.length > REGISTRY_CURSOR_MAX_LENGTH)
    ) {
      return null
    }

    return {
      mode: value.mode,
      startedAt: value.startedAt,
      updatedSince: isValidDate(value.updatedSince)
        ? value.updatedSince
        : null,
      cursor: value.cursor ?? null,
      maxUpdatedAt: isValidDate(value.maxUpdatedAt) ? value.maxUpdatedAt : null,
    }
  } catch {
    return null
  }
}

function startProgress(
  now: Date,
  lastFullPass: string | null,
  updatedSince: string | null,
): RegistrySyncProgress {
  const fullPassIsDue = !isValidDate(lastFullPass)
    || !isValidDate(updatedSince)
    || now.getTime() - Date.parse(lastFullPass)
    >= REGISTRY_FULL_PASS_HOURS * MILLISECONDS_PER_HOUR

  return {
    mode: fullPassIsDue ? 'full' : 'incremental',
    startedAt: now.toISOString(),
    updatedSince: fullPassIsDue ? null : updatedSince,
    cursor: null,
    maxUpdatedAt: null,
  }
}

function buildPageUrl(progress: RegistrySyncProgress): string {
  const query = new URLSearchParams({
    limit: String(REGISTRY_PAGE_SIZE),
    version: 'latest',
  })

  if (progress.mode === 'incremental' && progress.updatedSince) {
    query.set('updated_since', progress.updatedSince)
  }

  if (progress.cursor) {
    query.set('cursor', progress.cursor)
  }

  return `${REGISTRY_BASE_URL}${REGISTRY_SERVERS_PATH}?${query.toString()}`
}

class RegistryHttpError extends Error {
  constructor(readonly status: number) {
    super(`The registry answered ${status}`)
  }
}

function isRejectedCursor(exception: unknown): boolean {
  return exception instanceof RegistryHttpError
    && exception.status >= 400
    && exception.status < 500
    && exception.status !== 429
}

async function fetchPage(
  fetchImpl: typeof fetch,
  progress: RegistrySyncProgress,
): Promise<unknown> {
  const response = await fetchImpl(buildPageUrl(progress), {
    headers: { accept: 'application/json' },
  })

  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)

    throw new RegistryHttpError(response.status)
  }

  return await response.json()
}

async function writePage(
  db: RegistryDatabase,
  upserts: RegistryServerRow[],
  deletedNames: string[],
  syncedAt: Date,
): Promise<void> {
  const statements = [
    ...deletedNames.map((name) => {
      return db.delete(schema.mcpRegistryServers)
        .where(eq(schema.mcpRegistryServers.name, name))
    }),
    ...upserts.flatMap((row) => {
      return [
        db.delete(schema.mcpRegistryServers).where(and(
          eq(schema.mcpRegistryServers.name, row.name),
          ne(schema.mcpRegistryServers.id, row.id),
        )),
        db.insert(schema.mcpRegistryServers)
          .values({ ...row, syncedAt })
          .onConflictDoUpdate({
            target: schema.mcpRegistryServers.id,
            set: { ...row, syncedAt },
          }),
      ]
    }),
  ]

  for (
    let start = 0;
    start < statements.length;
    start += STATEMENTS_PER_BATCH
  ) {
    const chunk = statements.slice(start, start + STATEMENTS_PER_BATCH)

    await db.batch(chunk as unknown as [typeof chunk[0], ...typeof chunk])
  }
}

class RegistrySweepAbortedError extends Error {
  constructor(readonly stale: number, readonly total: number) {
    super(`The stale sweep was aborted: ${stale} of ${total} rows`)
  }
}

async function sweepStaleRows(db: RegistryDatabase, passStartedAt: Date) {
  const [stale] = await db.select({ value: count() })
    .from(schema.mcpRegistryServers)
    .where(lt(schema.mcpRegistryServers.syncedAt, passStartedAt))
  const [total] = await db.select({ value: count() })
    .from(schema.mcpRegistryServers)

  if (
    total!.value > 0
    && stale!.value > total!.value * REGISTRY_SWEEP_MAX_SHARE
  ) {
    throw new RegistrySweepAbortedError(stale!.value, total!.value)
  }

  const removed = await db.delete(schema.mcpRegistryServers)
    .where(lt(schema.mcpRegistryServers.syncedAt, passStartedAt))
    .returning({ id: schema.mcpRegistryServers.id })

  return removed.length
}

function nextWatermark(progress: RegistrySyncProgress): string {
  if (progress.mode === 'full') {
    return new Date(
      Date.parse(progress.startedAt) - WATERMARK_SKEW_MS,
    ).toISOString()
  }

  return later(
    progress.maxUpdatedAt,
    progress.updatedSince ?? progress.startedAt,
  )
}

function clampToNow(updatedAt: Date, now: Date): string {
  return new Date(Math.min(updatedAt.getTime(), now.getTime())).toISOString()
}

function later(first: string | null, second: string): string {
  return first && Date.parse(first) >= Date.parse(second) ? first : second
}

/**
 * Mirrors the official MCP Registry into `mcp_registry_servers`: remotes-only,
 * latest-version, active servers whose remote URL passes
 * `parseSafeOutboundUrl`. Hourly runs are incremental (`updated_since`, which
 * the registry answers with deleted entries too); once every 24 hours a run
 * starts a full pass and, only when that pass reaches the end of the list,
 * deletes every row it did not stamp. A run reads at most 20 pages and stops
 * early at its wall-clock budget, saving the page cursor in KV so the next
 * hour continues. A failed page keeps the saved cursor, the sweep never runs
 * on a capped or failed pass, and nothing is ever thrown to the scheduler.
 */
export async function syncMcpRegistry(
  input: RegistrySyncInput,
): Promise<RegistrySyncResult> {
  const { db, kv, now } = input
  const clock = input.clock ?? Date.now
  const fetchImpl = input.fetchImpl
    ?? createSafeFetch('registry', { logger: input.logger })
  const result: RegistrySyncResult = {
    outcome: 'failed',
    mode: null,
    pages: 0,
    upserted: 0,
    deleted: 0,
    skipped: 0,
    skippedByReason: {},
    swept: 0,
  }
  let progress: RegistrySyncProgress | null = null
  let finished = false
  let discardProgress = false
  let resumedCursor: string | null = null
  let entriesSeen = 0

  try {
    const savedProgress = parseProgress(await kv.get(REGISTRY_PROGRESS_KEY))
    const lastFullPass = await kv.get(REGISTRY_FULL_PASS_KEY)
    const updatedSince = await kv.get(REGISTRY_UPDATED_SINCE_KEY)
    const erasedHashes = await readErasedHashes(kv)

    progress = savedProgress
      ?? startProgress(now, lastFullPass, updatedSince)
    result.mode = progress.mode
    resumedCursor = progress.cursor

    const startedAtDate = new Date(progress.startedAt)
    const runStartedAt = clock()

    const maxPages = input.maxPages ?? REGISTRY_PAGES_PER_RUN

    for (let page = 0; page < maxPages; page++) {
      if (page > 0 && clock() - runStartedAt >= REGISTRY_RUN_BUDGET_MS) {
        break
      }

      const parsedPage = registryPageSchema.safeParse(
        await fetchPage(fetchImpl, progress),
      )

      if (!parsedPage.success) {
        throw new Error('The registry answered with an unknown page shape')
      }

      const upserts = new Map<string, RegistryServerRow>()
      const deletedNames = new Set<string>()
      const erasedNames = await findErasedNames(
        parsedPage.data.servers,
        erasedHashes,
      )

      for (const entry of parsedPage.data.servers) {
        const outcome = classifyRegistryEntry(entry, (name) => {
          return erasedNames.has(name)
        })

        if (outcome.kind === 'upsert') {
          upserts.set(outcome.row.name, outcome.row)
          deletedNames.delete(outcome.row.name)
          progress.maxUpdatedAt = later(
            progress.maxUpdatedAt,
            clampToNow(outcome.row.registryUpdatedAt, now),
          )

          continue
        }

        if (outcome.kind === 'delete') {
          deletedNames.add(outcome.name)
          upserts.delete(outcome.name)
          result.deleted += 1

          continue
        }

        result.skipped += 1
        result.skippedByReason[outcome.reason]
          = (result.skippedByReason[outcome.reason] ?? 0) + 1

        if (outcome.name) {
          deletedNames.add(outcome.name)
          upserts.delete(outcome.name)
        }
      }

      entriesSeen += parsedPage.data.servers.length
      await writePage(
        db,
        [...upserts.values()],
        [...deletedNames],
        startedAtDate,
      )

      result.upserted += upserts.size
      result.pages += 1
      progress.cursor = parsedPage.data.metadata?.nextCursor || null

      if (!progress.cursor) {
        finished = true

        break
      }
    }

    if (!finished) {
      result.outcome = 'partial'

      return result
    }

    if (progress.mode === 'full') {
      if (entriesSeen === 0) {
        throw new Error('A full pass returned no entries, so nothing was swept')
      }

      result.swept = await sweepStaleRows(db, startedAtDate)
      await kv.put(REGISTRY_FULL_PASS_KEY, progress.startedAt)
    }

    await kv.put(REGISTRY_UPDATED_SINCE_KEY, nextWatermark(progress))
    result.outcome = 'completed'

    return result
  } catch (exception) {
    result.error = exceptionMessage(exception)

    if (exception instanceof RegistrySweepAbortedError) {
      result.sweepAborted = {
        stale: exception.stale,
        total: exception.total,
      }
    }

    discardProgress = result.pages === 0
      && resumedCursor !== null
      && isRejectedCursor(exception)

    return result
  } finally {
    await persistProgress(kv, progress, discardProgress, result)

    if (result.upserted + result.deleted + result.swept > 0) {
      await invalidateDirectoryIndex(kv)
    }
  }
}

async function persistProgress(
  kv: KVNamespace,
  progress: RegistrySyncProgress | null,
  discardProgress: boolean,
  result: RegistrySyncResult,
): Promise<void> {
  if (!progress) {
    return
  }

  try {
    if (discardProgress || result.outcome === 'completed') {
      await kv.delete(REGISTRY_PROGRESS_KEY)

      return
    }

    await kv.put(REGISTRY_PROGRESS_KEY, JSON.stringify(progress))
  } catch (exception) {
    result.error = result.error ?? exceptionMessage(exception)
  }
}
