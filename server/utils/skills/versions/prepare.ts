import { and, eq, ne } from 'drizzle-orm'
import { hashSkillFileSet } from '#shared/utils/skills/analyse'
import { parseSkillMarkdown } from '#shared/utils/skills/frontmatter'
import type { SkillFrontmatter } from '#shared/utils/skills/frontmatter'
import { classifySkillLicence } from '#shared/utils/skills/licence'
import type { SkillLicenceResult } from '#shared/utils/skills/licence'
import { SKILL_MD_FILE_NAME } from '#shared/utils/skills/path'
import { isSkillLicenceRootFile } from '#shared/utils/skills/edit'
import { isReservedSkillSlashName } from '#shared/utils/skills-policy'
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
  licence: SkillLicenceResult
  licenseClass: SkillLicenseClass
  sha256: string
  totalBytes: number
  renamed: boolean
  slashCommand?: boolean
  warnings: string[]
}

/**
 * A rename keeps `slashCommand` in step with the name instead of failing:
 * a reserved new name turns it off, and leaving a reserved name turns it on
 * again for a skill that is enabled.
 */
function resolveRenamedSlashCommand(
  skill: Pick<SkillRow, 'name' | 'enabled' | 'slashCommand'>,
  newName: string,
): boolean | undefined {
  const isNewNameReserved = isReservedSkillSlashName(newName)

  if (skill.slashCommand && isNewNameReserved) {
    return false
  }

  if (
    skill.enabled
    && !skill.slashCommand
    && !isNewNameReserved
    && isReservedSkillSlashName(skill.name)
  ) {
    return true
  }

  return undefined
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
 * the new file set: `SKILL.md` must parse, a changed name must be free (a
 * reserved slash name only switches `slashCommand` off), and the
 * licence classifier runs again over the licence files, so a restricted
 * licence file blocks the version. Only `SKILL.md` and the root licence
 * files are read; contents the caller already holds are not read again.
 * The class stays `authored` for a skill the user wrote: the classifier can
 * only block it, and only on a restricted licence file, never relabel it.
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
        why: 'Skill names are unique, because they are the names of /commands too',
        fix: 'Pick another name',
      })
    }
  }

  const licenceFiles: Array<{ path: string, text: string }> = []

  for (const file of files) {
    if (isSkillLicenceRootFile(file.path)) {
      licenceFiles.push({
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

  const licence = await classifySkillLicence({
    files: licenceFiles,
    licenseField: frontmatter.license,
  })

  const blocksSave = licence.class === 'restricted'
    && (skill.licenseClass !== 'authored' || licence.licenceFile !== null)

  if (blocksSave) {
    throw createSkillEditError('licence-restricted', {
      message: 'This skill cannot be saved',
      why: licence.text,
      fix: 'Remove the licence file or replace it with one that allows copying',
    })
  }

  return {
    frontmatter,
    licence,
    licenseClass: skill.licenseClass === 'authored'
      ? 'authored'
      : licence.class,
    sha256: await hashSkillFileSet(files.map((file) => {
      return { path: file.path, sha256: file.blobSha256 }
    })),
    totalBytes: files.reduce((total, file) => {
      return total + file.bytes
    }, 0),
    renamed,
    ...(renamed
      ? { slashCommand: resolveRenamedSlashCommand(skill, frontmatter.name) }
      : {}),
    warnings: [...parsed.warnings, ...licence.warnings],
  }
}
