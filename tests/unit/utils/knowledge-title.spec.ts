import { describe, expect, it } from 'vitest'
import { KNOWLEDGE_LIMITS } from '#shared/utils/project-knowledge-policy'
import { normalizeKnowledgeTitle } from '~/utils/knowledge-title'

describe('normalizeKnowledgeTitle', () => {
  it('returns a clean title unchanged', () => {
    expect(normalizeKnowledgeTitle('Project plan')).toBe('Project plan')
  })

  it('normalises to NFC', () => {
    expect(normalizeKnowledgeTitle('café')).toBe('café')
  })

  it('turns control characters into spaces', () => {
    expect(normalizeKnowledgeTitle('a\u0000b\tc\nd\u007Fe\u0085f'))
      .toBe('a b c d e f')
    expect(normalizeKnowledgeTitle('a b c')).toBe('a b c')
  })

  it('trims and collapses whitespace', () => {
    expect(normalizeKnowledgeTitle('  a   b \t\t c  ')).toBe('a b c')
  })

  it('returns an empty string for blank titles', () => {
    expect(normalizeKnowledgeTitle('')).toBe('')
    expect(normalizeKnowledgeTitle(' \n\t ')).toBe('')
  })

  it('truncates to the title limit without trailing whitespace', () => {
    const limit = KNOWLEDGE_LIMITS.maxTitleChars
    const longTitle = `${'a'.repeat(limit - 1)} ${'b'.repeat(50)}`

    expect(normalizeKnowledgeTitle('n'.repeat(limit + 20))).toHaveLength(limit)
    expect(normalizeKnowledgeTitle(longTitle)).toBe('a'.repeat(limit - 1))
  })

  it('never leaves half of a surrogate pair at the cut', () => {
    const limit = KNOWLEDGE_LIMITS.maxTitleChars
    const title = `${'a'.repeat(limit - 1)}\u{1F600}`
    const result = normalizeKnowledgeTitle(title)

    expect(result).toBe('a'.repeat(limit - 1))
    expect(result.isWellFormed()).toBe(true)
  })
})
