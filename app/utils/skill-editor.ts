import { parseDocument } from 'yaml'
import {
  SKILL_EDIT_MAX_FILE_BYTES,
  SKILL_MAX_FILES,
  SKILL_MAX_TOTAL_BYTES,
  SKILL_NAME_MAX,
  SKILL_SAVE_MAX_BYTES,
  SKILL_SAVE_MAX_CHANGES,
  isReservedSkillSlashName,
  isSkillNameValid,
} from '#shared/utils/skills-policy'
import {
  isSkillLicenceRootFile,
  validateSkillEditPath,
} from '#shared/utils/skills/edit'
import type { SkillChange } from '#shared/utils/skills/edit'
import { SKILL_DESCRIPTION_MAX } from '#shared/utils/skills/frontmatter'
import type { SkillFrontmatterErrorCode } from '#shared/utils/skills/frontmatter'
import { HIDDEN_CHARACTER_PATTERN } from '#shared/utils/skills/hidden-characters'
import { SKILL_MD_FILE_NAME } from '#shared/utils/skills/path'

export type SkillEditorLoadState = 'idle' | 'loading' | 'ready' | 'error'

export type SkillEditorProblemScope
  = | 'name'
    | 'description'
    | 'advanced'
    | 'body'
    | 'file'

export type SkillEditorProblemFix = 'remove-hidden-characters'

export interface SkillEditorFile {
  key: string
  originalPath: string | null
  path: string
  bytes: number
  text: string | null
  originalText: string | null
  loadState: SkillEditorLoadState
  loadError: string
  isDeleted: boolean
  isLocked: boolean
  isTooLarge: boolean
}

export interface SkillEditorProblem {
  id: string
  severity: 'error' | 'warning'
  scope: SkillEditorProblemScope
  line: number | null
  message: string
  fix?: SkillEditorProblemFix
}

export const SKILL_EDITOR_VALIDATION_DEBOUNCE_MS = 300
export const SKILL_EDITOR_NEW_FILE_KEY_PREFIX = 'new:'

const MARKDOWN_EXTENSION_PATTERN = /\.(?:md|markdown)$/i
const textEncoder = new TextEncoder()

export function getSkillEditorByteLength(text: string): number {
  return textEncoder.encode(text).byteLength
}

export function isSkillEditorMarkdownPath(path: string): boolean {
  return MARKDOWN_EXTENSION_PATTERN.test(path)
}

export function removeSkillHiddenCharacters(text: string): string {
  return text.replace(HIDDEN_CHARACTER_PATTERN, '')
}

export function getSkillEditorFileBytes(file: SkillEditorFile): number {
  const isChanged = file.text !== null && file.text !== file.originalText

  return isChanged ? getSkillEditorByteLength(file.text!) : file.bytes
}

function getActiveFiles(files: SkillEditorFile[]): SkillEditorFile[] {
  return files.filter((file) => {
    return !file.isDeleted
  })
}

/**
 * Why a path typed in the file form cannot be used, or null. The rules are
 * the import rules (`validateSkillEditPath`) plus what only the working set
 * knows: names are compared without regard to case, a rename may not land on
 * the original path of another file (so the saved renames never depend on
 * their order), and the licence files of an open or custom skill stay as
 * they are.
 */
export function validateSkillEditorPath(
  path: string,
  input: {
    files: SkillEditorFile[]
    filesLocked: boolean
    editingKey?: string | null
  },
): string | null {
  const rejection = validateSkillEditPath(path)

  if (rejection) {
    return rejection
  }

  if (input.filesLocked && isSkillLicenceRootFile(path)) {
    return 'Licence files cannot be changed in this skill'
  }

  const lowerCased = path.toLowerCase()
  const others = getActiveFiles(input.files).filter((file) => {
    return file.key !== (input.editingKey ?? null)
  })
  const isTaken = others.some((file) => {
    return file.path.toLowerCase() === lowerCased
      || file.originalPath?.toLowerCase() === lowerCased
  })

  if (isTaken) {
    return 'A file with this name exists. Names ignore upper and lower case.'
  }

  if (!input.editingKey && others.length >= SKILL_MAX_FILES) {
    return `A skill can hold at most ${SKILL_MAX_FILES} files`
  }

  return null
}

/**
 * The name rules that need no list: the pattern, and the built-in command
 * names while "Use as /name" is on. Uniqueness is checked on blur against the
 * skills list.
 */
export function getSkillEditorNameError(
  name: string,
  options: { slashCommand: boolean },
): string {
  if (!name) {
    return 'Add a name'
  }

  if (!isSkillNameValid(name)) {
    return `Use lowercase letters, numbers and single hyphens, up to ${
      SKILL_NAME_MAX
    } characters`
  }

  if (options.slashCommand && isReservedSkillSlashName(name)) {
    return `/${name} is reserved by Besidka. Pick another name.`
  }

  return ''
}

export function isSkillEditorNameTaken(
  name: string,
  skillId: string,
  skills: Array<{ id: string, name: string }>,
): boolean {
  return skills.some((skill) => {
    return skill.id !== skillId && skill.name === name
  })
}

export function getSkillEditorDescriptionError(description: string): string {
  if (!description.trim()) {
    return 'Add a description. The model uses it to decide when to apply the skill.'
  }

  if (description.length > SKILL_DESCRIPTION_MAX) {
    return `The description is over ${SKILL_DESCRIPTION_MAX} characters`
  }

  return ''
}

/**
 * The saved changes in the order the server applies them: deletes, then
 * renames (their targets are free by `validateSkillEditorPath`, so any order
 * works), then the content of every file that is new or changed, at its final
 * path. A new file that was deleted again leaves no trace.
 */
export function buildSkillEditorChanges(
  files: SkillEditorFile[],
): SkillChange[] {
  const deletes: SkillChange[] = files
    .filter((file) => {
      return file.isDeleted && file.originalPath !== null
    })
    .map((file) => {
      return { op: 'delete', path: file.originalPath! }
    })
  const renames: SkillChange[] = getActiveFiles(files)
    .filter((file) => {
      return file.originalPath !== null && file.path !== file.originalPath
    })
    .map((file) => {
      return { op: 'rename', from: file.originalPath!, to: file.path }
    })
  const puts: SkillChange[] = getActiveFiles(files)
    .filter((file) => {
      return file.text !== null
        && (file.originalPath === null || file.text !== file.originalText)
    })
    .map((file) => {
      return { op: 'put', path: file.path, content: file.text! }
    })

  return [...deletes, ...renames, ...puts]
}

/**
 * The limits a save would hit, as plain messages, so Save stays off with the
 * reason on screen instead of failing on the server.
 */
export function getSkillEditorSaveBlockers(
  files: SkillEditorFile[],
  changes: SkillChange[],
): string[] {
  const blockers: string[] = []
  const active = getActiveFiles(files)

  if (changes.length > SKILL_SAVE_MAX_CHANGES) {
    blockers.push(
      `One save can carry at most ${SKILL_SAVE_MAX_CHANGES} changes. `
      + 'Save, then continue.',
    )
  }

  let putBytes = 0

  for (const change of changes) {
    if (change.op !== 'put') {
      continue
    }

    const bytes = getSkillEditorByteLength(change.content)

    putBytes += bytes

    if (bytes > SKILL_EDIT_MAX_FILE_BYTES) {
      blockers.push(
        `${change.path} is over ${SKILL_EDIT_MAX_FILE_BYTES / 1024} KiB. `
        + 'Split it into smaller files.',
      )
    }

    if (change.content.includes('\u0000')) {
      blockers.push(`${change.path} contains binary data`)
    }
  }

  if (putBytes > SKILL_SAVE_MAX_BYTES) {
    blockers.push(
      `One save can carry at most ${
        SKILL_SAVE_MAX_BYTES / 1024 / 1024
      } MiB of text. Save fewer files at a time.`,
    )
  }

  const totalBytes = active.reduce((total, file) => {
    return total + getSkillEditorFileBytes(file)
  }, 0)

  if (totalBytes > SKILL_MAX_TOTAL_BYTES) {
    blockers.push(
      `A skill can hold at most ${
        SKILL_MAX_TOTAL_BYTES / 1024 / 1024
      } MiB of files`,
    )
  }

  return [...new Set(blockers)]
}

export interface SkillEditorYamlIssue {
  line: number | null
  message: string
}

export function findAdvancedYamlIssue(
  advanced: string,
): SkillEditorYamlIssue | null {
  if (!advanced.trim()) {
    return null
  }

  const document = parseDocument(advanced, {
    prettyErrors: false,
    logLevel: 'silent',
  })
  const issue = document.errors[0]

  if (!issue) {
    return null
  }

  const offset = issue.pos[0]
  const line = advanced.slice(0, offset).split('\n').length

  return {
    line,
    message: issue.message.split('\n')[0] ?? 'This is not valid YAML',
  }
}

const FRONTMATTER_SCOPE: Record<
  SkillFrontmatterErrorCode,
  SkillEditorProblemScope
> = {
  'frontmatter-missing': 'file',
  'frontmatter-unterminated': 'file',
  'frontmatter-too-large': 'advanced',
  'frontmatter-invalid': 'advanced',
  'name-missing': 'name',
  'name-invalid': 'name',
  'description-missing': 'description',
}

export function getSkillFrontmatterProblemScope(
  code: SkillFrontmatterErrorCode,
): SkillEditorProblemScope {
  return FRONTMATTER_SCOPE[code]
}

/**
 * Every hidden character of a text, one problem per line, with the line the
 * user sees in the box (1-based). The quick fix removes them all from the
 * text the problem belongs to.
 */
export function findHiddenCharacterProblems(
  text: string,
  scope: SkillEditorProblemScope,
): SkillEditorProblem[] {
  const problems: SkillEditorProblem[] = []

  for (const [index, line] of text.split('\n').entries()) {
    const matches = line.match(HIDDEN_CHARACTER_PATTERN)

    if (!matches) {
      continue
    }

    problems.push({
      id: `hidden-${scope}-${index + 1}`,
      severity: 'warning',
      scope,
      line: index + 1,
      message: `${matches.length} hidden ${
        matches.length === 1 ? 'character' : 'characters'
      } that the model reads but you cannot see`,
      fix: 'remove-hidden-characters',
    })
  }

  return problems
}

export function isSkillMdPath(path: string): boolean {
  return path === SKILL_MD_FILE_NAME
}
