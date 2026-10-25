import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  memoryCategories,
  memoryOrigins,
  memorySensitiveCategories,
} from '#shared/utils/memory-policy'
import {
  formatMemoryUpdatedAge,
  getMemoryEntryOriginLabel,
  memoryCategoryLabels,
  memoryCategoryOrder,
  memoryOriginLabels,
  memorySensitiveCategoryLabels,
} from '~/utils/memory-entry-labels'

describe('memory entry labels', () => {
  it('keeps the category order identical to the policy list', () => {
    expect([...memoryCategoryOrder]).toEqual([...memoryCategories])
  })

  it('labels every category', () => {
    for (const category of memoryCategories) {
      expect(memoryCategoryLabels[category]).toBeTruthy()
    }

    expect(Object.keys(memoryCategoryLabels).sort())
      .toEqual([...memoryCategories].sort())
  })

  it('labels every origin', () => {
    for (const origin of memoryOrigins) {
      expect(memoryOriginLabels[origin]).toBeTruthy()
      expect(getMemoryEntryOriginLabel(origin))
        .toBe(memoryOriginLabels[origin])
    }

    expect(Object.keys(memoryOriginLabels).sort())
      .toEqual([...memoryOrigins].sort())
  })

  it('uses the agreed origin wording', () => {
    expect(memoryOriginLabels).toEqual({
      user: 'You',
      extraction: 'Extracted from chats',
      tool: 'Saved in chat',
      import: 'Imported',
    })
  })

  it('labels every sensitive category in lower case', () => {
    for (const category of memorySensitiveCategories) {
      const label = memorySensitiveCategoryLabels[category]

      expect(label).toBeTruthy()
      expect(label).toBe(label.toLowerCase())
    }

    expect(Object.keys(memorySensitiveCategoryLabels).sort())
      .toEqual([...memorySensitiveCategories].sort())
  })

  describe('formatMemoryUpdatedAge', () => {
    const NOW = new Date('2026-10-25T12:00:00.000Z')
    const MINUTE_IN_MS = 60 * 1000
    const HOUR_IN_MS = 60 * MINUTE_IN_MS
    const DAY_IN_MS = 24 * HOUR_IN_MS

    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(NOW)
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it.each([
      [30 * 1000, 'just now'],
      [MINUTE_IN_MS, '1 minute ago'],
      [5 * MINUTE_IN_MS, '5 minutes ago'],
      [2 * HOUR_IN_MS, '2 hours ago'],
      [DAY_IN_MS, '1 day ago'],
      [3 * DAY_IN_MS, '3 days ago'],
    ])('formats an age of %s ms as "%s"', (ageInMs, expected) => {
      const updatedAt = new Date(NOW.getTime() - ageInMs)

      expect(formatMemoryUpdatedAge(updatedAt)).toBe(expected)
    })

    it('never includes the activity prefix', () => {
      expect(formatMemoryUpdatedAge(NOW)).not.toContain('Last activity')
    })
  })
})
