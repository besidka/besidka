import { and, eq, ne } from 'drizzle-orm'
import { hashSkillFileSet } from '#shared/utils/skills/analyse'
import { parseSkillMarkdown } from '#shared/utils/skills/frontmatter'
import type { SkillFrontmatter } from '#shared/utils/skills/frontmatter'
import { classifySkillLicense } from '#shared/utils/skills/license'
import type { SkillLicenseResult } from '#shared/utils/skills/license'
import { SKILL_MD_FILE_NAME } from '#shared/utils/skills/path'
import { isSkillLicenseRootFile } from '#shared/utils/skills/edit'
import type { SkillLicenseClass } from '#shared/utils/skills-policy'
import * as schema from '~~/server/db/schema'
import { createSkillEditError } from '~~/server/utils/skills/versions/errors'
import { readBlobText } from '~~/server/utils/skills/versions/read'
import type {
  SkillReadBucket,
  SkillRow,
} from '~~/server/utils/skills/versions/read'
import type { WorkingSkillFile } from '~~/server/utils/skills/versions/apply'

type DbClient = ReturnType<typeof useDb>

export interface PreparedSkillVersion {
  frontmatter: SkillFrontmatter
  license: SkillLicenseResult
  licenseClass: SkillLicenseClass
  sha256: string
  totalBytes: number
  renamed: boolean
  warnings: string[]
}

async function readEntryText(input: {
  bucket: SkillReadBucket
  userId: number
  skillId: string
  file: WorkingSkillFile
  heldTexts: Map<string, string>
}): Promise<string> {
  return input.heldTexts.get(input.file.blobSha256) ?? await readBlobText({
    bucket: input.bucket,
    userId: input.userId,
    skillId: input.skillId,
    blobSha256: input.file.blobSha256,
  })
}

/**
 * Everything the next version of an existing skill has to satisfy, read from
 * the new file set: `SKILL.md` must parse, a changed name must be free, and the
 * license classifier runs again over the license files, so a restricted
 * license file blocks the version. Only `SKILL.md` and the root license
 * files are read; contents the caller already holds are not read again.
 * The class stays `authored` for a skill the user wrote: the classifier can
 * only block it, and only on a restricted license file, never relabel it.
 */
export async function prepareSkillVersion(input: {
  db: DbClient
  bucket: SkillReadBucket
  userId: number
  skill: SkillRow
  files: WorkingSkillFile[]
  heldTexts: Map<string, string>
}): Promise<PreparedSkillVersion> {
  const { db, bucket, userId, skill, files, heldTexts } = input
  const skillMdFile = files.find((file) => {
    return file.path === SKILL_MD_FILE_NAME
  })!
  const skillMdText = await readEntryText({
    bucket,
    userId,
    skillId: skill.id,
    file: skillMdFile,
    heldTexts,
  })
  const parsed = parseSkillMarkdown(skillMdText)

  if (!parsed.ok) {
    throw createSkillEditError('frontmatter-invalid', {
      message: 'SKILL.md needs a valid name and description',
      why: parsed.message,
      fix: 'Fix the frontmatter at the top of SKILL.md',
    })
  }

  const { frontmatter } = parsed
  const renamed = frontmatter.name !== skill.name

  if (renamed) {
    const [taken] = await db.select({ id: schema.skills.id })
      .from(schema.skills)
      .where(and(
        eq(schema.skills.userId, userId),
        eq(schema.skills.name, frontmatter.name),
        ne(schema.skills.id, skill.id),
      ))
      .limit(1)

    if (taken) {
      throw createSkillEditError('name-taken', {
        message: `A skill named ${frontmatter.name} exists`,
        why: 'Skill names are unique per account',
        fix: 'Pick another name',
      })
    }
  }

  const licenseFiles: Array<{ path: string, text: string }> = []

  for (const file of files) {
    if (isSkillLicenseRootFile(file.path)) {
      licenseFiles.push({
        path: file.path,
        text: await readEntryText({
          bucket,
          userId,
          skillId: skill.id,
          file,
          heldTexts,
        }),
      })
    }
  }

  const license = await classifySkillLicense({
    files: licenseFiles,
    licenseField: frontmatter.license,
  })

  const blocksSave = license.class === 'restricted'
    && (skill.licenseClass !== 'authored' || license.licenseFile !== null)

  if (blocksSave) {
    throw createSkillEditError('license-restricted', {
      message: 'This skill cannot be saved',
      why: license.text,
      fix: 'Remove the license file or replace it with one that allows copying',
    })
  }

  return {
    frontmatter,
    license,
    licenseClass: skill.licenseClass === 'authored'
      ? 'authored'
      : license.class,
    sha256: await hashSkillFileSet(files.map((file) => {
      return { path: file.path, sha256: file.blobSha256 }
    })),
    totalBytes: files.reduce((total, file) => {
      return total + file.bytes
    }, 0),
    renamed,
    warnings: [...parsed.warnings, ...license.warnings],
  }
}
