import type { RequestEvent } from 'nuxt/server'
import type {
  ArtifactStorageSnapshot,
  ArtifactStorageTotals,
} from '#shared/utils/artifacts'
import {
  ARTIFACT_STORAGE_FULL_CODE,
  ARTIFACT_STORAGE_MAX_BYTES,
  ARTIFACT_STORAGE_MAX_KEYS,
  ARTIFACT_STORAGE_MAX_VALUE_BYTES,
  ARTIFACT_STORAGE_WRITE_LIMIT,
  getUtf8ByteLength,
} from '#shared/utils/artifacts'
import { and, asc, eq, sql } from 'drizzle-orm'
import { createError } from 'evlog'
import * as schema from '~~/server/db/schema'
import { createAuthRateLimitStorage } from '~~/server/utils/auth-rate-limit'

type DbClient = ReturnType<typeof useDb>

const ARTIFACT_STORAGE_RATE_LIMIT_PREFIX = 'artifact-storage'
const STORAGE_FULL_FIX = 'Delete keys or reset saved progress.'

export interface ArtifactStorageScope {
  db: DbClient
  artifactInternalId: number
  viewerUserId: number
}

export interface PutArtifactStorageValueInput extends ArtifactStorageScope {
  key: string
  value: unknown
  now?: Date
}

function scopeCondition(scope: ArtifactStorageScope) {
  return and(
    eq(schema.artifactStorage.artifactId, scope.artifactInternalId),
    eq(schema.artifactStorage.viewerUserId, scope.viewerUserId),
  )
}

function formatKilobytes(bytes: number): string {
  return `${Math.ceil(bytes / 1024)} KB`
}

function createStorageFullError(why: string) {
  return createError({
    message: 'Saved progress is full',
    status: 413,
    code: ARTIFACT_STORAGE_FULL_CODE,
    why,
    fix: STORAGE_FULL_FIX,
  })
}

/**
 * Serialises a stored value exactly as D1 will keep it. Anything
 * `JSON.stringify` cannot represent (a missing value, a lone `undefined`)
 * is refused with 400, so a value that reads back differently is never
 * stored.
 */
export function serializeArtifactStorageValue(value: unknown): string {
  let serialized: string | undefined

  try {
    serialized = value === undefined ? undefined : JSON.stringify(value)
  } catch {
    serialized = undefined
  }

  if (serialized === undefined) {
    throw createError({
      message: 'Invalid saved value',
      status: 400,
      why: 'The value is not JSON-serialisable',
      fix: 'Save strings, numbers, booleans, null, arrays or plain objects.',
    })
  }

  return serialized
}

export async function readArtifactStorageTotals(
  scope: ArtifactStorageScope,
): Promise<ArtifactStorageTotals> {
  const [row] = await scope.db
    .select({
      keys: sql<number>`count(*)`,
      bytes: sql<number>`coalesce(sum(${schema.artifactStorage.bytes}), 0)`,
    })
    .from(schema.artifactStorage)
    .where(scopeCondition(scope))

  return {
    keys: Number(row?.keys ?? 0),
    bytes: Number(row?.bytes ?? 0),
  }
}

export async function listArtifactStorage(
  scope: ArtifactStorageScope,
): Promise<ArtifactStorageSnapshot> {
  const rows = await scope.db
    .select({
      key: schema.artifactStorage.key,
      value: schema.artifactStorage.value,
      bytes: schema.artifactStorage.bytes,
    })
    .from(schema.artifactStorage)
    .where(scopeCondition(scope))
    .orderBy(asc(schema.artifactStorage.key))

  return {
    items: rows.map((row) => {
      return { key: row.key, value: row.value ?? null }
    }),
    keys: rows.length,
    bytes: rows.reduce((total, row) => {
      return total + row.bytes
    }, 0),
  }
}

async function describeRefusedStorageWrite(
  input: PutArtifactStorageValueInput,
  valueBytes: number,
) {
  const [existing] = await input.db
    .select({ bytes: schema.artifactStorage.bytes })
    .from(schema.artifactStorage)
    .where(and(
      scopeCondition(input),
      eq(schema.artifactStorage.key, input.key),
    ))
    .limit(1)
  const totals = await readArtifactStorageTotals(input)

  if (!existing && totals.keys >= ARTIFACT_STORAGE_MAX_KEYS) {
    return createStorageFullError(
      `${totals.keys} of ${ARTIFACT_STORAGE_MAX_KEYS} keys are used.`,
    )
  }

  return createStorageFullError(
    `${formatKilobytes(totals.bytes)} of `
    + `${formatKilobytes(ARTIFACT_STORAGE_MAX_BYTES)} are used and this `
    + `value needs ${formatKilobytes(valueBytes)}.`,
  )
}

/**
 * Saves one key for one viewer of one artifact within the per-viewer caps
 * (64 keys, 100 KB in total, 32 KB per value). The caps are checked in the
 * same SQL statement that writes the row (`INSERT ... SELECT ... WHERE`
 * over the other keys of the viewer, then `ON CONFLICT DO UPDATE`), and D1
 * runs one statement atomically, so parallel writes cannot overshoot a cap.
 * A statement that writes no row means a cap refused the value (BES-260).
 */
export async function putArtifactStorageValue(
  input: PutArtifactStorageValueInput,
): Promise<ArtifactStorageTotals> {
  const serialized = serializeArtifactStorageValue(input.value)
  const valueBytes = getUtf8ByteLength(serialized)

  if (valueBytes > ARTIFACT_STORAGE_MAX_VALUE_BYTES) {
    throw createStorageFullError(
      `The value is ${formatKilobytes(valueBytes)}; one value can be at most `
      + `${formatKilobytes(ARTIFACT_STORAGE_MAX_VALUE_BYTES)}.`,
    )
  }

  const timestamp = Math.floor((input.now ?? new Date()).getTime() / 1000)
  const written = await input.db.all<{ key: string }>(sql`
    insert into artifact_storage (
      artifact_id, viewer_user_id, key, value, bytes, updated_at
    )
    select
      ${input.artifactInternalId}, ${input.viewerUserId}, ${input.key},
      ${serialized}, ${valueBytes}, ${timestamp}
    where (
      select coalesce(sum(bytes), 0) from artifact_storage
      where artifact_id = ${input.artifactInternalId}
        and viewer_user_id = ${input.viewerUserId}
        and key <> ${input.key}
    ) + ${valueBytes} <= ${ARTIFACT_STORAGE_MAX_BYTES}
    and (
      select count(*) from artifact_storage
      where artifact_id = ${input.artifactInternalId}
        and viewer_user_id = ${input.viewerUserId}
        and key <> ${input.key}
    ) < ${ARTIFACT_STORAGE_MAX_KEYS}
    on conflict (artifact_id, viewer_user_id, key) do update set
      value = excluded.value,
      bytes = excluded.bytes,
      updated_at = excluded.updated_at
    returning key
  `)

  if (written.length === 0) {
    throw await describeRefusedStorageWrite(input, valueBytes)
  }

  return readArtifactStorageTotals(input)
}

export async function deleteArtifactStorageValue(
  scope: ArtifactStorageScope & { key: string },
): Promise<ArtifactStorageTotals> {
  await scope.db
    .delete(schema.artifactStorage)
    .where(and(
      scopeCondition(scope),
      eq(schema.artifactStorage.key, scope.key),
    ))

  return readArtifactStorageTotals(scope)
}

export async function resetArtifactStorage(
  scope: ArtifactStorageScope,
): Promise<number> {
  const deleted = await scope.db
    .delete(schema.artifactStorage)
    .where(scopeCondition(scope))
    .returning({ key: schema.artifactStorage.key })

  return deleted.length
}

/**
 * 120 writes per minute per viewer and artifact, on the same KV limiter as
 * the key routes, so a busy artifact cannot use the parent as a write
 * amplifier. Workers KV takes at most one write per second per key, so two
 * quick saves can make the counter update fail; the save then goes ahead
 * (fail open, noted on the wide event), because the byte and key caps in D1
 * still bound what one viewer can store.
 */
export async function enforceArtifactStorageWriteLimit(
  event: Pick<RequestEvent, 'res'>,
  scope: Pick<ArtifactStorageScope, 'artifactInternalId' | 'viewerUserId'>,
  logger?: { set: (fields: Record<string, unknown>) => void },
): Promise<void> {
  const storage = createAuthRateLimitStorage(
    useKV(),
    ARTIFACT_STORAGE_RATE_LIMIT_PREFIX,
  )
  let result: Awaited<ReturnType<typeof storage.consume>>

  try {
    result = await storage.consume(
      `${scope.viewerUserId}:${scope.artifactInternalId}`,
      ARTIFACT_STORAGE_WRITE_LIMIT,
    )
  } catch (exception) {
    logger?.set({
      attributes: {
        artifacts: {
          storageRateLimit: {
            skipped: 'kv-error',
            error: exception instanceof Error ? exception.name : 'unknown',
          },
        },
      },
    })

    return
  }

  if (result.allowed) {
    return
  }

  if (result.retryAfter !== null) {
    event.res.headers.set('Retry-After', String(result.retryAfter))
  }

  throw createError({
    message: 'Too many saves',
    status: 429,
    why: `More than ${ARTIFACT_STORAGE_WRITE_LIMIT.max} saves in a minute`,
    fix: 'Save less often, for example once per answer.',
  })
}
