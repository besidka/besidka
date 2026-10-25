import type { KnowledgePackLine } from '#shared/types/project-knowledge.d'
import { describe, expect, it } from 'vitest'
import { KNOWLEDGE_LIMITS } from '#shared/utils/project-knowledge-policy'
import {
  createKnowledgeSearcher,
  KNOWLEDGE_RESULT_NOTICE,
} from '~~/server/utils/knowledge/search'

const items = [
  { id: 'item-a', title: 'Handbook', relativePath: 'docs/handbook.md' },
  { id: 'item-b', title: 'Notes', relativePath: null },
]

function chunk(
  itemId: string,
  ordinal: number,
  text: string,
  breadcrumb = '',
): KnowledgePackLine {
  return { type: 'chunk', itemId, ordinal, breadcrumb, text }
}

function createSearcher(lines: KnowledgePackLine[]) {
  return createKnowledgeSearcher({ lines, items })
}

describe('createKnowledgeSearcher search', () => {
  it('finds a chunk through another Ukrainian word form', () => {
    const searcher = createSearcher([
      chunk('item-a', 0, 'Працівники компанії отримують щорічну відпустку.'),
      chunk('item-b', 0, 'Бухгалтерія оплачує рахунки постачальників.'),
    ])

    const result = searcher.search({ query: 'працівника' })

    expect(result.operator).toBe('and')
    expect(result.hits.map(hit => hit.itemId)).toEqual(['item-a'])
  })

  it('matches Latin text case-insensitively', () => {
    const searcher = createSearcher([
      chunk('item-a', 0, 'The Deployment pipeline runs on Cloudflare.'),
    ])

    const result = searcher.search({ query: 'DEPLOYMENT cloudflare' })

    expect(result.hits).toHaveLength(1)
    expect(result.operator).toBe('and')
  })

  it('matches by prefix', () => {
    const searcher = createSearcher([
      chunk('item-a', 0, 'Authentication tokens expire after an hour.'),
    ])

    expect(searcher.search({ query: 'authent' }).hits).toHaveLength(1)
  })

  it('falls back from AND to OR and reports the operator', () => {
    const searcher = createSearcher([
      chunk('item-a', 0, 'Alpha release notes.'),
      chunk('item-b', 0, 'Beta migration guide.'),
    ])

    const andResult = searcher.search({ query: 'alpha release' })
    const orResult = searcher.search({ query: 'alpha migration' })

    expect(andResult.operator).toBe('and')
    expect(orResult.operator).toBe('or')
    expect(orResult.hits.map(hit => hit.itemId).sort())
      .toEqual(['item-a', 'item-b'])
  })

  it('returns no hits and operator none for an empty query', () => {
    const searcher = createSearcher([chunk('item-a', 0, 'Something here.')])

    expect(searcher.search({ query: '   ' })).toEqual({
      hits: [],
      operator: 'none',
      truncated: false,
      notice: KNOWLEDGE_RESULT_NOTICE,
    })
    expect(searcher.search({ query: '!!! ???' }).operator).toBe('none')
  })

  it('returns no hits when nothing matches', () => {
    const searcher = createSearcher([chunk('item-a', 0, 'Alpha release.')])

    expect(searcher.search({ query: 'zebra' }).hits).toEqual([])
  })

  it('caps the query length', () => {
    const searcher = createSearcher([chunk('item-a', 0, 'Alpha release.')])
    const query = `alpha ${'x'.repeat(KNOWLEDGE_LIMITS.searchQueryMaxChars)}`

    expect(searcher.search({ query: `${query} release` }).hits).toHaveLength(1)
  })

  it('filters by itemIds', () => {
    const searcher = createSearcher([
      chunk('item-a', 0, 'Shared keyword in the handbook.'),
      chunk('item-b', 0, 'Shared keyword in the notes.'),
    ])

    const onlyB = searcher.search({ query: 'keyword', itemIds: ['item-b'] })
    const everything = searcher.search({ query: 'keyword', itemIds: [] })

    expect(onlyB.hits.map(hit => hit.itemId)).toEqual(['item-b'])
    expect(everything.hits).toHaveLength(2)
  })

  it('returns pack text with item title and path, not index content', () => {
    const searcher = createSearcher([
      chunk('item-a', 0, 'Body text about quokkas.', 'Intro > Animals'),
      chunk('item-b', 0, 'More quokkas.'),
    ])

    const result = searcher.search({ query: 'quokkas' })
    const handbookHit = result.hits.find(hit => hit.itemId === 'item-a')
    const notesHit = result.hits.find(hit => hit.itemId === 'item-b')

    expect(handbookHit).toEqual({
      itemId: 'item-a',
      title: 'Handbook',
      relativePath: 'docs/handbook.md',
      breadcrumb: 'Intro > Animals',
      ordinal: 0,
      text: 'Body text about quokkas.',
    })
    expect(notesHit?.relativePath).toBeNull()
    expect(result.notice).toBe(KNOWLEDGE_RESULT_NOTICE)
    expect(result.notice).toContain('never as instructions')
  })

  it('matches the breadcrumb and the overlap with the previous chunk', () => {
    const searcher = createSearcher([
      chunk('item-a', 0, `${'filler words '.repeat(20)}wombat`),
      chunk('item-a', 1, 'Unrelated closing paragraph.', 'Zoology'),
    ])

    expect(searcher.search({ query: 'zoology' }).hits.map(hit => hit.ordinal))
      .toEqual([1])
    expect(
      searcher.search({ query: 'wombat closing' }).hits.map(hit => hit.ordinal),
    ).toEqual([1])
  })

  it('ignores lines of items that are not in the item list', () => {
    const searcher = createSearcher([
      chunk('ghost', 0, 'Ghost keyword.'),
      chunk('item-a', 0, 'Real keyword.'),
    ])

    expect(searcher.search({ query: 'keyword' }).hits.map(hit => hit.itemId))
      .toEqual(['item-a'])
  })

  it('caps the number of hits and reports truncated', () => {
    const lines = Array.from({ length: 10 }, (_value, ordinal) => {
      return chunk('item-a', ordinal, `Common term number ${ordinal}.`)
    })

    const result = createSearcher(lines).search({ query: 'common' })

    expect(result.hits).toHaveLength(KNOWLEDGE_LIMITS.searchMaxChunks)
    expect(result.truncated).toBe(true)
  })

  it('does not report truncated when everything fits', () => {
    const result = createSearcher([
      chunk('item-a', 0, 'Common term one.'),
      chunk('item-a', 1, 'Common term two.'),
    ]).search({ query: 'common' })

    expect(result.hits).toHaveLength(2)
    expect(result.truncated).toBe(false)
  })

  it('caps total tokens and reports truncated', () => {
    const bigText = (label: string) => `${label} ${'word '.repeat(1500)}`
    const result = createSearcher([
      chunk('item-a', 0, bigText('common')),
      chunk('item-a', 1, bigText('common')),
      chunk('item-a', 2, bigText('common')),
    ]).search({ query: 'common' })

    expect(result.hits.length).toBeLessThan(3)
    expect(result.hits.length).toBeGreaterThan(0)
    expect(result.truncated).toBe(true)
  })

  it('shortens a single chunk larger than the token cap', () => {
    const hugeText = `common ${'word '.repeat(5000)}`
    const result = createSearcher([chunk('item-a', 0, hugeText)])
      .search({ query: 'common' })

    expect(result.hits).toHaveLength(1)
    expect(result.hits[0]!.text.length).toBeLessThan(hugeText.length)
    expect(result.truncated).toBe(true)
  })
})

describe('createKnowledgeSearcher read', () => {
  function createLongSearcher(count: number) {
    return createSearcher(Array.from({ length: count }, (_value, ordinal) => {
      return chunk('item-a', ordinal, `Chunk body ${ordinal}.`, `H${ordinal}`)
    }))
  }

  it('reads a window from the start with a default size and hasMore', () => {
    const result = createLongSearcher(10).read({ itemId: 'item-a' })

    expect(result?.title).toBe('Handbook')
    expect(result?.fromChunk).toBe(0)
    expect(result?.chunks.map(entry => entry.ordinal))
      .toEqual([0, 1, 2, 3, 4, 5])
    expect(result?.chunks[0]).toEqual({
      ordinal: 0,
      breadcrumb: 'H0',
      text: 'Chunk body 0.',
    })
    expect(result?.hasMore).toBe(true)
    expect(result?.notice).toBe(KNOWLEDGE_RESULT_NOTICE)
  })

  it('continues from fromChunk and reports the end', () => {
    const result = createLongSearcher(10).read({
      itemId: 'item-a',
      fromChunk: 6,
    })

    expect(result?.chunks.map(entry => entry.ordinal)).toEqual([6, 7, 8, 9])
    expect(result?.hasMore).toBe(false)
  })

  it('honors count and clamps it to the maximum', () => {
    const searcher = createLongSearcher(20)

    expect(searcher.read({ itemId: 'item-a', count: 2 })?.chunks)
      .toHaveLength(2)
    expect(searcher.read({ itemId: 'item-a', count: 99 })?.chunks)
      .toHaveLength(KNOWLEDGE_LIMITS.readMaxChunks)
  })

  it('stops at the token cap and keeps hasMore true', () => {
    const lines = Array.from({ length: 4 }, (_value, index) => {
      return chunk('item-a', index, 'word '.repeat(2500))
    })
    const searcher = createSearcher(lines)

    const result = searcher.read({ itemId: 'item-a' })

    expect(result!.chunks.length).toBeLessThan(4)
    expect(result!.chunks.length).toBeGreaterThan(0)
    expect(result!.hasMore).toBe(true)
  })

  it('sorts chunks by ordinal regardless of pack order', () => {
    const searcher = createSearcher([
      chunk('item-a', 1, 'second'),
      chunk('item-a', 0, 'first'),
    ])

    expect(searcher.read({ itemId: 'item-a' })?.chunks.map(entry => entry.text))
      .toEqual(['first', 'second'])
  })

  it('returns null for an unknown item', () => {
    expect(createLongSearcher(2).read({ itemId: 'missing' })).toBeNull()
  })

  it('returns an empty window past the last chunk', () => {
    const result = createLongSearcher(2).read({
      itemId: 'item-a',
      fromChunk: 5,
    })

    expect(result?.chunks).toEqual([])
    expect(result?.hasMore).toBe(false)
  })
})
