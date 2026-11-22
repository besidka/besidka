import type {
  SkillFinding,
  SkillFindingSeverity,
  SkillFindingType,
} from '#shared/utils/skills/findings'
import {
  KNOWN_SKILL_OWNERS,
  findLookalikeName,
  getKnownSkillNames,
  isOfficialSkillsSource,
  splitGithubSource,
} from '#shared/utils/skills/known-names'
import {
  SKILL_ALLOWED_EXTENSIONS,
  SKILL_MD_FILE_NAME,
  getSkillBaseName,
  getSkillExtension,
  isSkillLicenseFileName,
} from '#shared/utils/skills/path'

export interface SkillFileSetInput {
  files: Array<{ path: string, text: string }>
  name: string | null
  source: string | null
  otherSkillNames: readonly string[]
}

const SCRIPT_EXTENSIONS: ReadonlySet<string> = new Set([
  'sh',
  'py',
  'ps1',
  'js',
  'ts',
  'rb',
  'go',
])
const LINK_TARGET_PATTERN = /\]\(<?([^)\s>#]{1,200})/g
const CODE_PATH_PATTERN = /`([^`\s]{1,200})`/g
const FILE_EXTENSION_PATTERN = /[^/]\.([a-z][a-z0-9]{1,7})$/
const NOT_A_PATH_PATTERN = /^(?:[a-z][a-z0-9+.-]{1,20}:|[/~$<{#@])/i
const WILDCARD_PATTERN = /[*?{}$<>|]/
const NAME_LINE_PATTERN = /^name ?:/
const REFERENCE_EXTENSIONS: ReadonlySet<string> = new Set([
  ...SKILL_ALLOWED_EXTENSIONS,
  'docx',
  'xlsx',
  'pptx',
  'pdf',
  'zip',
  'exe',
  'bat',
  'cmd',
  'dll',
  'so',
  'bin',
  'jar',
])
const MAX_MISSING_REFERENCES = 20
const SNIPPET_MAX_CHARACTERS = 120

function create(input: {
  type: SkillFindingType
  rule: string
  severity: SkillFindingSeverity
  path: string
  line: number
  snippet: string
  detail: string | null
}): SkillFinding {
  return {
    ...input,
    snippet: input.snippet.slice(0, SNIPPET_MAX_CHARACTERS),
    source: 'rules',
  }
}

function findLine(text: string, needle: string): number {
  const index = text.split('\n').findIndex((line) => {
    return line.includes(needle)
  })

  return index === -1 ? 1 : index + 1
}

function getAncestorFolders(path: string): string[] {
  const segments = path.split('/').slice(0, -1)

  return segments.map((_, index) => {
    return segments.slice(0, index + 1).join('/')
  })
}

function escapeForPattern(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
}

function isFolderMentioned(
  folder: string,
  loweredSkillMd: string,
  cache: Map<string, boolean>,
): boolean {
  const known = cache.get(folder)

  if (known !== undefined) {
    return known
  }

  const isMentioned = new RegExp(
    `(?<![\\w./-])${escapeForPattern(folder)}/?(?![\\w./-])`,
  ).test(loweredSkillMd)

  cache.set(folder, isMentioned)

  return isMentioned
}

function isReferenced(
  path: string,
  loweredSkillMd: string,
  folderCache: Map<string, boolean>,
): boolean {
  const loweredPath = path.toLowerCase()

  return loweredSkillMd.includes(loweredPath)
    || getAncestorFolders(loweredPath).some((folder) => {
      return isFolderMentioned(folder, loweredSkillMd, folderCache)
    })
}

function normalizeReference(raw: string): string | null {
  const target = raw.replace(/^\.\//, '').replace(/[?#].*$/, '')

  if (
    target === ''
    || NOT_A_PATH_PATTERN.test(target)
    || WILDCARD_PATTERN.test(target)
    || target.includes('..')
    || !REFERENCE_EXTENSIONS.has(
      FILE_EXTENSION_PATTERN.exec(target)?.[1] ?? '',
    )
  ) {
    return null
  }

  return target
}

function collectReferences(skillMd: string): string[] {
  const references = new Set<string>()

  for (const pattern of [LINK_TARGET_PATTERN, CODE_PATH_PATTERN]) {
    for (const match of skillMd.matchAll(pattern)) {
      const target = normalizeReference(match[1]!)

      if (target) {
        references.add(target)
      }
    }
  }

  return [...references]
}

function scanFilePaths(
  files: SkillFileSetInput['files'],
  skillMd: string,
): SkillFinding[] {
  const findings: SkillFinding[] = []
  const loweredSkillMd = skillMd.toLowerCase()
  const folderCache = new Map<string, boolean>()

  for (const file of files) {
    if (file.path === SKILL_MD_FILE_NAME) {
      continue
    }

    const extension = getSkillExtension(file.path)

    if (SCRIPT_EXTENSIONS.has(extension)) {
      findings.push(create({
        type: 'file',
        rule: 'script-file',
        severity: 'low',
        path: file.path,
        line: 1,
        snippet: file.path,
        detail: `.${extension} script`,
      }))
    }

    if (file.path.split('/').some((segment) => {
      return segment.startsWith('.')
    })) {
      findings.push(create({
        type: 'file',
        rule: 'dotfile-path',
        severity: 'low',
        path: file.path,
        line: 1,
        snippet: file.path,
        detail: 'hidden file or folder name',
      }))
    }

    if (
      !isSkillLicenseFileName(file.path)
      && !isReferenced(file.path, loweredSkillMd, folderCache)
    ) {
      findings.push(create({
        type: 'file',
        rule: 'unreferenced-file',
        severity: 'low',
        path: file.path,
        line: 1,
        snippet: file.path,
        detail: 'SKILL.md does not mention it',
      }))
    }
  }

  return findings
}

function scanMissingReferences(
  files: SkillFileSetInput['files'],
  skillMd: string,
): SkillFinding[] {
  const paths = new Set(files.map((file) => {
    return file.path
  }))
  const baseNames = new Set(files.map((file) => {
    return getSkillBaseName(file.path)
  }))

  return collectReferences(skillMd)
    .filter((reference) => {
      return !paths.has(reference)
        && !baseNames.has(getSkillBaseName(reference))
    })
    .slice(0, MAX_MISSING_REFERENCES)
    .map((reference) => {
      return create({
        type: 'file',
        rule: 'missing-reference',
        severity: 'low',
        path: SKILL_MD_FILE_NAME,
        line: findLine(skillMd, reference),
        snippet: reference,
        detail: 'not in the skill',
      })
    })
}

function scanLookalikes(
  input: SkillFileSetInput,
  skillMd: string,
): SkillFinding[] {
  const findings: SkillFinding[] = []

  if (input.name && !isOfficialSkillsSource(input.source)) {
    const wellKnown = findLookalikeName(input.name, getKnownSkillNames())
    const own = wellKnown
      ? null
      : findLookalikeName(input.name, input.otherSkillNames)
    const detail = wellKnown
      ? `close to the well-known skill "${wellKnown}"`
      : own
        ? `close to another skill of yours, "${own}"`
        : null

    if (detail) {
      const lines = skillMd.split('\n')
      const nameLine = lines.findIndex((line) => {
        return NAME_LINE_PATTERN.test(line)
      })

      findings.push(create({
        type: 'frontmatter',
        rule: 'name-lookalike',
        severity: 'low',
        path: SKILL_MD_FILE_NAME,
        line: nameLine === -1 ? 1 : nameLine + 1,
        snippet: nameLine === -1 ? input.name : lines[nameLine]!.trim(),
        detail,
      }))
    }
  }

  const github = splitGithubSource(input.source)
  const ownerLookalike = github
    ? findLookalikeName(github.owner, KNOWN_SKILL_OWNERS)
    : null

  if (github && ownerLookalike) {
    findings.push(create({
      type: 'frontmatter',
      rule: 'owner-lookalike',
      severity: 'low',
      path: SKILL_MD_FILE_NAME,
      line: 1,
      snippet: `${github.owner}/${github.repo}`,
      detail: `close to the well-known owner "${ownerLookalike}"`,
    }))
  }

  return findings
}

/**
 * Highlights that read the whole file set: scripts, hidden file names, files
 * that SKILL.md never mentions, files that SKILL.md mentions but the skill
 * does not hold, and a skill name or GitHub owner that is close to a
 * well-known one. All are for your information. The lookalike check needs the
 * source and the account's other skill names, which only the server knows.
 */
export function scanSkillFileSet(input: SkillFileSetInput): SkillFinding[] {
  const skillMd = input.files.find((file) => {
    return file.path === SKILL_MD_FILE_NAME
  })?.text ?? ''

  return [
    ...scanFilePaths(input.files, skillMd),
    ...scanMissingReferences(input.files, skillMd),
    ...scanLookalikes(input, skillMd),
  ]
}
