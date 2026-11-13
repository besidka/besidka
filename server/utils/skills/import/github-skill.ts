import {
  SKILL_MAX_FILES,
  SKILL_MAX_GITHUB_ARCHIVE_BYTES,
  SKILL_MAX_TOTAL_BYTES,
} from '#shared/utils/skills-policy'
import { sortSkillArchiveFiles } from '#shared/utils/skills/archive'
import type { SkillArchiveFile } from '#shared/utils/skills/archive'
import { extractGithubSkillArchive } from '#shared/utils/skills/github-archive'
import { isSkillLicenceFileName } from '#shared/utils/skills/path'
import {
  createGithubTooLargeError,
  downloadGithubArchive,
} from '~~/server/utils/skills/import/github'
import type {
  GithubClient,
  GithubRepository,
} from '~~/server/utils/skills/import/github'
import { createSkillImportError } from '~~/server/utils/skills/import/errors'

const NOTICE_FILE_PATTERN = /^notice/i

export type GithubSkillLoad
  = | {
    kind: 'skill'
    files: SkillArchiveFile[]
    folderName: string | null
    skillPath: string | null
    warnings: string[]
  }
  | {
    kind: 'pick'
    candidates: string[]
    total: number
  }

function hasMainLicence(files: SkillArchiveFile[]): boolean {
  return files.some((file) => {
    return !file.path.includes('/')
      && isSkillLicenceFileName(file.path)
      && !NOTICE_FILE_PATTERN.test(file.path)
  })
}

/**
 * A skill folder without a licence of its own falls under the repository's
 * root licence. That file is appended to the skill's files, so it is hashed,
 * staged and stored like any other file and the licence gate reads the same
 * bytes the user will keep. A skill that has its own licence ignores the
 * root files.
 */
function withRepositoryLicence(
  files: SkillArchiveFile[],
  licenceFiles: SkillArchiveFile[],
): { files: SkillArchiveFile[], warnings: string[] } {
  if (licenceFiles.length === 0 || hasMainLicence(files)) {
    return { files, warnings: [] }
  }

  const taken = new Set(files.map((file) => {
    return file.path.toLowerCase()
  }))
  const added = licenceFiles.filter((file) => {
    return !taken.has(file.path.toLowerCase())
  })
  const totalBytes = [...files, ...added].reduce((total, file) => {
    return total + file.bytes.byteLength
  }, 0)

  if (
    added.length === 0
    || files.length + added.length > SKILL_MAX_FILES
    || totalBytes > SKILL_MAX_TOTAL_BYTES
  ) {
    return { files, warnings: [] }
  }

  const merged = [...files, ...added]

  sortSkillArchiveFiles(merged)

  return {
    files: merged,
    warnings: [
      `The skill has no licence file, so the licence of the repository root was used: ${
        added.map((file) => {
          return file.path
        }).join(', ')
      }`,
    ],
  }
}

/**
 * Downloads the archive of one commit and reads the skill at `path` out of
 * it, with the repository-root licence added when the skill has none. A
 * folder that holds several skills (or none at the top) answers with a pick
 * list instead.
 */
export async function loadGithubSkill(
  client: GithubClient,
  input: GithubRepository & { sha: string, path: string | null },
): Promise<GithubSkillLoad> {
  const bytes = await downloadGithubArchive(client, input)
  const result = extractGithubSkillArchive(bytes, { path: input.path })

  if (!result.ok) {
    if (result.code === 'archive-too-large') {
      throw createGithubTooLargeError(SKILL_MAX_GITHUB_ARCHIVE_BYTES)
    }

    throw createSkillImportError(result.code, result.message, result.path)
  }

  if (result.kind === 'pick') {
    return {
      kind: 'pick',
      candidates: result.candidates,
      total: result.total,
    }
  }

  const merged = withRepositoryLicence(result.files, result.licenceFiles)

  return {
    kind: 'skill',
    files: merged.files,
    folderName: result.folderName,
    skillPath: result.skillPath,
    warnings: merged.warnings,
  }
}
