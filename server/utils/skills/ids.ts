import { decodePublicId } from '~~/server/utils/custom-db-types'

const SKILL_PUBLIC_ID_PATTERN = /^[A-Za-z0-9]{1,64}$/

/**
 * A public id that does not decode would reach D1 as NaN, so routes check it
 * first and answer 404 like any other unknown skill.
 */
export function isDecodableSkillPublicId(skillId: string): boolean {
  if (!SKILL_PUBLIC_ID_PATTERN.test(skillId)) {
    return false
  }

  const decoded = decodePublicId(skillId)

  return Number.isSafeInteger(decoded) && decoded > 0
}
