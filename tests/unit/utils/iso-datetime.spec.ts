import { describe, expect, it } from 'vitest'
import { toIsoDateTimeWithOffset } from '#shared/utils/iso-datetime'

describe('toIsoDateTimeWithOffset', () => {
  it('turns a date-only value into midnight UTC with an offset', () => {
    expect(toIsoDateTimeWithOffset('2026-10-20'))
      .toBe('2026-10-20T00:00:00+00:00')
  })

  it.each([
    '2026-10-20T00:00:00+00:00',
    '2026-10-20T09:30:00+02:00',
    '2026-10-20T09:30:00-05:30',
    '2026-10-20T09:30:00Z',
    '2026-10-20T09:30:00.123Z',
  ])('passes %s through unchanged', (value) => {
    expect(toIsoDateTimeWithOffset(value)).toBe(value)
  })

  it.each([
    '',
    'soon',
    '20/10/2026',
    '2026-10-20T09:30:00',
    '2026-10-20T09:30+02:00',
    '2026-10-20 09:30:00+02:00',
    '2026-10-20T24:00:00Z',
    '2026-10-20T09:60:00Z',
    '2026-10-20T09:30:00+25:00',
    '2026-13-01',
    '2026-02-30',
    '2026-02-30T09:30:00Z',
    '2026-10-20T09:30:00Zjunk',
    ' 2026-10-20',
  ])('returns null for %j', (value) => {
    expect(toIsoDateTimeWithOffset(value)).toBeNull()
  })

  it('accepts a leap day only in a leap year', () => {
    expect(toIsoDateTimeWithOffset('2028-02-29'))
      .toBe('2028-02-29T00:00:00+00:00')
    expect(toIsoDateTimeWithOffset('2027-02-29')).toBeNull()
  })
})
