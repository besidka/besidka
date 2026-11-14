import { createError } from 'evlog'

export type SkillEditErrorCode
  = | 'skill-not-found'
    | 'version-not-found'
    | 'file-not-found'
    | 'stale-base'
    | 'name-taken'
    | 'reserved-name'
    | 'invalid-request'
    | 'invalid-path'
    | 'path-missing'
    | 'path-exists'
    | 'skill-md-required'
    | 'licence-file-locked'
    | 'licence-restricted'
    | 'file-too-large'
    | 'save-too-large'
    | 'skill-too-large'
    | 'binary-content'
    | 'too-many-files'
    | 'frontmatter-invalid'
    | 'files-missing'
    | 'pending-version'
    | 'version-is-current'
    | 'skill-broken'

const STATUS_BY_CODE: Record<SkillEditErrorCode, number> = {
  'skill-not-found': 404,
  'version-not-found': 404,
  'file-not-found': 404,
  'stale-base': 409,
  'name-taken': 409,
  'reserved-name': 400,
  'invalid-request': 400,
  'invalid-path': 400,
  'path-missing': 400,
  'path-exists': 400,
  'skill-md-required': 400,
  'licence-file-locked': 403,
  'licence-restricted': 422,
  'file-too-large': 413,
  'save-too-large': 413,
  'skill-too-large': 413,
  'binary-content': 400,
  'too-many-files': 413,
  'frontmatter-invalid': 400,
  'files-missing': 409,
  'pending-version': 409,
  'version-is-current': 409,
  'skill-broken': 409,
}

interface SkillEditErrorDetails {
  message: string
  why: string
  fix: string
  data?: Record<string, unknown>
}

/**
 * The `why` and `data` of these errors name the kind of problem and a change
 * index, never a file name, a path or the note: those are skill content
 * (docs/skills.md section 8.7) and error text ends up in logs.
 */
export function createSkillEditError(
  code: SkillEditErrorCode,
  details: SkillEditErrorDetails,
) {
  return createError({
    message: details.message,
    status: STATUS_BY_CODE[code],
    code,
    why: details.why,
    fix: details.fix,
    data: details.data,
  })
}

export function createSkillNotFoundError() {
  return createSkillEditError('skill-not-found', {
    message: 'Skill not found',
    why: 'The skill does not exist or is not yours',
    fix: 'Reload the skills list',
  })
}

export function createStaleBaseError() {
  return createSkillEditError('stale-base', {
    message: 'This skill changed since you opened it',
    why: 'A newer version was saved after the one you started from',
    fix: 'Reload the skill and apply your changes again',
  })
}

export function createFilesMissingError() {
  return createSkillEditError('files-missing', {
    message: 'The files of this skill are missing',
    why: 'A stored file could not be read',
    fix: 'Restore an earlier version, or delete the skill',
  })
}
