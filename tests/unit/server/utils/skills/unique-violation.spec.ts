import { describe, expect, it } from 'vitest'
import {
  findUniqueViolation,
  isUniqueViolation,
} from '~~/server/utils/skills/unique-violation'

describe('findUniqueViolation', () => {
  it('reads the constraint of a direct error', () => {
    const exception = new Error(
      'UNIQUE constraint failed: skills.user_id, skills.name',
    )

    expect(findUniqueViolation(exception))
      .toBe('UNIQUE constraint failed: skills.user_id, skills.name')
    expect(isUniqueViolation(exception)).toBe(true)
  })

  it('walks the cause chain and drops bound parameters', () => {
    const exception = new Error('Failed query', {
      cause: new Error(
        'D1_ERROR: UNIQUE constraint failed: skill_versions.skill_id, '
        + 'skill_versions.version\nparams: 1,2,secret-value',
      ),
    })

    expect(findUniqueViolation(exception)).toBe(
      'UNIQUE constraint failed: skill_versions.skill_id, '
      + 'skill_versions.version',
    )
  })

  it('returns null for other errors and non-errors', () => {
    expect(findUniqueViolation(new Error('no such table'))).toBeNull()
    expect(findUniqueViolation('UNIQUE constraint failed')).toBeNull()
    expect(isUniqueViolation(undefined)).toBe(false)
  })
})
