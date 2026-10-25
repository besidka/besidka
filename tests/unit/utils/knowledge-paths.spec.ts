import { describe, expect, it } from 'vitest'
import { KNOWLEDGE_LIMITS } from '#shared/utils/project-knowledge-policy'
import {
  normalizeKnowledgeRelativePath,
  normalizeKnowledgeTitle,
} from '~/utils/knowledge-paths'

describe('normalizeKnowledgeRelativePath', () => {
  it('accepts plain nested paths unchanged', () => {
    expect(normalizeKnowledgeRelativePath('a.md')).toBe('a.md')
    expect(normalizeKnowledgeRelativePath('docs/guide/a b.md'))
      .toBe('docs/guide/a b.md')
    expect(normalizeKnowledgeRelativePath('.github/workflows/ci.yml'))
      .toBe('.github/workflows/ci.yml')
    expect(normalizeKnowledgeRelativePath('a..b/c...md')).toBe('a..b/c...md')
  })

  it('normalises to NFC', () => {
    expect(normalizeKnowledgeRelativePath('café/é.md'))
      .toBe('café/é.md')
  })

  it.each([
    ['empty string', ''],
    ['backslash', 'dir\\a.md'],
    ['leading slash', '/a.md'],
    ['dot segment', './a.md'],
    ['inner dot segment', 'a/./b.md'],
    ['parent segment', '../a.md'],
    ['inner parent segment', 'a/../b.md'],
    ['trailing parent segment', 'a/..'],
    ['empty segment', 'a//b.md'],
    ['trailing slash', 'a/b/'],
    ['only a slash', '/'],
    ['NUL', 'a\u0000b.md'],
    ['unit separator', 'a\u001Fb.md'],
    ['tab', 'a\tb.md'],
    ['newline', 'a\nb.md'],
    ['DEL', 'a\u007Fb.md'],
    ['C1 control', 'a\u0085b.md'],
    ['upper C1 control', 'a\u009Fb.md'],
    ['line separator', 'a b.md'],
    ['paragraph separator', 'a b.md'],
  ])('rejects %s', (_label, path) => {
    expect(normalizeKnowledgeRelativePath(path)).toBeNull()
  })

  it('enforces the length limit after normalisation', () => {
    const limit = KNOWLEDGE_LIMITS.maxRelativePathChars

    expect(normalizeKnowledgeRelativePath('a'.repeat(limit))).not.toBeNull()
    expect(normalizeKnowledgeRelativePath('a'.repeat(limit + 1))).toBeNull()
    expect(
      normalizeKnowledgeRelativePath('é'.repeat(limit)),
    ).toHaveLength(limit)
  })
})

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
