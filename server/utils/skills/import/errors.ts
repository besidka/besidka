import { createError } from 'evlog'
import type { SkillAnalysisErrorCode } from '#shared/utils/skills/analyse'
import type { SkillArchiveErrorCode } from '#shared/utils/skills/archive'

export type SkillImportErrorCode
  = | SkillArchiveErrorCode
    | SkillAnalysisErrorCode
    | 'invalid-request'
    | 'stage-not-found'
    | 'acknowledgement-required'
    | 'licence-acknowledgement-required'
    | 'skills-limit'
    | 'skills-storage-limit'
    | 'name-taken'
    | 'pending-changed'
    | 'pending-not-found'
    | 'skill-not-found'
    | 'files-missing'

const ARCHIVE_FIXES: Partial<Record<SkillImportErrorCode, string>> = {
  'archive-too-large': 'Upload an archive under 5 MiB',
  'archive-symlink': 'Remove symbolic links and zip the skill folder again',
  'archive-path-rejected': 'Rename or remove the file and zip the skill again',
  'archive-missing-skill-md':
    'Put SKILL.md at the root of the archive, or in one top-level folder',
  'archive-not-utf8': 'Remove binary files; skills hold text only',
  'archive-binary-content': 'Remove binary files; skills hold text only',
}

const STATUS_BY_CODE: Partial<Record<SkillImportErrorCode, number>> = {
  'archive-too-large': 413,
  'archive-total-too-large': 413,
  'archive-entry-too-large': 413,
  'archive-skill-md-too-large': 413,
  'skill-md-too-large': 413,
  'licence-restricted': 422,
}

export function createSkillImportError(
  code: SkillImportErrorCode,
  message: string,
  path?: string,
) {
  return createError({
    message: 'This skill cannot be imported',
    status: STATUS_BY_CODE[code] ?? 400,
    code,
    why: path ? `${message}: ${path}` : message,
    fix: ARCHIVE_FIXES[code] ?? 'Check the skill and try again',
  })
}
