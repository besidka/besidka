import type { SkillSourceKind } from '#shared/utils/skills-policy'
import { SKILL_PATH_REJECTION_MESSAGES } from '#shared/utils/skills/archive'
import { isSkillLicenceEntry } from '#shared/utils/skills/licence'
import {
  checkSkillRelativePath,
  normaliseSkillEntryName,
} from '#shared/utils/skills/path'

export type SkillChange
  = | { op: 'put', path: string, content: string }
    | { op: 'delete', path: string }
    | { op: 'rename', from: string, to: string }

export type SkillSourceGroup = 'created' | 'imported' | 'apps'

const SOURCE_GROUPS: Record<SkillSourceKind, SkillSourceGroup> = {
  editor: 'created',
  template: 'created',
  zip: 'imported',
  text: 'imported',
  github: 'imported',
  url: 'imported',
  share: 'imported',
  mcp: 'apps',
}

export function getSkillSourceGroup(kind: SkillSourceKind): SkillSourceGroup {
  return SOURCE_GROUPS[kind]
}

/**
 * The same rules an imported entry gets, applied to a path typed in the
 * editor. A path must already be in its normalised form, so what the user
 * sees is exactly what is stored. Returns the reason, or null when the path
 * can be saved.
 */
export function validateSkillEditPath(path: string): string | null {
  const normalised = normaliseSkillEntryName(path)

  if (normalised.status === 'reject') {
    return SKILL_PATH_REJECTION_MESSAGES[normalised.reason]
  }

  if (normalised.status === 'skip' || normalised.path !== path) {
    return 'The path must name a file in its plain form, such as '
      + 'references/guide.md'
  }

  const rejection = checkSkillRelativePath(path)

  return rejection ? SKILL_PATH_REJECTION_MESSAGES[rejection] : null
}

/**
 * Licence and notice files at the skill root, the ones the classifier reads.
 * Apache-2.0 section 4 keeps them as they are in an open or custom skill.
 */
export function isSkillLicenceRootFile(path: string): boolean {
  return !path.includes('/') && isSkillLicenceEntry(path)
}
