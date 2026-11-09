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
  const serialized = value === undefined ? undefined : JSON.stringify(value)

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

/**
 * Saves one key for one viewer of one artifact within the per-viewer caps
 * (64 keys, 100 KB in total, 32 KB per value). The totals are read and
 * checked in the same request before the upsert; two concurrent writes can
 * overshoot the cap by one value, which is accepted (BES-260).
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

  const [existing] = await input.db
    .select({ bytes: schema.artifactStorage.bytes })
    .from(schema.artifactStorage)
    .where(and(
      scopeCondition(input),
      eq(schema.artifactStorage.key, input.key),
    ))
    .limit(1)
  const totals = await readArtifactStorageTotals(input)
  const nextKeys = existing ? totals.keys : totals.keys + 1
  const nextBytes = totals.bytes - (existing?.bytes ?? 0) + valueBytes

  if (nextKeys > ARTIFACT_STORAGE_MAX_KEYS) {
    throw createStorageFullError(
      `${totals.keys} of ${ARTIFACT_STORAGE_MAX_KEYS} keys are used.`,
    )
  }

  if (nextBytes > ARTIFACT_STORAGE_MAX_BYTES) {
    throw createStorageFullError(
      `${formatKilobytes(totals.bytes)} of `
      + `${formatKilobytes(ARTIFACT_STORAGE_MAX_BYTES)} are used and this `
      + `value needs ${formatKilobytes(valueBytes)}.`,
    )
  }

  const now = input.now ?? new Date()
  const storedValue = JSON.parse(serialized) as unknown

  await input.db
    .insert(schema.artifactStorage)
    .values({
      artifactId: input.artifactInternalId,
      viewerUserId: input.viewerUserId,
      key: input.key,
      value: storedValue,
      bytes: valueBytes,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [
        schema.artifactStorage.artifactId,
        schema.artifactStorage.viewerUserId,
        schema.artifactStorage.key,
      ],
      set: { value: storedValue, bytes: valueBytes, updatedAt: now },
    })

  return { keys: nextKeys, bytes: nextBytes }
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
 * amplifier.
 */
export async function enforceArtifactStorageWriteLimit(
  event: Pick<RequestEvent, 'res'>,
  scope: Pick<ArtifactStorageScope, 'artifactInternalId' | 'viewerUserId'>,
): Promise<void> {
  const storage = createAuthRateLimitStorage(
    useKV(),
    ARTIFACT_STORAGE_RATE_LIMIT_PREFIX,
  )
  const result = await storage.consume(
    `${scope.viewerUserId}:${scope.artifactInternalId}`,
    ARTIFACT_STORAGE_WRITE_LIMIT,
  )

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
