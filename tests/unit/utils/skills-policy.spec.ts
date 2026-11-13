import { describe, expect, it } from 'vitest'
import {
  SKILL_ARGUMENT_HINT_MAX,
  SKILL_INVOCATIONS_PER_MESSAGE,
  SKILL_RESERVED_SLASH_NAMES,
  SKILL_VERSIONS_KEPT,
  SKILLS_MAX_USER_BYTES,
  isReservedSkillSlashName,
  isSkillNameValid,
  validateSkillSlashName,
} from '#shared/utils/skills-policy'

describe('skills policy constants', () => {
  it('keeps the values the plan fixes', () => {
    expect(SKILL_VERSIONS_KEPT).toBe(20)
    expect(SKILLS_MAX_USER_BYTES).toBe(50 * 1024 * 1024)
    expect(SKILL_ARGUMENT_HINT_MAX).toBe(100)
    expect(SKILL_INVOCATIONS_PER_MESSAGE).toBe(1)
  })

  it('reserves the seven built-in command names', () => {
    expect([...SKILL_RESERVED_SLASH_NAMES].sort()).toEqual([
      'help',
      'image',
      'memory',
      'model',
      'new',
      'project',
      'search',
    ])
  })
})

describe('isSkillNameValid', () => {
  it.each(['a', 'review-pr', 'x1-y2-z3', 'a'.repeat(64)])(
    'accepts %s',
    (name) => {
      expect(isSkillNameValid(name)).toBe(true)
    },
  )

  it.each([
    '',
    '-a',
    'a-',
    'a--b',
    'A',
    'a_b',
    'a b',
    'a/b',
    '../a',
    'a'.repeat(65),
  ])('rejects %j', (name) => {
    expect(isSkillNameValid(name)).toBe(false)
  })
})

describe('isReservedSkillSlashName', () => {
  it.each(SKILL_RESERVED_SLASH_NAMES)('flags %s', (name) => {
    expect(isReservedSkillSlashName(name)).toBe(true)
  })

  it('ignores case and surrounding spaces', () => {
    expect(isReservedSkillSlashName(' Memory ')).toBe(true)
  })

  it('does not flag a name that only contains a reserved one', () => {
    expect(isReservedSkillSlashName('memory-notes')).toBe(false)
    expect(isReservedSkillSlashName('new-feature')).toBe(false)
  })
})

describe('validateSkillSlashName', () => {
  it('accepts a free name', () => {
    expect(validateSkillSlashName('review-pr')).toEqual({ valid: true })
  })

  it('refuses a reserved name with the Besidka message', () => {
    expect(validateSkillSlashName('memory')).toEqual({
      valid: false,
      reason: 'reserved',
      message: '/memory is reserved by Besidka',
    })
  })

  it('refuses a name that is not a valid skill name', () => {
    expect(validateSkillSlashName('Not Valid')).toEqual(
      expect.objectContaining({ valid: false, reason: 'invalid-name' }),
    )
  })
})
