import { describe, expect, it } from 'vitest'
import {
  formatLocalDate,
  toIsoDateTime,
} from '../../../app/utils/local-date'

const isoValue = '2026-08-01T09:30:15.000Z'

describe('utils/local-date', () => {
  describe('formatLocalDate', () => {
    it('formats a date-only string by default', () => {
      expect(formatLocalDate(isoValue)).toBe(
        new Date(isoValue).toLocaleDateString(),
      )
    })

    it('formats date and time when withTime is set', () => {
      expect(formatLocalDate(isoValue, true)).toBe(
        new Date(isoValue).toLocaleString(),
      )
    })

    it('accepts Date and epoch number inputs', () => {
      const date = new Date(isoValue)

      expect(formatLocalDate(date)).toBe(date.toLocaleDateString())
      expect(formatLocalDate(date.getTime(), true)).toBe(
        date.toLocaleString(),
      )
    })

    it('returns an empty string for an invalid value without throwing',
      () => {
        expect(formatLocalDate('not-a-date')).toBe('')
        expect(formatLocalDate('not-a-date', true)).toBe('')
        expect(formatLocalDate(Number.NaN)).toBe('')
      })
  })

  describe('toIsoDateTime', () => {
    it('returns a deterministic ISO string', () => {
      expect(toIsoDateTime(isoValue)).toBe(isoValue)
      expect(toIsoDateTime(new Date(isoValue))).toBe(isoValue)
      expect(toIsoDateTime(new Date(isoValue).getTime())).toBe(isoValue)
    })

    it('returns undefined for an invalid value without throwing', () => {
      expect(toIsoDateTime('not-a-date')).toBeUndefined()
    })
  })
})
