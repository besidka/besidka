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

export type SkillSourceKind = typeof SKILL_SOURCE_KINDS[number]
export type SkillLicenseClass = typeof SKILL_LICENSE_CLASSES[number]
export type SkillStatus = typeof SKILL_STATUSES[number]
export type SkillCreatedVia = typeof SKILL_CREATED_VIA[number]
export type SkillVersionOrigin = typeof SKILL_VERSION_ORIGINS[number]
export type SkillFileKind = typeof SKILL_FILE_KINDS[number]

export const SKILL_VERSIONS_KEPT = 20
export const SKILLS_MAX_USER_BYTES = 50 * MEBIBYTE
export const SKILL_SAVES_PER_HOUR = 120
export const SKILL_SAVE_MAX_CHANGES = 50
export const SKILL_SAVE_MAX_BYTES = 2 * MEBIBYTE
export const SKILL_EDIT_MAX_FILE_BYTES = 256 * KIBIBYTE
export const SKILL_ARGUMENT_HINT_MAX = 100
export const SKILL_INVOCATIONS_PER_MESSAGE = 1
export const SKILL_GITHUB_PICK_MAX = 10
export const SKILL_ACTIVATE_MAX_TOKENS = 6000
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
