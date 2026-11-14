import { and, asc, desc, eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { isDecodableSkillPublicId } from '~~/server/utils/skills/ids'
import type { SkillStageBucket } from '~~/server/utils/skills/import/stage'
import { skillBlobKey } from '~~/server/utils/skills/storage'
import {
  createFilesMissingError,
  createSkillNotFoundError,
} from '~~/server/utils/skills/versions/errors'

type DbClient = ReturnType<typeof useDb>

export type SkillRow = typeof schema.skills.$inferSelect
export type SkillVersionRow = typeof schema.skillVersions.$inferSelect
export type SkillFileRow = typeof schema.skillFiles.$inferSelect

export type SkillReadBucket = Pick<SkillStageBucket, 'get'>

const textDecoder = new TextDecoder()

/**
 * Ownership is checked in D1 first, for every read and write of a skill:
 * the id must decode, and the row must belong to the user.
 */
export async function loadOwnedSkill(
  db: DbClient,
  userId: number,
  skillId: string,
): Promise<SkillRow> {
  if (!isDecodableSkillPublicId(skillId)) {
    throw createSkillNotFoundError()
  }

  const [skill] = await db.select()
    .from(schema.skills)
    .where(and(
      eq(schema.skills.id, skillId),
      eq(schema.skills.userId, userId),
    ))
    .limit(1)

  if (!skill) {
    throw createSkillNotFoundError()
  }

  return skill
}

export async function loadVersionFiles(
  db: DbClient,
  userId: number,
  skillId: string,
  version: number,
): Promise<SkillFileRow[]> {
  return await db.select()
    .from(schema.skillFiles)
    .where(and(
      eq(schema.skillFiles.skillId, skillId),
      eq(schema.skillFiles.userId, userId),
      eq(schema.skillFiles.version, version),
    ))
    .orderBy(asc(schema.skillFiles.path))
}

export async function loadVersionRow(
  db: DbClient,
  userId: number,
  skillId: string,
  version: number,
): Promise<SkillVersionRow | null> {
  const [row] = await db.select()
    .from(schema.skillVersions)
    .where(and(
      eq(schema.skillVersions.skillId, skillId),
      eq(schema.skillVersions.userId, userId),
      eq(schema.skillVersions.version, version),
    ))
    .limit(1)

  return row ?? null
}

export async function loadSkillVersions(
  db: DbClient,
  userId: number,
  skillId: string,
): Promise<SkillVersionRow[]> {
  return await db.select()
    .from(schema.skillVersions)
    .where(and(
      eq(schema.skillVersions.skillId, skillId),
      eq(schema.skillVersions.userId, userId),
    ))
    .orderBy(desc(schema.skillVersions.version))
}

export async function readBlobBytes(input: {
  bucket: SkillReadBucket
  userId: number
  skillId: string
  blobSha256: string
}): Promise<Uint8Array> {
  const object = await input.bucket.get(
    skillBlobKey(input.userId, input.skillId, input.blobSha256),
  )

  if (!object) {
    throw createFilesMissingError()
  }

  return new Uint8Array(await object.arrayBuffer())
}

export async function readBlobText(input: {
  bucket: SkillReadBucket
  userId: number
  skillId: string
  blobSha256: string
}): Promise<string> {
  return textDecoder.decode(await readBlobBytes(input))
}

export interface ChangedFileTexts {
  before: Map<string, string>
  after: Map<string, string>
  unchanged: number
  skipped: Array<{ path: string, status: 'added' | 'removed' | 'modified' }>
}

/**
 * Reads only the files whose content differs between two versions, one R2
 * read at a time. A file that is the same blob on both sides is counted as
 * unchanged and never read. With `maxFiles`, the files past the cap (in
 * path order) are reported in `skipped` instead of being read.
 */
export async function readChangedFileTexts(input: {
  bucket: SkillReadBucket
  userId: number
  skillId: string
  beforeFiles: Array<Pick<SkillFileRow, 'path' | 'blobSha256'>>
  afterFiles: Array<Pick<SkillFileRow, 'path' | 'blobSha256'>>
  knownTexts?: Map<string, string>
  maxFiles?: number
}): Promise<ChangedFileTexts> {
  const beforeByPath = new Map(input.beforeFiles.map((file) => {
    return [file.path, file.blobSha256]
  }))
  const afterByPath = new Map(input.afterFiles.map((file) => {
    return [file.path, file.blobSha256]
  }))
  const allPaths = [...new Set([...beforeByPath.keys(), ...afterByPath.keys()])]
    .sort()
  const changedPaths = allPaths.filter((path) => {
    return beforeByPath.get(path) !== afterByPath.get(path)
  })
  const readPaths = input.maxFiles === undefined
    ? changedPaths
    : changedPaths.slice(0, input.maxFiles)
  const result: ChangedFileTexts = {
    before: new Map(),
    after: new Map(),
    unchanged: allPaths.length - changedPaths.length,
    skipped: changedPaths.slice(readPaths.length).map((path) => {
      return {
        path,
        status: !beforeByPath.has(path)
          ? 'added'
          : !afterByPath.has(path) ? 'removed' : 'modified',
      }
    }),
  }

  for (const path of readPaths) {
    const beforeSha = beforeByPath.get(path)
    const afterSha = afterByPath.get(path)

    if (afterSha !== undefined) {
      result.after.set(
        path,
        input.knownTexts?.get(afterSha) ?? await readBlobText({
          bucket: input.bucket,
          userId: input.userId,
          skillId: input.skillId,
          blobSha256: afterSha,
        }),
      )
    }

    if (beforeSha !== undefined) {
      result.before.set(
        path,
        input.knownTexts?.get(beforeSha) ?? await readBlobText({
          bucket: input.bucket,
          userId: input.userId,
          skillId: input.skillId,
          blobSha256: beforeSha,
        }),
      )
    }
  }

  return result
}
