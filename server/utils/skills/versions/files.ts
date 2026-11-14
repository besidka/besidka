import { zipSync } from 'fflate'
import { SKILL_VIEWER_FILE_MAX_BYTES } from '#shared/utils/skills-policy'
import { createSkillEditError } from '~~/server/utils/skills/versions/errors'
import {
  loadOwnedSkill,
  loadVersionFiles,
  loadVersionRow,
  readBlobBytes,
} from '~~/server/utils/skills/versions/read'
import type { SkillReadBucket } from '~~/server/utils/skills/versions/read'
import {
  isLicenceLocked,
  toFileSummary,
} from '~~/server/utils/skills/versions/view'

type DbClient = ReturnType<typeof useDb>

const textDecoder = new TextDecoder()

async function resolveVersion(
  db: DbClient,
  userId: number,
  skillId: string,
  requested: number | undefined,
  currentVersion: number,
): Promise<number> {
  const version = requested ?? currentVersion

  if (!await loadVersionRow(db, userId, skillId, version)) {
    throw createSkillEditError('version-not-found', {
      message: 'Version not found',
      why: 'The version does not exist, or was removed with the older versions',
      fix: 'Reload the versions list',
    })
  }

  return version
}

/**
 * The files of one version (the current one unless another is named): the
 * list without a `path`, or one file with its text. A file is read only
 * after ownership is checked in D1, and a blob that is missing answers 409.
 */
export async function readSkillVersionFiles(input: {
  db: DbClient
  bucket: SkillReadBucket
  userId: number
  skillId: string
  version?: number
  path?: string
}) {
  const { db, bucket, userId } = input
  const skill = await loadOwnedSkill(db, userId, input.skillId)
  const version = await resolveVersion(
    db,
    userId,
    skill.id,
    input.version,
    skill.currentVersion,
  )
  const files = await loadVersionFiles(db, userId, skill.id, version)
  const locksLicenceFiles = isLicenceLocked(skill.licenseClass)

  if (input.path === undefined) {
    return {
      version,
      files: files.map((file) => {
        return toFileSummary(file, locksLicenceFiles)
      }),
    }
  }

  const file = files.find((candidate) => {
    return candidate.path === input.path
  })

  if (!file) {
    throw createSkillEditError('file-not-found', {
      message: 'File not found',
      why: 'The version has no file at this path',
      fix: 'Reload the file list',
    })
  }

  if (file.bytes > SKILL_VIEWER_FILE_MAX_BYTES) {
    throw createSkillEditError('file-too-large', {
      message: 'This file is too large to show',
      why: 'The viewer shows files up to 1 MiB',
      fix: 'Download the skill to read it',
    })
  }

  const bytes = await readBlobBytes({
    bucket,
    userId,
    skillId: skill.id,
    blobSha256: file.blobSha256,
  })

  return {
    version,
    ...toFileSummary(file, locksLicenceFiles),
    text: textDecoder.decode(bytes),
  }
}

/**
 * The current version as a zip with one top-level folder named after the
 * skill, which is the layout the importer expects, so a download imports
 * back. The files are read one at a time.
 */
export async function buildSkillArchive(input: {
  db: DbClient
  bucket: SkillReadBucket
  userId: number
  skillId: string
}) {
  const { db, bucket, userId } = input
  const skill = await loadOwnedSkill(db, userId, input.skillId)
  const files = await loadVersionFiles(
    db,
    userId,
    skill.id,
    skill.currentVersion,
  )
  const entries: Record<string, Uint8Array> = {}

  for (const file of files) {
    entries[`${skill.name}/${file.path}`] = await readBlobBytes({
      bucket,
      userId,
      skillId: skill.id,
      blobSha256: file.blobSha256,
    })
  }

  return {
    name: skill.name,
    version: skill.currentVersion,
    filesCount: files.length,
    bytes: zipSync(entries),
  }
}
