import { describe, expect, it } from 'vitest'
import {
  extractLegalBody,
  hashLegalDocument,
} from '../../../scripts/legal-revision-hash.mjs'

const SOURCE = [
  '---',
  'title: "Terms"',
  'updatedAt: 2026-10-29',
  'summary: "A summary"',
  '---',
  '',
  '## Heading',
  '',
  'Body text.',
  '',
].join('\n')

describe('hashLegalDocument', () => {
  it('ignores the updatedAt date', () => {
    expect(hashLegalDocument(SOURCE.replace('2026-10-29', '2026-12-01')))
      .toBe(hashLegalDocument(SOURCE))
  })

  it('ignores the line-ending style', () => {
    expect(hashLegalDocument(SOURCE.replace(/\n/g, '\r\n')))
      .toBe(hashLegalDocument(SOURCE))
  })

  it('changes when the body changes', () => {
    expect(hashLegalDocument(SOURCE.replace('Body text.', 'Body text!')))
      .not.toBe(hashLegalDocument(SOURCE))
  })

  it('ignores the whole frontmatter', () => {
    expect(
      hashLegalDocument(
        SOURCE
          .replace('A summary', 'Another summary')
          .replace('title: "Terms"', 'title: "Other"'),
      ),
    ).toBe(hashLegalDocument(SOURCE))
  })

  it('hashes only the markdown body', () => {
    expect(extractLegalBody(SOURCE)).toBe('\n## Heading\n\nBody text.\n')
  })

  it('keeps a frontmatter-looking line in the body', () => {
    const body = `${SOURCE}\nupdatedAt: in the body\n`

    expect(extractLegalBody(body)).toContain('updatedAt: in the body')
  })
})
