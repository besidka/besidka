import { and, desc, eq, inArray } from 'drizzle-orm'
import { createError } from 'evlog'
import * as schema from '~~/server/db/schema'
import { sha256Hex } from '#shared/utils/knowledge-hash'
import { SKILL_VERSIONS_KEPT } from '#shared/utils/skills-policy'

type DbClient = ReturnType<typeof useDb>

export const SKILLS_STORAGE_PREFIX = 'user-skills'
export const SKILLS_STAGING_PREFIX = 'skills-staging'
export const SKILL_BLOB_SEGMENT = 'blobs'
export const SKILL_ORPHAN_GRACE_SECONDS = 60 * 60

const MAX_BATCH_QUERY_PARAMS = 90
const R2_BATCH_DELETE_LIMIT = 1000
const R2_LIST_PAGE_LIMIT = 1000
const SKILL_ID_SEGMENT_PATTERN = /^[A-Za-z0-9]{1,64}$/
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/
const GUARDED_PREFIX_PATTERN
  = /^(?:user-skills|skills-staging)\/u[1-9]\d*\/(?:[A-Za-z0-9]{1,64}\/)?$/
const BLOB_KEY_PATTERN
  = /^user-skills\/u([1-9]\d*)\/([A-Za-z0-9]{1,64})\/blobs\/([0-9a-f]{64})$/
const SKILL_BLOB_CONTENT_TYPE = 'text/plain; charset=utf-8'

export interface SkillBlobBucket {
  put: (
    key: string,
    value: Uint8Array,
    options?: {
      httpMetadata?: { contentType?: string }
      customMetadata?: Record<string, string>
    },
  ) => Promise<unknown>
  delete: (keys: string | string[]) => Promise<unknown>
  list: (options: {
    prefix: string
    cursor?: string
    limit?: number
  }) => Promise<{
    objects: Array<{ key: string, uploaded: Date }>
    truncated: boolean
    cursor?: string
  }>
}

export interface ParsedSkillBlobKey {
  userId: number
  skillId: string
  sha256: string
}

export interface PutSkillBlobResult {
  sha256: string
  key: string
  bytes: number
}

export interface PruneSkillVersionsResult {
  versionsPruned: number
  blobsDeleted: number
}

function invalidKeyError(label: string, value: unknown) {
  return createError({
    message: 'Invalid skill storage key',
    status: 500,
    why: `${label} is not valid: ${String(value)}`,
    fix: 'Pass the internal user id, the skill public id and a sha256 hex',
  })
}

function assertUserId(userId: number): void {
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw invalidKeyError('userId', userId)
  }
}

function assertSkillId(skillId: string): void {
  if (typeof skillId !== 'string' || !SKILL_ID_SEGMENT_PATTERN.test(skillId)) {
    throw invalidKeyError('skillId', skillId)
  }
}

function assertSha256(sha256: string): void {
  if (typeof sha256 !== 'string' || !SHA256_HEX_PATTERN.test(sha256)) {
    throw invalidKeyError('sha256', sha256)
  }
}

export function skillUserPrefix(userId: number): string {
  assertUserId(userId)

  return `${SKILLS_STORAGE_PREFIX}/u${userId}/`
}

export function skillPrefix(userId: number, skillId: string): string {
  assertSkillId(skillId)

  return `${skillUserPrefix(userId)}${skillId}/`
}

/**
 * The only place that derives an R2 key for skill content. Files are
 * content-addressed per skill, so the key never carries a path or a file
 * name from the user: a user-controlled string cannot reach the key, and
 * the result can never equal a key of the host skills directory.
 */
export function skillBlobKey(
  userId: number,
  skillId: string,
  sha256: string,
): string {
  assertSha256(sha256)

  return `${skillPrefix(userId, skillId)}${SKILL_BLOB_SEGMENT}/${sha256}`
}

export function skillStagingUserPrefix(userId: number): string {
  assertUserId(userId)

  return `${SKILLS_STAGING_PREFIX}/u${userId}/`
}

export function parseSkillBlobKey(key: string): ParsedSkillBlobKey | null {
  const match = BLOB_KEY_PATTERN.exec(key)

  if (!match) {
    return null
  }

  return {
    userId: Number(match[1]),
    skillId: match[2]!,
    sha256: match[3]!,
  }
}

function toBytes(content: string | Uint8Array): Uint8Array<ArrayBuffer> {
  return typeof content === 'string'
    ? new TextEncoder().encode(content)
    : new Uint8Array(content)
}

/**
 * Writes one file as a content-addressed blob. The write is unconditional:
 * the key is derived from the content, so storage stays deduplicated, and
 * every save that references the blob refreshes its R2 `uploaded` time, which
 * keeps it inside the sweep's grace period until the version rows exist.
 * Safe to repeat.
 */
export async function putSkillBlob(input: {
  bucket: SkillBlobBucket
  userId: number
  skillId: string
  content: string | Uint8Array
}): Promise<PutSkillBlobResult> {
  const bytes = toBytes(input.content)
  const sha256 = await sha256Hex(bytes)
  const key = skillBlobKey(input.userId, input.skillId, sha256)

  await input.bucket.put(key, bytes, {
    httpMetadata: { contentType: SKILL_BLOB_CONTENT_TYPE },
    customMetadata: { sha256 },
  })

  return { sha256, key, bytes: bytes.byteLength }
}

/**
 * Sequential on purpose: a Worker holds at most six simultaneous
 * connections, and a save can carry up to 50 changed files.
 */
export async function putSkillBlobs(input: {
  bucket: SkillBlobBucket
  userId: number
  skillId: string
  contents: Array<string | Uint8Array>
}): Promise<PutSkillBlobResult[]> {
  const results: PutSkillBlobResult[] = []

  for (const content of input.contents) {
    results.push(await putSkillBlob({
      bucket: input.bucket,
      userId: input.userId,
      skillId: input.skillId,
      content,
    }))
  }

  return results
}

function chunkItems<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = []

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize))
  }

  return chunks
}

async function deleteObjectKeys(
  bucket: SkillBlobBucket,
  keys: string[],
): Promise<void> {
  for (const chunk of chunkItems(keys, R2_BATCH_DELETE_LIMIT)) {
    await bucket.delete(chunk)
  }
}

/**
 * Deletes every object under one skill, user or staging prefix, one listed
 * page at a time with one batched delete per page. The guard keeps a
 * malformed argument from ever widening the delete beyond a single user.
 */
export async function deleteSkillPrefix(
  prefix: string,
  bucket: SkillBlobBucket,
): Promise<number> {
  if (!GUARDED_PREFIX_PATTERN.test(prefix)) {
    throw createError({
      message: 'Refusing to purge a non-skill prefix',
      status: 500,
      why: `Prefix "${prefix}" is outside ${SKILLS_STORAGE_PREFIX}/u<userId>/`,
      fix: 'Build the prefix with skillPrefix, skillUserPrefix or skillStagingUserPrefix',
    })
  }

  let objectsDeleted = 0
  let cursor: string | undefined

  do {
    const page = await bucket.list({
      prefix,
      cursor,
      limit: R2_LIST_PAGE_LIMIT,
    })
    const keys = page.objects.map((object) => {
      return object.key
    })

    if (keys.length > 0) {
      await bucket.delete(keys)

      objectsDeleted += keys.length
    }

    if (page.truncated && !page.cursor) {
      throw createError({
        message: 'Skill purge stopped before listing finished',
        status: 500,
        why: `R2 reported a truncated page under "${prefix}" without a cursor`,
        fix: 'Retry the purge; the remaining objects were not deleted',
      })
    }

    cursor = page.truncated ? page.cursor : undefined
  } while (cursor)

  return objectsDeleted
}

/**
 * Keeps the newest `keep` versions plus the current version, a pending
 * version and every pinned version (shares pin one). Rows go first, then
 * only the blobs that no remaining row of the skill references, so a blob
 * shared with a kept version survives. A failed R2 delete leaves orphan
 * blobs that the hourly sweep removes. A save must call it right after its
 * own commit, with saves serialised per skill by the `baseVersion` guard:
 * a concurrent save could otherwise reuse a blob that this prune has just
 * judged unreferenced.
 */
export async function pruneSkillVersions(input: {
  db: DbClient
  bucket: SkillBlobBucket
  userId: number
  skillId: string
  keep?: number
  pinnedVersions?: number[]
}): Promise<PruneSkillVersionsResult> {
  const { db, bucket, userId, skillId } = input
  const keep = input.keep ?? SKILL_VERSIONS_KEPT
  const empty: PruneSkillVersionsResult = {
    versionsPruned: 0,
    blobsDeleted: 0,
  }
  const skill = await db.select({
    currentVersion: schema.skills.currentVersion,
    pendingVersion: schema.skills.pendingVersion,
  })
    .from(schema.skills)
    .where(and(
      eq(schema.skills.id, skillId),
      eq(schema.skills.userId, userId),
    ))
    .limit(1)
    .then((rows) => {
      return rows[0]
    })

  if (!skill) {
    return empty
  }

  const versionRows = await db.select({ version: schema.skillVersions.version })
    .from(schema.skillVersions)
    .where(and(
      eq(schema.skillVersions.skillId, skillId),
      eq(schema.skillVersions.userId, userId),
    ))
    .orderBy(desc(schema.skillVersions.version))
  const versions = versionRows.map((row) => {
    return row.version
  })
  const protectedVersions = new Set<number>([
    ...versions.slice(0, Math.max(keep, 0)),
    skill.currentVersion,
    ...(skill.pendingVersion === null ? [] : [skill.pendingVersion]),
    ...(input.pinnedVersions ?? []),
  ])
  const prunedVersions = versions.filter((version) => {
    return !protectedVersions.has(version)
  })

  if (prunedVersions.length === 0) {
    return empty
  }

  const candidateShas = new Set<string>()

  for (const chunk of chunkItems(prunedVersions, MAX_BATCH_QUERY_PARAMS)) {
    const rows = await db.select({ blobSha256: schema.skillFiles.blobSha256 })
      .from(schema.skillFiles)
      .where(and(
        eq(schema.skillFiles.skillId, skillId),
        eq(schema.skillFiles.userId, userId),
        inArray(schema.skillFiles.version, chunk),
      ))

    for (const row of rows) {
      candidateShas.add(row.blobSha256)
    }
  }

  for (const chunk of chunkItems(prunedVersions, MAX_BATCH_QUERY_PARAMS)) {
    await db.batch([
      db.delete(schema.skillFiles).where(and(
        eq(schema.skillFiles.skillId, skillId),
        eq(schema.skillFiles.userId, userId),
        inArray(schema.skillFiles.version, chunk),
      )),
      db.delete(schema.skillVersions).where(and(
        eq(schema.skillVersions.skillId, skillId),
        eq(schema.skillVersions.userId, userId),
        inArray(schema.skillVersions.version, chunk),
      )),
    ])
  }

  const stillReferenced = new Set<string>()

  for (const chunk of chunkItems([...candidateShas], MAX_BATCH_QUERY_PARAMS)) {
    const rows = await db.select({ blobSha256: schema.skillFiles.blobSha256 })
      .from(schema.skillFiles)
      .where(and(
        eq(schema.skillFiles.skillId, skillId),
        inArray(schema.skillFiles.blobSha256, chunk),
      ))

    for (const row of rows) {
      stillReferenced.add(row.blobSha256)
    }
  }

  const orphanKeys = [...candidateShas]
    .filter((sha256) => {
      return !stillReferenced.has(sha256)
    })
    .map((sha256) => {
      return skillBlobKey(userId, skillId, sha256)
    })

  await deleteObjectKeys(bucket, orphanKeys)

  return {
    versionsPruned: prunedVersions.length,
    blobsDeleted: orphanKeys.length,
  }
}
