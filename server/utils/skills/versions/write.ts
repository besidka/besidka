import { and, desc, eq } from 'drizzle-orm'
import { SKILL_LICENCE_CLASSIFIER_VERSION } from '#shared/utils/skills/licence'
import {
  SKILLS_MAX_USER_BYTES,
} from '#shared/utils/skills-policy'
import type { SkillVersionOrigin } from '#shared/utils/skills-policy'
import * as schema from '~~/server/db/schema'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import {
  assertLimits,
  createStorageLimitError,
} from '~~/server/utils/skills/import/commit'
import {
  pruneSkillVersions,
  putSkillBlob,
} from '~~/server/utils/skills/storage'
import { hasEveryBlob } from '~~/server/utils/skills/versions/blobs'
import { findUniqueViolation } from '~~/server/utils/skills/unique-violation'
import { getUserSkillsUsageBytes } from '~~/server/utils/skills/usage'
import type { WorkingSkillFile } from '~~/server/utils/skills/versions/apply'
import {
  createSkillEditError,
  createStaleBaseError,
} from '~~/server/utils/skills/versions/errors'
import type { PreparedSkillVersion } from '~~/server/utils/skills/versions/prepare'
import { loadOwnedSkill } from '~~/server/utils/skills/versions/read'
import type {
  SkillReadBucket,
  SkillRow,
} from '~~/server/utils/skills/versions/read'
import {
  asBatch,
  buildGuardedVersionStatements,
} from '~~/server/utils/skills/versions/statements'
import type { SkillBlobBucket } from '~~/server/utils/skills/storage'

type DbClient = ReturnType<typeof useDb>

export type SkillWriteBucket = SkillBlobBucket & SkillReadBucket

export interface WriteSkillVersionInput {
  db: DbClient
  bucket: SkillWriteBucket
  userId: number
  skill: SkillRow
  baseVersion: number
  files: WorkingSkillFile[]
  prepared: PreparedSkillVersion
  blobsToWrite: Map<string, Uint8Array>
  origin: SkillVersionOrigin
  note: string | null
  findingCounts: Record<string, number>
  blobsVerified?: boolean
  logger: LoggerLike
}

export interface WrittenSkillVersion {
  version: number
  name: string
  renamed: boolean
  filesCount: number
  bytes: number
  licenseClass: string
  findingCounts: Record<string, number>
  recovered: boolean
  versionsPruned: number
}

async function countNewBlobBytes(
  db: DbClient,
  skillId: string,
  userId: number,
  blobsToWrite: Map<string, Uint8Array>,
): Promise<number> {
  if (blobsToWrite.size === 0) {
    return 0
  }

  const rows = await db.selectDistinct({
    blobSha256: schema.skillFiles.blobSha256,
  })
    .from(schema.skillFiles)
    .where(and(
      eq(schema.skillFiles.skillId, skillId),
      eq(schema.skillFiles.userId, userId),
    ))
  const known = new Set(rows.map((row) => {
    return row.blobSha256
  }))
  let incoming = 0

  for (const [sha256, bytes] of blobsToWrite) {
    if (!known.has(sha256)) {
      incoming += bytes.byteLength
    }
  }

  return incoming
}

async function explainRejectedWrite(
  db: DbClient,
  userId: number,
  skillId: string,
  baseVersion: number,
): Promise<never> {
  const fresh = await loadOwnedSkill(db, userId, skillId)

  if (fresh.currentVersion !== baseVersion) {
    throw createStaleBaseError()
  }

  throw createStorageLimitError()
}

/**
 * The one writer of a new version of an existing skill (save and restore).
 * The blobs go to R2 first (idempotent, content-addressed, and only the
 * contents the caller holds); then one guarded `db.batch()` adds the version
 * with its file rows and moves `skills.current_version`. `current_version`
 * only increases and `pending_version` is not touched, so a pending update
 * stays pending. The new number is the highest existing one plus 1, because
 * a pending row can hold `base + 1`. A stale `baseVersion` answers 409 and
 * writes no row; the cap on unique blobs is enforced in the same statement.
 * Right after the commit the blobs are put again (closing the window in
 * which a prune could have judged them unreferenced) and the versions beyond
 * `SKILL_VERSIONS_KEPT` are pruned; neither step can fail the save. The cap
 * on unique blobs applies only when the write adds blob bytes. A `broken`
 * skill becomes `ready` in the same guarded update when every blob of the
 * new version is in R2 (`blobsVerified` lets a caller that already checked
 * say so).
 */
export async function writeSkillVersion(
  input: WriteSkillVersionInput,
): Promise<WrittenSkillVersion> {
  const { db, bucket, userId, skill, prepared } = input
  const skillId = skill.id
  const incomingBytes = await countNewBlobBytes(
    db,
    skillId,
    userId,
    input.blobsToWrite,
  )

  if (incomingBytes > 0) {
    assertLimits({
      skillsCount: 0,
      usageBytes: await getUserSkillsUsageBytes(db, userId),
      incomingBytes,
      isNewSkill: false,
    })
  }

  const [latest] = await db.select({ version: schema.skillVersions.version })
    .from(schema.skillVersions)
    .where(and(
      eq(schema.skillVersions.skillId, skillId),
      eq(schema.skillVersions.userId, userId),
    ))
    .orderBy(desc(schema.skillVersions.version))
    .limit(1)
  const version = (latest?.version ?? 0) + 1

  for (const bytes of input.blobsToWrite.values()) {
    await putSkillBlob({ bucket, userId, skillId, content: bytes })
  }

  const markReady = skill.status === 'broken'
    && (input.blobsVerified ?? await hasEveryBlob({
      bucket,
      userId,
      skillId,
      files: input.files.filter((file) => {
        return !input.blobsToWrite.has(file.blobSha256)
      }),
    }))
  const statements = buildGuardedVersionStatements({
    db,
    userId,
    skillId,
    baseVersion: input.baseVersion,
    maxUserBytes: SKILLS_MAX_USER_BYTES,
    incomingBytes,
    record: {
      skillId,
      userId,
      version,
      origin: input.origin,
      sha256: prepared.sha256,
      filesCount: input.files.length,
      bytes: prepared.totalBytes,
      licenseClass: prepared.licenseClass,
      licenseFileSha256: prepared.licence.licenceFileSha256,
      findings: input.findingCounts,
      note: input.note,
    },
    files: input.files,
    skillSet: {
      currentVersion: version,
      name: prepared.frontmatter.name,
      description: prepared.frontmatter.description,
      licenseField: prepared.frontmatter.license,
      licenseClass: prepared.licenseClass,
      licenseFileSha256: prepared.licence.licenceFileSha256,
      licenseClassifierVersion: SKILL_LICENCE_CLASSIFIER_VERSION,
      compatibility: prepared.frontmatter.compatibility,
      metadata: prepared.frontmatter.metadata,
      allowedTools: prepared.frontmatter.allowedTools,
      filesCount: input.files.length,
      bytes: prepared.totalBytes,
      ...(markReady ? { status: 'ready' as const } : {}),
    },
  })
  let results: unknown[]

  try {
    results = await db.batch(asBatch(statements)) as unknown[]
  } catch (exception) {
    const violation = findUniqueViolation(exception)

    if (violation?.includes('skills.name')) {
      throw createSkillEditError('name-taken', {
        message: `A skill named ${prepared.frontmatter.name} exists`,
        why: 'Skill names are unique, because they are the names of /commands too',
        fix: 'Pick another name',
      })
    }

    if (violation) {
      throw createStaleBaseError()
    }

    throw exception
  }

  const updated = results.at(-1)

  if (!Array.isArray(updated) || updated.length === 0) {
    return await explainRejectedWrite(db, userId, skillId, input.baseVersion)
  }

  let versionsPruned = 0

  try {
    for (const bytes of input.blobsToWrite.values()) {
      await putSkillBlob({ bucket, userId, skillId, content: bytes })
    }

    versionsPruned = (await pruneSkillVersions({
      db,
      bucket,
      userId,
      skillId,
    })).versionsPruned
  } catch (exception) {
    input.logger.set({
      attributes: {
        skills: {
          save: { afterCommitFailed: true, error: exceptionMessage(exception) },
        },
      },
    })
  }

  return {
    version,
    name: prepared.frontmatter.name,
    renamed: prepared.renamed,
    filesCount: input.files.length,
    bytes: prepared.totalBytes,
    licenseClass: prepared.licenseClass,
    findingCounts: input.findingCounts,
    recovered: markReady,
    versionsPruned,
  }
}
