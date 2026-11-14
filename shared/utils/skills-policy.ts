const KIBIBYTE = 1024
const MEBIBYTE = 1024 * KIBIBYTE

export const SKILL_SOURCE_KINDS = [
  'editor',
  'template',
  'zip',
  'text',
  'github',
  'url',
  'mcp',
  'share',
] as const

export const SKILL_LICENSE_CLASSES = [
  'open',
  'custom',
  'none',
  'restricted',
  'authored',
] as const

export const SKILL_STATUSES = ['ready', 'needs-review', 'broken'] as const

export const SKILL_CREATED_VIA = ['app', 'mcp', 'share'] as const

export const SKILL_VERSION_ORIGINS = [
  'import',
  'update',
  'editor',
  'template',
  'mcp',
  'rename',
  'restore',
  'share',
] as const

export const SKILL_FILE_KINDS = [
  'skill-md',
  'reference',
  'script',
  'asset',
  'licence',
  'other',
] as const

export const SKILL_AUTHORED_SOURCE_KINDS: readonly SkillSourceKind[] = [
  'editor',
  'template',
]

export type SkillSourceKind = typeof SKILL_SOURCE_KINDS[number]
export type SkillLicenseClass = typeof SKILL_LICENSE_CLASSES[number]
export type SkillStatus = typeof SKILL_STATUSES[number]
export type SkillCreatedVia = typeof SKILL_CREATED_VIA[number]
export type SkillVersionOrigin = typeof SKILL_VERSION_ORIGINS[number]
export type SkillFileKind = typeof SKILL_FILE_KINDS[number]

export const SKILL_MAX_FILES = 200
export const SKILL_MAX_ARCHIVE_ENTRIES = 1000
export const SKILL_MAX_TOTAL_BYTES = 5 * MEBIBYTE
export const SKILL_MAX_FILE_BYTES = MEBIBYTE
export const SKILL_MAX_SKILL_MD_BYTES = 256 * KIBIBYTE
export const SKILL_MAX_UPLOAD_BYTES = 5 * MEBIBYTE
export const SKILL_MAX_GITHUB_ARCHIVE_BYTES = 15 * MEBIBYTE
export const SKILL_GITHUB_MAX_ARCHIVE_ENTRIES = 20000
export const SKILL_GITHUB_REFS_MAX_BYTES = 8 * MEBIBYTE
export const SKILL_GITHUB_TIMEOUT_MS = 30 * 1000
export const SKILL_GITHUB_REQUEST_DEADLINE_MS = 60 * 1000
export const SKILL_GITHUB_REF_CACHE_SECONDS = 60
export const SKILL_DIFF_TOTAL_CELL_BUDGET = 8_000_000
export const SKILL_DIFF_MAX_LINES = 2000
export const SKILL_MAX_RATIO = 100
export const SKILL_RATIO_MIN_BYTES = KIBIBYTE
export const SKILL_MAX_PATH_LENGTH = 200
export const SKILL_MAX_PATH_DEPTH = 6
export const SKILL_MAX_FRONTMATTER_BYTES = 16 * KIBIBYTE
export const SKILLS_PER_USER = 50
export const SKILL_IMPORTS_PER_HOUR = 10
export const SKILL_STAGE_TTL = 60 * 60
export const SKILL_FINDING_LONG_LINE = 2000
export const SKILL_FINDING_BLANK_RUN = 50
export const SKILL_FINDINGS_MAX_PER_FILE = 200
export const SKILL_FINDINGS_MAX_TOTAL = 500
export const SKILL_VERSIONS_KEPT = 20
export const SKILLS_MAX_USER_BYTES = 50 * MEBIBYTE
export const SKILL_SAVES_PER_HOUR = 120
export const SKILL_SAVE_MAX_CHANGES = 50
export const SKILL_SAVE_MAX_BYTES = 2 * MEBIBYTE
export const SKILL_EDIT_MAX_FILE_BYTES = 256 * KIBIBYTE
export const SKILL_VIEWER_FILE_MAX_BYTES = MEBIBYTE
export const SKILL_SAVE_REQUEST_MAX_BYTES = 4 * MEBIBYTE
export const SKILL_NOTE_MAX = 200
export const SKILL_DIFF_MAX_FILES = 50
export const SKILL_ARGUMENT_HINT_MAX = 100
export const SKILL_INVOCATIONS_PER_MESSAGE = 1
export const SKILL_GITHUB_PICK_MAX = 10
export const SKILL_ACTIVATE_MAX_TOKENS = 6000
export const SKILL_ACTIVATE_MAX_BYTES = 40 * KIBIBYTE
export const SKILL_ARGUMENTS_MAX_BYTES = 8 * KIBIBYTE
export const SKILL_READ_FILE_MAX_BYTES = 64 * KIBIBYTE
export const SKILL_CATALOG_BUDGET_TOKENS = 1500
export const SKILL_ACTIVE_BLOCK_MAX_TOKENS = 12000
export const SKILL_TOOL_STEPS = 4
export const SKILL_DESCRIPTION_CATALOG_SOFT_MAX = 300
export const SKILL_NAME_MAX = 64
export const SKILL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/

export const SKILL_RESERVED_SLASH_NAMES = [
  'new',
  'model',
  'search',
  'image',
  'memory',
  'project',
  'help',
] as const

export type SkillSlashNameRejection = 'invalid-name' | 'reserved'

export type SkillSlashNameValidation
  = | { valid: true }
    | {
      valid: false
      reason: SkillSlashNameRejection
      message: string
    }

const reservedSlashNames: ReadonlySet<string> = new Set(
  SKILL_RESERVED_SLASH_NAMES,
)

/**
 * Only text the user wrote in the editor, or took from a Besidka template,
 * is trusted; every other source (and any kind added later) is third-party
 * text and keeps `memory_write` locked while it sits in the prompt.
 */
export function isAuthoredSkillSource(sourceKind: string): boolean {
  return (SKILL_AUTHORED_SOURCE_KINDS as readonly string[])
    .includes(sourceKind)
}

export function isSkillNameValid(name: string): boolean {
  return name.length > 0
    && name.length <= SKILL_NAME_MAX
    && SKILL_NAME_PATTERN.test(name)
}

export function isReservedSkillSlashName(name: string): boolean {
  return reservedSlashNames.has(name.trim().toLowerCase())
}

/**
 * A skill may carry a reserved name; only its "Use as /name" toggle is
 * refused, so the caller runs this when `slash_command` is switched on.
 */
export function validateSkillSlashName(
  name: string,
): SkillSlashNameValidation {
  if (!isSkillNameValid(name)) {
    return {
      valid: false,
      reason: 'invalid-name',
      message: 'Use lowercase letters, digits and single hyphens (max 64)',
    }
  }

  if (isReservedSkillSlashName(name)) {
    return {
      valid: false,
      reason: 'reserved',
      message: `/${name} is reserved by Besidka`,
    }
  }

  return { valid: true }
}
