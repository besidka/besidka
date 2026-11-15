import { and, inArray } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import {
  decodePublicId,
  encodePublicId,
} from '~~/server/utils/custom-db-types'
import {
  SKILL_ORPHAN_GRACE_SECONDS,
  SKILLS_STAGING_PREFIX,
  SKILLS_STORAGE_PREFIX,
  parseSkillBlobKey,
} from '~~/server/utils/skills/storage'
import type {
  ParsedSkillBlobKey,
  SkillBlobBucket,
} from '~~/server/utils/skills/storage'

type DbClient = ReturnType<typeof useDb>

export const SKILL_SWEEP_STAGING_CURSOR_KEY = 'skills:sweep:staging-cursor'
export const SKILL_SWEEP_BLOB_CURSOR_KEY = 'skills:sweep:blob-cursor'

const SWEEP_LIST_PAGE_LIMIT = 500
const SWEEP_MAX_PAGES_PER_PASS = 2
const SWEEP_CURSOR_TTL_SECONDS = 24 * 60 * 60
const ORPHAN_LOOKUP_GROUP_SIZE = 40
const R2_BATCH_DELETE_LIMIT = 1000

export interface SkillSweepKv {
  get: (key: string) => Promise<string | null>
  put: (
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ) => Promise<unknown>
  delete: (key: string) => Promise<unknown>
}

export interface SkillStorageSweepResult {
  stagingObjectsDeleted: number
  orphanBlobsDeleted: number
  blobObjectsScanned: number
  unrecognisedObjects: number
}

export interface SweepSkillStorageInput {
  db: DbClient
  bucket: SkillBlobBucket
  kv: SkillSweepKv
  now?: Date
  graceSeconds?: number
}

function chunkItems<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = []

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize))
  }

  return chunks
}

function isCanonicalSkillId(skillId: string): boolean {
  const decoded = decodePublicId(skillId)

  return Number.isSafeInteger(decoded) && encodePublicId(decoded) === skillId
}

function pairKey(skillId: string, sha256: string): string {
  return `${skillId}:${sha256}`
}

async function deleteKeys(
  bucket: SkillBlobBucket,
  keys: string[],
): Promise<void> {
  for (const chunk of chunkItems(keys, R2_BATCH_DELETE_LIMIT)) {
    await bucket.delete(chunk)
  }
}

async function findReferencedPairs(
  db: DbClient,
  parsedKeys: ParsedSkillBlobKey[],
): Promise<Set<string>> {
  const referenced = new Set<string>()

  for (const group of chunkItems(parsedKeys, ORPHAN_LOOKUP_GROUP_SIZE)) {
    const rows = await db.select({
      skillId: schema.skillFiles.skillId,
      blobSha256: schema.skillFiles.blobSha256,
    })
      .from(schema.skillFiles)
      .where(and(
        inArray(schema.skillFiles.skillId, [
          ...new Set(group.map((parsed) => {
            return parsed.skillId
          })),
        ]),
        inArray(schema.skillFiles.blobSha256, [
          ...new Set(group.map((parsed) => {
            return parsed.sha256
          })),
        ]),
      ))

    for (const row of rows) {
      referenced.add(pairKey(row.skillId, row.blobSha256))
    }
  }

  return referenced
}

async function readCursor(
  kv: SkillSweepKv,
  cursorKey: string,
): Promise<string | undefined> {
  const stored = await kv.get(cursorKey)

  return stored || undefined
}

async function saveCursor(
  kv: SkillSweepKv,
  cursorKey: string,
  cursor: string | undefined,
): Promise<void> {
  if (!cursor) {
    await kv.delete(cursorKey)

    return
  }

  await kv.put(cursorKey, cursor, {
    expirationTtl: SWEEP_CURSOR_TTL_SECONDS,
  })
}

/**
 * Walks at most two listed pages under `prefix`, resuming from the cursor
 * stored in KV and clearing it when the listing ends. `handlePage` receives
 * the objects that are older than the cutoff and returns how many it
 * deleted. Objects younger than the cutoff stay, because a save puts its
 * blobs first and writes the rows afterwards.
 */
async function sweepPrefix(input: {
  bucket: SkillBlobBucket
  kv: SkillSweepKv
  prefix: string
  cursorKey: string
  cutoff: Date
  handlePage: (objects: Array<{ key: string }>) => Promise<number>
}): Promise<{ deleted: number, scanned: number }> {
  let cursor = await readCursor(input.kv, input.cursorKey)
  let deleted = 0
  let scanned = 0

  for (let page = 0; page < SWEEP_MAX_PAGES_PER_PASS; page++) {
    let listed: Awaited<ReturnType<SkillBlobBucket['list']>>

    try {
      listed = await input.bucket.list({
        prefix: input.prefix,
        cursor,
        limit: SWEEP_LIST_PAGE_LIMIT,
      })
    } catch (exception) {
      await input.kv.delete(input.cursorKey)

      throw exception
    }

    const oldObjects = listed.objects.filter((object) => {
      return object.uploaded.getTime() < input.cutoff.getTime()
    })

    scanned += listed.objects.length
    deleted += await input.handlePage(oldObjects)
    cursor = listed.truncated ? listed.cursor : undefined

    if (!cursor) {
      break
    }
  }

  await saveCursor(input.kv, input.cursorKey, cursor)

  return { deleted, scanned }
}

/**
 * Hourly storage sweep, two independent passes: staged import files older
 * than the one-hour grace period, and blobs under `user-skills/` that no
 * `skill_files` row references (a save whose batch failed, a skill whose
 * prefix delete failed). Each pass is bounded per run and resumes from a KV
 * cursor, so the whole bucket is covered over several runs. Objects whose
 * key does not parse as a blob are counted and left alone.
 */
export async function sweepSkillStorage(
  input: SweepSkillStorageInput,
): Promise<SkillStorageSweepResult> {
  const now = input.now ?? new Date()
  const graceSeconds = input.graceSeconds ?? SKILL_ORPHAN_GRACE_SECONDS
  const cutoff = new Date(now.getTime() - graceSeconds * 1000)
  let unrecognisedObjects = 0

  const staging = await sweepPrefix({
    bucket: input.bucket,
    kv: input.kv,
    prefix: `${SKILLS_STAGING_PREFIX}/`,
    cursorKey: SKILL_SWEEP_STAGING_CURSOR_KEY,
    cutoff,
    async handlePage(objects) {
      await deleteKeys(input.bucket, objects.map((object) => {
        return object.key
      }))

      return objects.length
    },
  })
  const blobs = await sweepPrefix({
    bucket: input.bucket,
    kv: input.kv,
    prefix: `${SKILLS_STORAGE_PREFIX}/`,
    cursorKey: SKILL_SWEEP_BLOB_CURSOR_KEY,
    cutoff,
    async handlePage(objects) {
      const parsedByKey = new Map<string, ParsedSkillBlobKey>()

      for (const object of objects) {
        const parsed = parseSkillBlobKey(object.key)

        if (parsed && isCanonicalSkillId(parsed.skillId)) {
          parsedByKey.set(object.key, parsed)
        } else {
          unrecognisedObjects++
        }
      }

      const referenced = await findReferencedPairs(
        input.db,
        [...parsedByKey.values()],
      )
      const orphanKeys = [...parsedByKey.entries()]
        .filter(([, parsed]) => {
          return !referenced.has(pairKey(parsed.skillId, parsed.sha256))
        })
        .map(([key]) => {
          return key
        })

      await deleteKeys(input.bucket, orphanKeys)

      return orphanKeys.length
    },
  })

  return {
    stagingObjectsDeleted: staging.deleted,
    orphanBlobsDeleted: blobs.deleted,
    blobObjectsScanned: blobs.scanned,
    unrecognisedObjects,
  }
}
