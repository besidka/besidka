import { describe, expect, it } from 'vitest'
import {
  LINEAR_CONTENT_LIMIT,
  MAX_DOCUMENT_CHARACTERS,
  documentIds,
  partTitle,
  planDocumentParts,
  splitAtHeadings,
  splitMarkdown,
  storeDocumentIds,
  topHeadingLevel,
} from '../../../scripts/linear-docs-split.mjs'

function section(heading: string, size: number) {
  return `${heading}\n\n${'x'.repeat(size)}`
}

describe('limits', () => {
  it('keeps the per-document budget below the Linear content limit', () => {
    expect(MAX_DOCUMENT_CHARACTERS).toBeLessThan(LINEAR_CONTENT_LIMIT)
  })
})

describe('topHeadingLevel', () => {
  it('returns the shallowest heading level below the title', () => {
    expect(topHeadingLevel('intro\n### Deep\n## Top\n#### Deeper')).toBe(2)
    expect(topHeadingLevel('intro\n### Only third')).toBe(3)
  })

  it('ignores headings inside fenced code and returns null without any', () => {
    expect(topHeadingLevel('```md\n## Not a heading\n```\ntext')).toBeNull()
    expect(topHeadingLevel('~~~\n## Not a heading\n~~~\n### Real')).toBe(3)
  })
})

describe('splitAtHeadings', () => {
  it('starts a block at each heading of the level and keeps the preamble', () => {
    const markdown = 'preamble\n## One\na\n### Sub\nb\n## Two\nc'

    expect(splitAtHeadings(markdown, 2)).toEqual([
      'preamble',
      '## One\na\n### Sub\nb',
      '## Two\nc',
    ])
  })

  it('does not split at a heading inside a code fence', () => {
    const markdown = '## One\n```\n## inside\n```\n## Two'

    expect(splitAtHeadings(markdown, 2)).toEqual([
      '## One\n```\n## inside\n```',
      '## Two',
    ])
  })
})

describe('splitMarkdown', () => {
  it('returns a body under the limit as a single chunk', () => {
    const markdown = section('## One', 50)

    expect(splitMarkdown(markdown, 100)).toEqual([markdown])
  })

  it('packs whole top-level sections into chunks under the limit', () => {
    const markdown = [
      section('## One', 60),
      section('## Two', 60),
      section('## Three', 60),
    ].join('\n')
    const chunks = splitMarkdown(markdown, 100)

    expect(chunks).toHaveLength(3)
    expect(chunks.map(chunk => chunk.split('\n')[0])).toEqual([
      '## One',
      '## Two',
      '## Three',
    ])
    expect(chunks.join('\n')).toBe(markdown)
  })

  it('splits an oversized section at its deeper headings', () => {
    const markdown = [
      '## Big',
      section('### First', 60),
      section('### Second', 60),
      section('## Small', 10),
    ].join('\n')
    const chunks = splitMarkdown(markdown, 100)

    expect(chunks.every(chunk => chunk.length <= 100)).toBe(true)
    expect(chunks[1].startsWith('### Second')).toBe(true)
    expect(chunks.join('\n')).toBe(markdown)
  })

  it('falls back to line boundaries and hard cuts for long text', () => {
    const lines = Array.from({ length: 30 }, (_value, index) => {
      return `line ${index} ${'y'.repeat(20)}`
    })
    const markdown = ['## Wall', ...lines, 'z'.repeat(250)].join('\n')
    const chunks = splitMarkdown(markdown, 100)

    expect(chunks.length).toBeGreaterThan(5)
    expect(chunks.every(chunk => chunk.length <= 100)).toBe(true)
    expect(chunks.join('\n').replace(/\n/g, ''))
      .toBe(markdown.replace(/\n/g, ''))
  })

  it('keeps a code fence that contains headings in one chunk', () => {
    const fence = ['```md', '## not split', 'body', '```'].join('\n')
    const markdown = [section('## A', 70), fence, section('## B', 70)]
      .join('\n')
    const chunks = splitMarkdown(markdown, 100)

    expect(chunks.some(chunk => chunk.includes(fence))).toBe(true)
  })
})

describe('partTitle', () => {
  it('numbers parts only when there is more than one', () => {
    expect(partTitle('Connectors', 0, 1)).toBe('Connectors')
    expect(partTitle('Connectors', 1, 3)).toBe('Connectors (part 2 of 3)')
  })
})

describe('document map entries', () => {
  it('normalizes a single id, an array and a missing entry', () => {
    expect(documentIds('doc-1')).toEqual(['doc-1'])
    expect(documentIds(['doc-1', 'doc-2'])).toEqual(['doc-1', 'doc-2'])
    expect(documentIds(undefined)).toEqual([])
  })

  it('stores one id as a string and several as an array', () => {
    expect(storeDocumentIds(['doc-1'])).toBe('doc-1')
    expect(storeDocumentIds(['doc-1', 'doc-2'])).toEqual(['doc-1', 'doc-2'])
    expect(storeDocumentIds([])).toBeUndefined()
  })

  it('keeps the single document as part 1 when a doc starts to split', () => {
    expect(planDocumentParts('doc-1', 3)).toEqual({
      ids: ['doc-1', null, null],
      removed: [],
    })
  })

  it('reuses part ids in order and removes parts that no longer exist', () => {
    expect(planDocumentParts(['doc-1', 'doc-2', 'doc-3'], 2)).toEqual({
      ids: ['doc-1', 'doc-2'],
      removed: ['doc-3'],
    })
    expect(planDocumentParts(['doc-1', 'doc-2'], 1)).toEqual({
      ids: ['doc-1'],
      removed: ['doc-2'],
    })
  })

  it('creates every part for a new doc', () => {
    expect(planDocumentParts(undefined, 2)).toEqual({
      ids: [null, null],
      removed: [],
    })
  })

  it('does not mutate the stored entry', () => {
    const entry = ['doc-1', 'doc-2']

    planDocumentParts(entry, 1)

    expect(entry).toEqual(['doc-1', 'doc-2'])
  })
})
