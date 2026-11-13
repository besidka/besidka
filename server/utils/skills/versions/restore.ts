import type { LoggerLike } from '~~/server/utils/files/logger'
import type { WorkingSkillFile } from '~~/server/utils/skills/versions/apply'
import {
  createSkillEditError,
  createStaleBaseError,
} from '~~/server/utils/skills/versions/errors'
import { prepareSkillVersion } from '~~/server/utils/skills/versions/prepare'
import {
  loadOwnedSkill,
  loadVersionFiles,
  loadVersionRow,
} from '~~/server/utils/skills/versions/read'
import { writeSkillVersion } from '~~/server/utils/skills/versions/write'
import type {
  SkillWriteBucket,
  WrittenSkillVersion,
} from '~~/server/utils/skills/versions/write'

type DbClient = ReturnType<typeof useDb>

export interface RestoreSkillInput {
  db: DbClient
  bucket: SkillWriteBucket
  userId: number
  skillId: string
  version: number
  baseVersion?: number
  note: string | null
  logger: LoggerLike
}

export type RestoreSkillResult
  = | ({
    unchanged: false
    id: string
    restoredFrom: number
  } & WrittenSkillVersion)
  | { unchanged: true, id: string, version: number, restoredFrom: number }

/**
 * Makes an older version current by writing its files as the next version,
 * over the same blobs: nothing is rewritten and no blob is copied. The
 * restored `SKILL.md` brings its own name back, so the rename rules apply
 * (a free name, no reserved name while the command toggle is on), and the
 * licence classifier runs again. A pending update cannot be restored, since
 * that would activate an unreviewed version without the accept's disable.
 */
export async function restoreSkillVersion(
  input: RestoreSkillInput,
): Promise<RestoreSkillResult> {
  const { db, bucket, userId, skillId, version } = input
  const skill = await loadOwnedSkill(db, userId, skillId)

  if (input.baseVersion !== undefined
    && input.baseVersion !== skill.currentVersion) {
    throw createStaleBaseError()
  }

  const target = await loadVersionRow(db, userId, skillId, version)

  if (!target) {
    throw createSkillEditError('version-not-found', {
      message: 'Version not found',
      why: 'The version does not exist, or was removed with the older versions',
      fix: 'Reload the versions list',
    })
  }

  if (version === skill.pendingVersion) {
    throw createSkillEditError('pending-version', {
      message: 'This version is an update waiting for review',
      why: 'Restoring it would skip the review that accepting an update asks for',
      fix: 'Review the update, then accept or reject it',
    })
  }

  const targetFiles: WorkingSkillFile[] = (
    await loadVersionFiles(db, userId, skillId, version)
  ).map((row) => {
    return {
      path: row.path,
      blobSha256: row.blobSha256,
      bytes: row.bytes,
      kind: row.kind,
    }
  })

  if (version === skill.currentVersion) {
    throw createSkillEditError('version-is-current', {
      message: 'This is the current version',
      why: 'There is nothing to restore',
      fix: 'Pick an older version',
    })
  }

  const prepared = await prepareSkillVersion({
    db,
    bucket,
    userId,
    skill,
    files: targetFiles,
    heldTexts: new Map(),
  })
  const currentRow = await loadVersionRow(
    db,
    userId,
    skillId,
    skill.currentVersion,
  )

  if (currentRow && currentRow.sha256 === prepared.sha256) {
    return {
      unchanged: true,
      id: skillId,
      version: skill.currentVersion,
      restoredFrom: version,
    }
  }

  const written = await writeSkillVersion({
    db,
    bucket,
    userId,
    skill,
    baseVersion: skill.currentVersion,
    files: targetFiles,
    prepared,
    blobsToWrite: new Map(),
    origin: 'restore',
    note: input.note ?? `Restored version ${version}`,
    findingCounts: target.findings ?? {},
    logger: input.logger,
  })

  input.logger.set({
    attributes: {
      skills: {
        restore: {
          restoredFrom: version,
          version: written.version,
          renamed: written.renamed,
          files: written.filesCount,
        },
      },
    },
  })

  return { unchanged: false, id: skillId, restoredFrom: version, ...written }
}
