import { describe, expect, it } from 'vitest'
import {
  searchFreshnessSchema,
  toBraveFreshnessCode,
  toExaStartPublishedDate,
} from '../../../../server/utils/search/freshness'

describe('searchFreshnessSchema', () => {
  it('is optional and accepts day, week, month and year', () => {
    expect(searchFreshnessSchema.safeParse(undefined).success).toBe(true)

    for (const freshness of ['day', 'week', 'month', 'year']) {
      expect(searchFreshnessSchema.safeParse(freshness).success).toBe(true)
    }
  })

  it('rejects any other value', () => {
    expect(searchFreshnessSchema.safeParse('hour').success).toBe(false)
    expect(searchFreshnessSchema.safeParse('').success).toBe(false)
  })
})

describe('toBraveFreshnessCode', () => {
  it('maps to Brave\'s pd, pw, pm and py codes', () => {
    expect(toBraveFreshnessCode('day')).toBe('pd')
    expect(toBraveFreshnessCode('week')).toBe('pw')
    expect(toBraveFreshnessCode('month')).toBe('pm')
    expect(toBraveFreshnessCode('year')).toBe('py')
  })
})

describe('toExaStartPublishedDate', () => {
  const now = new Date('2026-10-04T12:00:00.000Z')

  it('subtracts 1, 7, 31 and 365 days from now as an ISO string', () => {
    expect(toExaStartPublishedDate('day', now))
      .toBe('2026-10-03T12:00:00.000Z')
    expect(toExaStartPublishedDate('week', now))
      .toBe('2026-09-27T12:00:00.000Z')
    expect(toExaStartPublishedDate('month', now))
      .toBe('2026-09-03T12:00:00.000Z')
    expect(toExaStartPublishedDate('year', now))
      .toBe('2025-10-04T12:00:00.000Z')
  })
})
