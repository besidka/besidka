import { describe, expect, it } from 'vitest'
import {
  getKnowledgeRelativePathIssue,
  isValidKnowledgeRelativePath,
  normalizeKnowledgeRelativePath,
  parseKnowledgeRelativePath,
} from '#shared/utils/project-knowledge-path'
import { KNOWLEDGE_LIMITS } from '#shared/utils/project-knowledge-policy'

describe('project knowledge relative path', () => {
  it.each([
    'file.pdf',
    'docs/guide/intro.pdf',
    'docs/..hidden/file.pdf',
    'docs/.hidden/file.md',
    'docs/file..name.md',
    'документи/звіт.pdf',
    'Привіт/файл.md',
    'проєкт/їжак і щука.txt',
    'docs/name with spaces.md',
  ])('accepts %s', (relativePath) => {
    expect(isValidKnowledgeRelativePath(relativePath)).toBe(true)
    expect(parseKnowledgeRelativePath(relativePath)).toBe(relativePath)
  })

  it.each([
    ['empty', ''],
    ['single dot', '.'],
    ['double dot', '..'],
    ['leading dot segment', './a.pdf'],
    ['inner dot segment', 'a/./b.pdf'],
    ['leading parent segment', '../secret.pdf'],
    ['inner parent segment', 'docs/../secret.pdf'],
    ['trailing parent segment', 'docs/..'],
    ['leading slash', '/etc/passwd'],
    ['trailing slash', 'a/b.pdf/'],
    ['empty segment', 'a//b.pdf'],
    ['only a slash', '/'],
    ['backslash', 'a\\b.pdf'],
    ['backslash parent segment', 'docs\\..\\secret.pdf'],
    ['newline', 'a\nb'],
    ['carriage return', 'a\rb'],
    ['NUL', 'docs/a\u0000b.pdf'],
    ['tab', 'docs/a\tb.pdf'],
    ['U+0085', 'docs/a\u0085b.pdf'],
    ['U+2028', 'docs/a\u2028b.pdf'],
    ['U+2029', 'docs/a\u2029b.pdf'],
  ])('rejects %s', (_label, relativePath) => {
    expect(isValidKnowledgeRelativePath(relativePath)).toBe(false)
    expect(parseKnowledgeRelativePath(relativePath)).toBeNull()
    expect(
      getKnowledgeRelativePathIssue(
        normalizeKnowledgeRelativePath(relativePath),
      ),
    ).toEqual(expect.any(String))
  })

  it('returns null from the issue check for a valid path', () => {
    expect(getKnowledgeRelativePathIssue('docs/guide.pdf')).toBeNull()
  })

  it.each([
    ['Latin e acute', 'docs/cafe\u0301.pdf', 'docs/caf\u00E9.pdf'],
    ['Cyrillic short i', '\u0438\u0306.md', '\u0439.md'],
    [
      'Ukrainian yi',
      'docs/\u0456\u0308\u0436\u0430\u043A.md',
      'docs/\u0457\u0436\u0430\u043A.md',
    ],
  ])('normalises %s from NFD to NFC', (_label, decomposed, composed) => {
    expect(decomposed).not.toBe(composed)
    expect(normalizeKnowledgeRelativePath(decomposed)).toBe(composed)
    expect(parseKnowledgeRelativePath(decomposed)).toBe(composed)
    expect(isValidKnowledgeRelativePath(decomposed)).toBe(true)
  })

  it('measures the length limit after normalisation', () => {
    const decomposedPath = 'e\u0301'.repeat(
      KNOWLEDGE_LIMITS.maxRelativePathChars,
    )

    expect(decomposedPath.length)
      .toBeGreaterThan(KNOWLEDGE_LIMITS.maxRelativePathChars)
    expect(parseKnowledgeRelativePath(decomposedPath))
      .toBe('\u00E9'.repeat(KNOWLEDGE_LIMITS.maxRelativePathChars))
  })

  it('enforces the length limit', () => {
    expect(isValidKnowledgeRelativePath(
      'a'.repeat(KNOWLEDGE_LIMITS.maxRelativePathChars),
    )).toBe(true)
    expect(isValidKnowledgeRelativePath(
      'a'.repeat(KNOWLEDGE_LIMITS.maxRelativePathChars + 1),
    )).toBe(false)
    expect(isValidKnowledgeRelativePath(
      'a'.repeat(KNOWLEDGE_LIMITS.maxRelativePathChars * 8),
    )).toBe(false)
  })
})
