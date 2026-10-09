import { describe, expect, it } from 'vitest'
import {
  deriveConsentDecision,
  isConsentCategoryGranted,
  parseConsentCookieValue,
} from '../../../server/utils/consents'

const categories = [
  { id: 'necessary', required: true },
  { id: 'preferences' },
  { id: 'analytics' },
]

describe('deriveConsentDecision', () => {
  it('returns all when every optional category is granted', () => {
    const result = deriveConsentDecision(
      ['necessary', 'preferences', 'analytics'],
      categories,
    )

    expect(result).toBe('all')
  })

  it('returns none when no optional category is granted', () => {
    const result = deriveConsentDecision(['necessary'], categories)

    expect(result).toBe('none')
  })

  it('returns partial when some optional categories are granted', () => {
    const result = deriveConsentDecision(
      ['necessary', 'preferences'],
      categories,
    )

    expect(result).toBe('partial')
  })

  it('returns all when there are no optional categories', () => {
    const result = deriveConsentDecision(
      ['necessary'],
      [{ id: 'necessary', required: true }],
    )

    expect(result).toBe('all')
  })
})

describe('parseConsentCookieValue', () => {
  it('returns null for absent value', () => {
    expect(parseConsentCookieValue(null)).toBeNull()
    expect(parseConsentCookieValue(undefined)).toBeNull()
    expect(parseConsentCookieValue('')).toBeNull()
  })

  it('returns null for invalid JSON', () => {
    expect(parseConsentCookieValue('not-json')).toBeNull()
  })

  it('returns null when required fields are missing', () => {
    expect(parseConsentCookieValue(JSON.stringify({ v: 1 }))).toBeNull()
    expect(
      parseConsentCookieValue(JSON.stringify({ granted: [] })),
    ).toBeNull()
  })

  it('parses a valid consent cookie', () => {
    const raw = JSON.stringify({
      v: 1,
      granted: ['necessary', 'preferences'],
      id: 'abc-123',
      date: '2026-06-10T00:00:00.000Z',
    })

    const result = parseConsentCookieValue(raw)

    expect(result).toEqual({
      v: 1,
      granted: ['necessary', 'preferences'],
      id: 'abc-123',
      date: '2026-06-10T00:00:00.000Z',
    })
  })

  it('returns parsed cookie without optional fields when absent', () => {
    const raw = JSON.stringify({ v: 1, granted: ['necessary'] })
    const result = parseConsentCookieValue(raw)

    expect(result).toEqual({ v: 1, granted: ['necessary'] })
    expect(result?.id).toBeUndefined()
    expect(result?.date).toBeUndefined()
  })
})

describe('isConsentCategoryGranted', () => {
  const raw = JSON.stringify({ v: 2, granted: ['necessary', 'preferences'] })

  it('is true when the category is granted at the current revision', () => {
    expect(isConsentCategoryGranted(raw, 'preferences', 2)).toBe(true)
  })

  it('is false when the category is not granted', () => {
    expect(isConsentCategoryGranted(raw, 'analytics', 2)).toBe(false)
  })

  it('is false when the revision differs', () => {
    expect(isConsentCategoryGranted(raw, 'preferences', 3)).toBe(false)
  })

  it('is false for a missing or malformed cookie', () => {
    expect(isConsentCategoryGranted(undefined, 'preferences', 2)).toBe(false)
    expect(isConsentCategoryGranted(null, 'preferences', 2)).toBe(false)
    expect(isConsentCategoryGranted('{nope', 'preferences', 2)).toBe(false)
  })
})
