import { readZipDirectory } from '@besidka/doc-renderer/zip'
import type { ZipEntry, ZipLimits } from '@besidka/doc-renderer/zip'
import {
  SKILL_GITHUB_MAX_ARCHIVE_ENTRIES,
  SKILL_GITHUB_PICK_MAX,
  SKILL_MAX_FILES,
  SKILL_MAX_GITHUB_ARCHIVE_BYTES,
  SKILL_MAX_PATH_DEPTH,
} from '#shared/utils/skills-policy'
import {
  SKILL_DIRECTORY_ERROR_CODES,
  SKILL_PATH_REJECTION_MESSAGES,
  archiveFailure,
  inflateSelectedSkillEntries,
  readZipEntryAttributes,
  sortSkillArchiveFiles,
} from '#shared/utils/skills/archive'
import type {
  SkillArchiveFile,
  SkillArchiveResult,
} from '#shared/utils/skills/archive'
import { isValidGithubSegment } from '#shared/utils/skills/github-url'
import { hasHiddenCharacter } from '#shared/utils/skills/hidden-characters'
import {
  SKILL_MD_FILE_NAME,
  checkSkillRelativePath,
  normaliseSkillEntryName,
} from '#shared/utils/skills/path'

const UNIX_FILE_TYPE_MASK = 0xF000
const UNIX_SYMLINK = 0xA000
const UNIX_REGULAR_FILE = 0x8000
const UNIX_DIRECTORY = 0x4000
const ROOT_LICENCE_FILES_MAX = 8
const PICK_COLLECT_MARGIN = SKILL_GITHUB_PICK_MAX
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F-\u009F\u2028\u2029]/
const ROOT_LICENCE_NAME_PATTERN
  = /^(?:licen[sc]e|copying|notice)(?:\.(?:md|txt))?$/i
const UNBOUNDED = Number.MAX_SAFE_INTEGER
const SKILL_MD_SUFFIX = `/${SKILL_MD_FILE_NAME}`

const GITHUB_DIRECTORY_SCAN_LIMITS_WITHOUT_ENTRY_CAPS: ZipLimits = {
  entriesMax: SKILL_GITHUB_MAX_ARCHIVE_ENTRIES,
  entryBytesMax: UNBOUNDED,
  totalBytesMax: UNBOUNDED,
  ratioMax: UNBOUNDED,
  ratioMinBytes: UNBOUNDED,
}

export interface GithubArchiveScope {
  path: string | null
}

export type GithubArchiveResult
  = | {
    ok: true
    kind: 'skill'
    files: SkillArchiveFile[]
    licenceFiles: SkillArchiveFile[]
    folderName: string | null
    skillPath: string | null
    totalBytes: number
  }
  | {
    ok: true
    kind: 'pick'
    candidates: string[]
    total: number
  }
  | Extract<SkillArchiveResult, { ok: false }>

interface ScopedEntry {
  entry: ZipEntry
  repoName: string
  fileType: number
}

function fileTypeOf(externalAttributes: number): number {
  return (externalAttributes >>> 16) & UNIX_FILE_TYPE_MASK
}

function isRegularOrUntyped(fileType: number): boolean {
  return fileType === 0
    || fileType === UNIX_REGULAR_FILE
    || fileType === UNIX_DIRECTORY
}

function isPickablePath(directory: string): boolean {
  return !hasHiddenCharacter(directory)
    && directory.split('/').every(isValidGithubSegment)
}

function hasCandidateAncestor(directory: string, all: Set<string>): boolean {
  const segments = directory.split('/')

  for (let length = 1; length < segments.length; length++) {
    if (all.has(segments.slice(0, length).join('/'))) {
      return true
    }
  }

  return false
}

/**
 * One pass over the names and one over the candidates, with the nesting test
 * a lookup in a set (a path is at most six levels deep), so a repository with
 * thousands of entries costs linear time. Every non-nested skill folder is
 * counted, but only a bounded number is kept for the list.
 */
function findSkillDirectories(paths: string[]): {
  directories: string[]
  total: number
} {
  const all = new Set<string>()

  for (const path of paths) {
    if (!path.endsWith(SKILL_MD_SUFFIX)) {
      continue
    }

    const directory = path.slice(0, -SKILL_MD_SUFFIX.length)

    if (
      directory.split('/').length <= SKILL_MAX_PATH_DEPTH
      && isPickablePath(directory)
    ) {
      all.add(directory)
    }
  }

  const kept: string[] = []
  let total = 0

  for (const directory of all) {
    if (hasCandidateAncestor(directory, all)) {
      continue
    }

    total++

    if (kept.length < SKILL_GITHUB_PICK_MAX + PICK_COLLECT_MARGIN) {
      kept.push(directory)
    }
  }

  return { directories: kept.sort(), total }
}

function displayPath(path: string): string {
  return hasHiddenCharacter(path) || CONTROL_CHARACTER_PATTERN.test(path)
    ? '(a path with hidden or control characters)'
    : path
}

/**
 * Reads the zip `codeload.github.com` serves for one commit. Only entries
 * under the requested folder are inflated, plus the repository-root licence
 * files for licence classification. The directory scan still validates every
 * entry name in the repository (unsafe names, case-only duplicates and an
 * entry count over the cap), so a hostile entry elsewhere fails the import
 * closed rather than being skipped. Inside the skill folder the same rules as
 * an upload apply (docs/skills.md section 3.2).
 *
 * With no folder, or a folder that holds no `SKILL.md` of its own, the result
 * is the single skill found below it, or a pick list when there are several.
 */
export function extractGithubSkillArchive(
  bytes: Uint8Array,
  scope: GithubArchiveScope,
): GithubArchiveResult {
  if (bytes.byteLength > SKILL_MAX_GITHUB_ARCHIVE_BYTES) {
    return archiveFailure(
      'archive-too-large',
      `The repository archive is larger than ${
        SKILL_MAX_GITHUB_ARCHIVE_BYTES / 1024 / 1024
      } MiB`,
    )
  }

  const directory = readZipDirectory(
    bytes,
    GITHUB_DIRECTORY_SCAN_LIMITS_WITHOUT_ENTRY_CAPS,
  )

  if (!directory.ok) {
    return archiveFailure(
      SKILL_DIRECTORY_ERROR_CODES[directory.code] ?? 'archive-invalid',
      directory.detail,
    )
  }

  const attributes = readZipEntryAttributes(bytes)
  const { entries } = directory.directory

  if (!attributes || attributes.length !== entries.length) {
    return archiveFailure('archive-invalid', 'The central directory is malformed')
  }

  const scopePrefix = scope.path === null ? '' : `${scope.path}/`
  const inScope: ScopedEntry[] = []
  const rootLicences: ScopedEntry[] = []
  let topFolder: string | null = null

  for (const [index, entry] of entries.entries()) {
    const slashIndex = entry.name.indexOf('/')
    const top = entry.name.slice(0, slashIndex)

    if (slashIndex <= 0 || (topFolder !== null && top !== topFolder)) {
      return archiveFailure(
        'archive-invalid',
        'The repository archive has an unexpected layout',
      )
    }

    topFolder = top

    const repoName = entry.name.slice(slashIndex + 1).normalize('NFC')

    if (repoName === '' || repoName.endsWith('/')) {
      continue
    }

    const item: ScopedEntry = {
      entry,
      repoName,
      fileType: fileTypeOf(attributes[index]!.externalAttributes),
    }

    if (!repoName.includes('/') && ROOT_LICENCE_NAME_PATTERN.test(repoName)) {
      rootLicences.push(item)
    }

    if (repoName.startsWith(scopePrefix)) {
      inScope.push(item)
    }
  }

  if (scope.path !== null && inScope.length === 0) {
    return archiveFailure(
      'archive-missing-skill-md',
      'The folder was not found in the repository',
    )
  }

  const scopeSkillMd = scope.path === null
    ? SKILL_MD_FILE_NAME
    : `${scope.path}${SKILL_MD_SUFFIX}`
  const inScopeNames = inScope.map((item) => {
    return item.repoName
  })
  let skillDirectory: string

  if (inScopeNames.includes(scopeSkillMd)) {
    skillDirectory = scope.path ?? ''
  } else {
    const found = findSkillDirectories(inScopeNames)
    const candidates = found.directories

    if (found.total === 0) {
      return archiveFailure(
        'archive-missing-skill-md',
        'No SKILL.md found in the repository or the folder',
      )
    }

    if (found.total > 1) {
      return {
        ok: true,
        kind: 'pick',
        candidates: candidates.slice(0, SKILL_GITHUB_PICK_MAX),
        total: found.total,
      }
    }

    skillDirectory = candidates[0]!
  }

  const skillPrefix = skillDirectory === '' ? '' : `${skillDirectory}/`
  const selected: Array<{ entry: ZipEntry, path: string }> = []

  for (const item of inScope) {
    if (!item.repoName.startsWith(skillPrefix)) {
      continue
    }

    if (item.fileType === UNIX_SYMLINK) {
      return archiveFailure(
        'archive-symlink',
        'Symbolic links are not allowed',
        displayPath(item.repoName),
      )
    }

    if (!isRegularOrUntyped(item.fileType)) {
      return archiveFailure(
        'archive-special-file',
        'Only regular files are allowed',
        displayPath(item.repoName),
      )
    }

    const normalised = normaliseSkillEntryName(item.repoName)

    if (normalised.status === 'reject') {
      return archiveFailure(
        'archive-path-rejected',
        SKILL_PATH_REJECTION_MESSAGES[normalised.reason],
        displayPath(item.repoName),
      )
    }

    if (normalised.status === 'skip') {
      continue
    }

    if (!normalised.path.startsWith(skillPrefix)) {
      return archiveFailure(
        'archive-path-rejected',
        SKILL_PATH_REJECTION_MESSAGES.traversal,
        displayPath(item.repoName),
      )
    }

    const relativePath = normalised.path.slice(skillPrefix.length)
    const rejection = checkSkillRelativePath(relativePath)

    if (rejection) {
      return archiveFailure(
        'archive-path-rejected',
        SKILL_PATH_REJECTION_MESSAGES[rejection],
        displayPath(relativePath),
      )
    }

    selected.push({ entry: item.entry, path: relativePath })
  }

  if (selected.length > SKILL_MAX_FILES) {
    return archiveFailure(
      'archive-too-many-files',
      `The skill has more than ${SKILL_MAX_FILES} files`,
    )
  }

  const uniquePaths = new Set(selected.map((item) => {
    return item.path.toLowerCase()
  }))

  if (uniquePaths.size !== selected.length) {
    return archiveFailure(
      'archive-invalid',
      'Two entries resolve to the same path',
    )
  }

  const inflated = inflateSelectedSkillEntries(bytes, selected)

  if (!inflated.ok) {
    return inflated.failure
  }

  const files = inflated.files
  const licenceFiles: SkillArchiveFile[] = []

  if (skillDirectory !== '') {
    const licenceSelection = rootLicences
      .filter((item) => {
        return item.fileType !== UNIX_SYMLINK
          && isRegularOrUntyped(item.fileType)
      })
      .filter((item) => {
        const normalised = normaliseSkillEntryName(item.repoName)

        return normalised.status === 'ok'
          && normalised.path === item.repoName
          && checkSkillRelativePath(item.repoName) === null
      })
      .slice(0, ROOT_LICENCE_FILES_MAX)
      .map((item) => {
        return { entry: item.entry, path: item.repoName }
      })
    const inflatedLicences = inflateSelectedSkillEntries(
      bytes,
      licenceSelection,
    )

    if (!inflatedLicences.ok) {
      return inflatedLicences.failure
    }

    licenceFiles.push(...inflatedLicences.files)
  }

  sortSkillArchiveFiles(files)
  sortSkillArchiveFiles(licenceFiles)

  return {
    ok: true,
    kind: 'skill',
    files,
    licenceFiles,
    folderName: skillDirectory === ''
      ? null
      : skillDirectory.split('/').at(-1)!,
    skillPath: skillDirectory === '' ? null : skillDirectory,
    totalBytes: inflated.totalBytes,
  }
}
