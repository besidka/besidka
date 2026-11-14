import type { BatchItem } from 'drizzle-orm/batch'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { createError } from 'evlog'
import { SKILL_LICENCE_CLASSIFIER_VERSION } from '#shared/utils/skills/licence'
import { SKILL_MD_FILE_NAME } from '#shared/utils/skills/path'
import { parseSkillMarkdown } from '#shared/utils/skills/frontmatter'
import * as schema from '~~/server/db/schema'
import { isDecodableSkillPublicId } from '~~/server/utils/skills/ids'
import type { SkillStageBucket } from '~~/server/utils/skills/import/stage'
import {
  pruneSkillVersions,
  skillBlobKey,
} from '~~/server/utils/skills/storage'

type DbClient = ReturnType<typeof useDb>

const MAX_ERROR_CAUSE_DEPTH = 5

export interface PendingVersionReference {
  version: number
  sha256: string
}

export interface AcceptPendingInput extends PendingVersionReference {
  db: DbClient
  bucket: SkillStageBucket
  userId: number
  skillId: string
}

export type RejectPendingInput = Omit<AcceptPendingInput, 'bucket'>

function createSkillNotFoundError() {
  return createError({
    message: 'Skill not found',
    status: 404,
    code: 'skill-not-found',
    why: 'The skill does not exist or is not yours',
    fix: 'Reload the skills list',
  })
}

function createPendingChangedError() {
  return createError({
    message: 'This update changed while you were reviewing it',
    status: 409,
    code: 'pending-changed',
    why: 'The pending version is gone or is not the one you reviewed',
    fix: 'Open the update again and review the new version',
  })
}

function isUniqueViolation(exception: unknown): boolean {
  let current: unknown = exception

  for (let depth = 0; depth < MAX_ERROR_CAUSE_DEPTH; depth++) {
    if (!(current instanceof Error)) {
      return false
    }

    if (current.message.includes('UNIQUE constraint failed')) {
      return true
    }

    current = current.cause
  }

  return false
}

async function loadReviewedPending(input: RejectPendingInput) {
  const { db, userId, skillId } = input

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

  if (skill.pendingVersion === null) {
    throw createPendingChangedError()
  }

  const [pending] = await db.select()
    .from(schema.skillVersions)
    .where(and(
      eq(schema.skillVersions.skillId, skillId),
      eq(schema.skillVersions.userId, userId),
      eq(schema.skillVersions.version, skill.pendingVersion),
    ))
    .limit(1)

  if (
    !pending
    || pending.version !== input.version
    || pending.sha256 !== input.sha256
  ) {
    throw createPendingChangedError()
  }

  return { skill, pending }
}

/**
 * One guarded statement that takes the pending version: it clears
 * `pending_version` only while it still points at the reviewed version, and
 * only the caller that gets a row back may go on. Two clicks, or an accept
 * and a reject, cannot both win.
 */
async function claimPendingVersion(
  input: RejectPendingInput,
  version: number,
): Promise<void> {
  const claimed = await input.db.update(schema.skills)
    .set({ pendingVersion: null })
    .where(and(
      eq(schema.skills.id, input.skillId),
      eq(schema.skills.userId, input.userId),
      eq(schema.skills.pendingVersion, version),
    ))
    .returning({ id: schema.skills.id })

  if (claimed.length === 0) {
    throw createPendingChangedError()
  }
}

async function releasePendingVersion(
  input: RejectPendingInput,
  version: number,
): Promise<void> {
  try {
    await input.db.update(schema.skills)
      .set({ pendingVersion: version })
      .where(and(
        eq(schema.skills.id, input.skillId),
        eq(schema.skills.userId, input.userId),
        isNull(schema.skills.pendingVersion),
      ))
  } catch {
    return
  }
}

function deletePendingStatements(
  db: DbClient,
  userId: number,
  skillId: string,
  version: number,
) {
  return [
    db.delete(schema.skillFiles).where(and(
      eq(schema.skillFiles.skillId, skillId),
      eq(schema.skillFiles.userId, userId),
      eq(schema.skillFiles.version, version),
    )),
    db.delete(schema.skillVersions).where(and(
      eq(schema.skillVersions.skillId, skillId),
      eq(schema.skillVersions.userId, userId),
      eq(schema.skillVersions.version, version),
    )),
  ]
}

async function readSkillMdText(input: {
  bucket: SkillStageBucket
  userId: number
  skillId: string
  blobSha256: string
}): Promise<string> {
  const object = await input.bucket.get(
    skillBlobKey(input.userId, input.skillId, input.blobSha256),
  )

  if (!object) {
    throw createError({
      message: 'The files of this update are missing',
      status: 409,
      code: 'files-missing',
      why: 'A stored file of the pending version could not be read',
      fix: 'Import the skill again',
    })
  }

  return new TextDecoder().decode(await object.arrayBuffer())
}

/**
 * Accepting creates a new version row numbered max + 1 over the same blobs,
 * so `current_version` only ever increases and nothing is copied in R2. The
 * skill takes the provenance of the accepted version, its facts from the
 * new `SKILL.md`, and is disabled until the user enables it again.
 */
export async function acceptPendingSkillVersion(
  input: AcceptPendingInput,
): Promise<{ id: string, version: number, enabled: false }> {
  const { db, bucket, userId, skillId } = input
  const { skill, pending } = await loadReviewedPending(input)
  const pendingFiles = await db.select()
    .from(schema.skillFiles)
    .where(and(
      eq(schema.skillFiles.skillId, skillId),
      eq(schema.skillFiles.userId, userId),
      eq(schema.skillFiles.version, pending.version),
    ))
  const skillMdFile = pendingFiles.find((file) => {
    return file.path === SKILL_MD_FILE_NAME
  })
  const parsed = skillMdFile
    ? parseSkillMarkdown(await readSkillMdText({
      bucket,
      userId,
      skillId,
      blobSha256: skillMdFile.blobSha256,
    }))
    : null
  const [latest] = await db.select({ version: schema.skillVersions.version })
    .from(schema.skillVersions)
    .where(and(
      eq(schema.skillVersions.skillId, skillId),
      eq(schema.skillVersions.userId, userId),
    ))
    .orderBy(desc(schema.skillVersions.version))
    .limit(1)
  const version = (latest?.version ?? 0) + 1
  const hasProvenance = pending.sourceKind !== null
  const frontmatter = parsed?.ok ? parsed.frontmatter : null

  await claimPendingVersion(input, pending.version)

  try {
    await db.batch([
      db.insert(schema.skillVersions).values({
        skillId,
        userId,
        version,
        origin: pending.origin,
        createdByClientId: pending.createdByClientId,
        sourceKind: pending.sourceKind,
        sourceUrl: pending.sourceUrl,
        sourceRef: pending.sourceRef,
        sourcePath: pending.sourcePath,
        sourceVersion: pending.sourceVersion,
        sha256: pending.sha256,
        filesCount: pending.filesCount,
        bytes: pending.bytes,
        licenseClass: pending.licenseClass,
        licenseFileSha256: pending.licenseFileSha256,
        findings: pending.findings,
        note: pending.note,
      }),
      ...pendingFiles.map((file) => {
        return db.insert(schema.skillFiles).values({
          skillId,
          userId,
          version,
          path: file.path,
          blobSha256: file.blobSha256,
          bytes: file.bytes,
          kind: file.kind,
        })
      }),
      db.update(schema.skills)
        .set({
          currentVersion: version,
          pendingVersion: null,
          enabled: false,
          status: 'ready',
          filesCount: pending.filesCount,
          bytes: pending.bytes,
          licenseClass: pending.licenseClass,
          licenseFileSha256: pending.licenseFileSha256,
          licenseClassifierVersion: SKILL_LICENCE_CLASSIFIER_VERSION,
          sourceKind: hasProvenance ? pending.sourceKind! : skill.sourceKind,
          sourceUrl: hasProvenance ? pending.sourceUrl : skill.sourceUrl,
          sourceRef: hasProvenance ? pending.sourceRef : skill.sourceRef,
          sourcePath: hasProvenance ? pending.sourcePath : skill.sourcePath,
          sourceVersion: pending.sourceVersion ?? skill.sourceVersion,
          ...(frontmatter
            ? {
              description: frontmatter.description,
              licenseField: frontmatter.license,
              compatibility: frontmatter.compatibility,
              metadata: frontmatter.metadata,
              allowedTools: frontmatter.allowedTools,
            }
            : {}),
        })
        .where(and(
          eq(schema.skills.id, skillId),
          eq(schema.skills.userId, userId),
        )),
      ...deletePendingStatements(db, userId, skillId, pending.version),
    ] as unknown as [BatchItem<'sqlite'>])
  } catch (exception) {
    await releasePendingVersion(input, pending.version)

    if (isUniqueViolation(exception)) {
      throw createPendingChangedError()
    }

    throw exception
  }

  try {
    await pruneSkillVersions({ db, bucket, userId, skillId })
  } catch {
    return { id: skillId, version, enabled: false }
  }

  return { id: skillId, version, enabled: false }
}

/**
 * Rejecting deletes the pending rows and clears the pointer. The blobs stay
 * for the prune and the hourly sweep, which delete what nothing references.
 */
export async function rejectPendingSkillVersion(
  input: RejectPendingInput,
): Promise<{ id: string, rejected: true }> {
  const { db, userId, skillId } = input
  const { pending } = await loadReviewedPending(input)

  await claimPendingVersion(input, pending.version)
  const deletions = deletePendingStatements(
    db,
    userId,
    skillId,
    pending.version,
  ) as unknown as [BatchItem<'sqlite'>]

  await db.batch(deletions)

  return { id: skillId, rejected: true }
}
