import { describe, expect, it } from 'vitest'
import {
  memoryCategories,
  memoryOrigins,
  memorySensitiveCategories,
} from '#shared/utils/memory-policy'
import {
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
})
