import { describe, expect, it } from 'vitest'
import { MEMORY_LIMITS } from '#shared/utils/memory-policy'
import { estimateMemoryTokens } from '#shared/utils/memory-tokens'
import { estimateMemoryIndexTokens } from '#shared/utils/memory-index-estimate'
import type { MemoryIndexEstimateEntry } from '#shared/utils/memory-index-estimate'

function entry(
  overrides: Partial<MemoryIndexEstimateEntry> = {},
): MemoryIndexEstimateEntry {
  return {
    projectId: null,
    category: 'areas',
    slug: 'likes-tea',
    title: 'Likes tea',
    description: 'Drinks green tea daily',
    body: 'Full body text that is not injected for areas.',
    sensitivity: 'none',
    ...overrides,
  }
}

describe('estimateMemoryIndexTokens', () => {
  it('returns 0 without entries', () => {
    expect(estimateMemoryIndexTokens([])).toBe(0)
  })

  it('renders a regular entry as a handle, title and description line', () => {
    const expected = estimateMemoryTokens(
      '- areas/likes-tea | Likes tea — Drinks green tea daily',
    )

    expect(estimateMemoryIndexTokens([entry()])).toBe(expected)
  })

  it('omits the dash when the description is empty', () => {
    const expected = estimateMemoryTokens('- areas/likes-tea | Likes tea')

    expect(estimateMemoryIndexTokens([entry({ description: '' })]))
      .toBe(expected)
  })

  it('injects profile and preferences bodies in full', () => {
    const body = 'I am a nurse who lives in Lviv and prefers short answers.'
    const expected = estimateMemoryTokens(body)

    expect(estimateMemoryIndexTokens([
      entry({ category: 'profile', slug: 'about', body }),
    ])).toBe(expected)
    expect(estimateMemoryIndexTokens([
      entry({ category: 'preferences', slug: 'style', body }),
    ])).toBe(expected)
  })

  it('renders a profile entry with an empty body as a line', () => {
    const expected = estimateMemoryTokens(
      '- profile/about | Likes tea — Drinks green tea daily',
    )

    expect(estimateMemoryIndexTokens([
      entry({ category: 'profile', slug: 'about', body: '   ' }),
    ])).toBe(expected)
  })

  it('collapses whitespace inside titles and descriptions', () => {
    const spaced = entry({
      title: 'Likes\n  tea',
      description: 'Drinks   green\ttea daily',
    })

    expect(estimateMemoryIndexTokens([spaced]))
      .toBe(estimateMemoryIndexTokens([entry()]))
  })

  it('skips project entries and legacy special entries', () => {
    expect(estimateMemoryIndexTokens([
      entry({ projectId: 'project-1' }),
      entry({ sensitivity: 'special' }),
    ])).toBe(0)
  })

  it('counts only the injected entries among a mixed list', () => {
    expect(estimateMemoryIndexTokens([
      entry(),
      entry({ projectId: 'project-1', slug: 'other' }),
    ])).toBe(estimateMemoryIndexTokens([entry()]))
  })

  it('grows with every added entry', () => {
    const one = estimateMemoryIndexTokens([entry()])
    const two = estimateMemoryIndexTokens([
      entry(),
      entry({ slug: 'likes-coffee', title: 'Likes coffee' }),
    ])

    expect(two).toBeGreaterThan(one)
  })

  it('caps the estimate at the server index budget', () => {
    const entries = Array.from({ length: 400 }, (_value, index) => {
      return entry({
        slug: `entry-${index}`,
        title: `Entry number ${index}`,
        description: 'A long description that keeps going and going on. '
          .repeat(4),
      })
    })

    expect(estimateMemoryIndexTokens(entries))
      .toBe(MEMORY_LIMITS.indexTokenBudget)
  })
})
