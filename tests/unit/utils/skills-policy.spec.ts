import { describe, expect, it } from 'vitest'
import {
  SKILL_ARGUMENT_HINT_MAX,
  SKILL_IMPORTS_PER_HOUR,
  SKILL_MAX_FILES,
  SKILL_MAX_FILE_BYTES,
  SKILL_MAX_PATH_DEPTH,
  SKILL_MAX_PATH_LENGTH,
  SKILL_MAX_RATIO,
  SKILL_MAX_SKILL_MD_BYTES,
  SKILL_MAX_TOTAL_BYTES,
  SKILL_MAX_UPLOAD_BYTES,
  SKILL_STAGE_TTL,
  SKILLS_PER_USER,
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

  it('keeps the import limits of the design', () => {
    expect(SKILL_MAX_FILES).toBe(200)
    expect(SKILL_MAX_TOTAL_BYTES).toBe(5 * 1024 * 1024)
    expect(SKILL_MAX_FILE_BYTES).toBe(1024 * 1024)
    expect(SKILL_MAX_SKILL_MD_BYTES).toBe(256 * 1024)
    expect(SKILL_MAX_UPLOAD_BYTES).toBe(5 * 1024 * 1024)
    expect(SKILL_MAX_RATIO).toBe(100)
    expect(SKILL_MAX_PATH_LENGTH).toBe(200)
    expect(SKILL_MAX_PATH_DEPTH).toBe(6)
    expect(SKILLS_PER_USER).toBe(50)
    expect(SKILL_IMPORTS_PER_HOUR).toBe(10)
    expect(SKILL_STAGE_TTL).toBe(3600)
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
