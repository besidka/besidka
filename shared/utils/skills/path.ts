import {
  SKILL_MAX_PATH_DEPTH,
  SKILL_MAX_PATH_LENGTH,
} from '#shared/utils/skills-policy'
import type { SkillFileKind } from '#shared/utils/skills-policy'
import { hasHiddenCharacter } from '#shared/utils/skills/hidden-characters'

export const SKILL_MD_FILE_NAME = 'SKILL.md'

export const SKILL_ALLOWED_EXTENSIONS: ReadonlySet<string> = new Set([
  'md',
  'txt',
  'json',
  'yaml',
  'yml',
  'toml',
  'csv',
  'py',
  'js',
  'ts',
  'sh',
  'ps1',
  'rb',
  'go',
  'html',
  'css',
  'xml',
  'sql',
  'ini',
  'cfg',
  'tex',
])

export const SKILL_DENIED_EXTENSIONS: ReadonlySet<string> = new Set([
  'pyc',
  'so',
  'dll',
  'exe',
  'bin',
  'class',
  'jar',
  'wasm',
])

const SCRIPT_EXTENSIONS: ReadonlySet<string> = new Set([
  'py',
  'js',
  'ts',
  'sh',
  'ps1',
  'rb',
  'go',
])

const LICENCE_BASENAME_PATTERN
  = /^(?:licen[sc]e|copying|notice)(?:\.[A-Za-z0-9_-]{1,16})?$/i

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F-\u009F]/
const LINE_SEPARATOR_PATTERN = /[\u2028\u2029]/
const WINDOWS_DRIVE_PATTERN = /^[A-Za-z]:/

export type SkillPathRejection
  = | 'empty'
    | 'absolute'
    | 'traversal'
    | 'backslash'
    | 'control-character'
    | 'format-character'
    | 'unsafe-segment'
    | 'too-long'
    | 'too-deep'
    | 'extension-denied'
    | 'extension-not-allowed'

export type SkillEntryName
  = | { status: 'ok', path: string }
    | { status: 'skip', reason: 'directory' | 'macos-metadata' | 'ds-store' }
    | { status: 'reject', reason: SkillPathRejection }

/**
 * Windows drops a trailing dot or space and reads `name:stream` as an
 * alternate data stream, so such a segment can name a different file than
 * the one the checks saw.
 */
function isUnsafeSegment(segment: string): boolean {
  return segment.endsWith('.') || segment.endsWith(' ') || segment.includes(':')
}

export function getSkillBaseName(path: string): string {
  return path.split('/').at(-1) ?? ''
}

export function getSkillExtension(path: string): string {
  const baseName = getSkillBaseName(path)
  const separatorIndex = baseName.lastIndexOf('.')

  if (separatorIndex <= 0) {
    return ''
  }

  return baseName.slice(separatorIndex + 1).toLowerCase()
}

export function isSkillLicenceFileName(path: string): boolean {
  return LICENCE_BASENAME_PATTERN.test(getSkillBaseName(path))
}

/**
 * Applies the archive path rules to one entry name as stored in a zip:
 * rejects what can escape the skill folder or spoof a file name, skips
 * directories and macOS noise, and returns the NFC-normalised path.
 */
export function normaliseSkillEntryName(rawName: string): SkillEntryName {
  if (rawName.length === 0) {
    return { status: 'reject', reason: 'empty' }
  }

  if (rawName.includes('\\')) {
    return { status: 'reject', reason: 'backslash' }
  }

  if (CONTROL_CHARACTER_PATTERN.test(rawName)) {
    return { status: 'reject', reason: 'control-character' }
  }

  if (hasHiddenCharacter(rawName) || LINE_SEPARATOR_PATTERN.test(rawName)) {
    return { status: 'reject', reason: 'format-character' }
  }

  if (rawName.startsWith('/') || WINDOWS_DRIVE_PATTERN.test(rawName)) {
    return { status: 'reject', reason: 'absolute' }
  }

  const isDirectory = rawName.endsWith('/')
  const segments = rawName
    .normalize('NFC')
    .split('/')
    .filter((segment) => {
      return segment !== '' && segment !== '.'
    })

  if (segments.includes('..')) {
    return { status: 'reject', reason: 'traversal' }
  }

  if (segments.length === 0) {
    return { status: 'reject', reason: 'empty' }
  }

  if (segments.some(isUnsafeSegment)) {
    return { status: 'reject', reason: 'unsafe-segment' }
  }

  if (isDirectory) {
    return { status: 'skip', reason: 'directory' }
  }

  if (segments.includes('__MACOSX')) {
    return { status: 'skip', reason: 'macos-metadata' }
  }

  const baseName = segments.at(-1)!

  if (baseName === '.DS_Store') {
    return { status: 'skip', reason: 'ds-store' }
  }

  if (baseName.startsWith('._')) {
    return { status: 'skip', reason: 'macos-metadata' }
  }

  return { status: 'ok', path: segments.join('/') }
}

/**
 * Length, depth and extension rules, applied to the path relative to the
 * skill root, after the root is known.
 */
export function checkSkillRelativePath(
  relativePath: string,
): SkillPathRejection | null {
  if (relativePath.length > SKILL_MAX_PATH_LENGTH) {
    return 'too-long'
  }

  if (relativePath.split('/').length > SKILL_MAX_PATH_DEPTH) {
    return 'too-deep'
  }

  const extension = getSkillExtension(relativePath)

  if (SKILL_DENIED_EXTENSIONS.has(extension)) {
    return 'extension-denied'
  }

  if (
    SKILL_ALLOWED_EXTENSIONS.has(extension)
    || isSkillLicenceFileName(relativePath)
  ) {
    return null
  }

  return 'extension-not-allowed'
}

export type SkillRootResult
  = | { ok: true, root: string, folderName: string | null }
    | { ok: false, code: 'missing-skill-md' | 'ambiguous-root' }

/**
 * `SKILL.md` at the archive root wins; otherwise exactly one top-level
 * folder must hold it. The returned root is '' or 'folder/'.
 */
export function detectSkillRoot(paths: string[]): SkillRootResult {
  if (paths.includes(SKILL_MD_FILE_NAME)) {
    return { ok: true, root: '', folderName: null }
  }

  const candidates = new Set<string>()

  for (const path of paths) {
    const segments = path.split('/')

    if (segments.length === 2 && segments[1] === SKILL_MD_FILE_NAME) {
      candidates.add(segments[0]!)
    }
  }

  if (candidates.size === 0) {
    return { ok: false, code: 'missing-skill-md' }
  }

  if (candidates.size > 1) {
    return { ok: false, code: 'ambiguous-root' }
  }

  const [folderName] = [...candidates]

  return { ok: true, root: `${folderName}/`, folderName: folderName! }
}

export function getSkillFileKind(relativePath: string): SkillFileKind {
  if (relativePath === SKILL_MD_FILE_NAME) {
    return 'skill-md'
  }

  const segments = relativePath.split('/')

  if (segments.length === 1 && isSkillLicenceFileName(relativePath)) {
    return 'licence'
  }

  const firstSegment = segments[0]

  if (segments.length > 1) {
    if (firstSegment === 'scripts') {
      return 'script'
    }

    if (firstSegment === 'references') {
      return 'reference'
    }

    if (firstSegment === 'assets') {
      return 'asset'
    }
  }

  if (SCRIPT_EXTENSIONS.has(getSkillExtension(relativePath))) {
    return 'script'
  }

  return 'other'
}
