import { SKILL_MD_FILE_NAME } from '#shared/utils/skills/path'
import { diffSkillSettings } from '#shared/utils/skills/update-changes'
import type { SkillChangedSetting } from '#shared/utils/skills/update-changes'
import { extractSkillHosts } from '#shared/utils/skills/url-hosts'
import type { SkillFinding } from '#shared/utils/skills/findings'
import { findNewFindings } from '~~/server/utils/skills/versions/new-findings'
import { readBlobText } from '~~/server/utils/skills/versions/read'
import type {
  ChangedFileTexts,
  SkillFileRow,
  SkillReadBucket,
} from '~~/server/utils/skills/versions/read'

export interface SkillVersionChanges {
  newFindings: SkillFinding[]
  newHosts: string[]
  changedSettings: SkillChangedSetting[]
  newScripts: string[]
  isPartial: boolean
}

type FileRef = Pick<SkillFileRow, 'path' | 'blobSha256' | 'kind'>

async function readUnchangedBeforeTexts(input: {
  bucket: SkillReadBucket
  userId: number
  skillId: string
  beforeFiles: FileRef[]
  afterFiles: FileRef[]
}): Promise<string[]> {
  const afterByPath = new Map(input.afterFiles.map((file) => {
    return [file.path, file.blobSha256]
  }))
  const texts: string[] = []

  for (const file of input.beforeFiles) {
    if (afterByPath.get(file.path) !== file.blobSha256) {
      continue
    }

    texts.push(await readBlobText({
      bucket: input.bucket,
      userId: input.userId,
      skillId: input.skillId,
      blobSha256: file.blobSha256,
    }))
  }

  return texts
}

/**
 * What a reviewer should look at when `after` replaces `before`: highlights
 * that are new in the changed files, hosts that no file of the earlier
 * version links to, changed frontmatter settings and new script files. Hosts
 * are compared against every file of the earlier version, so the unchanged
 * ones are read too. When the changed files were capped, `isPartial` says the
 * lists may miss some.
 */
export async function buildVersionChanges(input: {
  bucket: SkillReadBucket
  userId: number
  skillId: string
  beforeFiles: FileRef[]
  afterFiles: FileRef[]
  texts: ChangedFileTexts
}): Promise<SkillVersionChanges> {
  const { texts } = input
  const knownHosts = new Set<string>()
  const unchangedTexts = await readUnchangedBeforeTexts(input)

  for (const text of [...texts.before.values(), ...unchangedTexts]) {
    for (const host of extractSkillHosts(text)) {
      knownHosts.add(host)
    }
  }

  const newHosts = new Set<string>()

  for (const text of texts.after.values()) {
    for (const host of extractSkillHosts(text)) {
      if (!knownHosts.has(host)) {
        newHosts.add(host)
      }
    }
  }

  const beforePaths = new Set(input.beforeFiles.map((file) => {
    return file.path
  }))

  return {
    newFindings: await findNewFindings(texts.before, texts.after),
    newHosts: [...newHosts].sort(),
    changedSettings: diffSkillSettings(
      texts.before.get(SKILL_MD_FILE_NAME),
      texts.after.get(SKILL_MD_FILE_NAME)
      ?? texts.before.get(SKILL_MD_FILE_NAME),
    ),
    newScripts: input.afterFiles.filter((file) => {
      return file.kind === 'script' && !beforePaths.has(file.path)
    }).map((file) => {
      return file.path
    }),
    isPartial: texts.skipped.length > 0,
  }
}
