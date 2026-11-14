import { SKILL_DIFF_MAX_FILES } from '#shared/utils/skills-policy'
import { diffSkillFiles } from '#shared/utils/skills/diff'
import { createSkillEditError } from '~~/server/utils/skills/versions/errors'
import {
  loadOwnedSkill,
  loadVersionFiles,
  loadVersionRow,
  readChangedFileTexts,
} from '~~/server/utils/skills/versions/read'
import type { SkillReadBucket } from '~~/server/utils/skills/versions/read'
import { toVersionSummary } from '~~/server/utils/skills/versions/view'

type DbClient = ReturnType<typeof useDb>

function createVersionNotFoundError() {
  return createSkillEditError('version-not-found', {
    message: 'Version not found',
    why: 'The version does not exist, or was removed with the older versions',
    fix: 'Reload the versions list',
  })
}

/**
 * What changes if `version` replaces `against` (the current version unless
 * another is named): `against` is the "before" side and `version` the
 * "after" side. A pending update reviewed this way shows what accepting it
 * would replace, and an older version shows what restoring it would undo.
 * Only files whose content differs are read, and at most
 * `SKILL_DIFF_MAX_FILES` of them; the rest are listed in `skipped`.
 */
export async function diffSkillVersions(input: {
  db: DbClient
  bucket: SkillReadBucket
  userId: number
  skillId: string
  version: number
  against?: number
}) {
  const { db, bucket, userId } = input
  const skill = await loadOwnedSkill(db, userId, input.skillId)
  const againstVersion = input.against ?? skill.currentVersion
  const [afterRow, beforeRow] = await Promise.all([
    loadVersionRow(db, userId, skill.id, input.version),
    loadVersionRow(db, userId, skill.id, againstVersion),
  ])

  if (!afterRow || !beforeRow) {
    throw createVersionNotFoundError()
  }

  const [afterFiles, beforeFiles] = await Promise.all([
    loadVersionFiles(db, userId, skill.id, input.version),
    loadVersionFiles(db, userId, skill.id, againstVersion),
  ])
  const texts = await readChangedFileTexts({
    bucket,
    userId,
    skillId: skill.id,
    beforeFiles,
    afterFiles,
    maxFiles: SKILL_DIFF_MAX_FILES,
  })

  return {
    from: toVersionSummary(beforeRow, skill),
    to: toVersionSummary(afterRow, skill),
    diff: {
      ...diffSkillFiles(texts.before, texts.after),
      unchanged: texts.unchanged,
    },
    skipped: texts.skipped,
    licence: {
      changed: beforeRow.licenseClass !== afterRow.licenseClass
        || beforeRow.licenseFileSha256 !== afterRow.licenseFileSha256,
      before: {
        class: beforeRow.licenseClass,
        fileSha256: beforeRow.licenseFileSha256,
      },
      after: {
        class: afterRow.licenseClass,
        fileSha256: afterRow.licenseFileSha256,
      },
    },
  }
}
