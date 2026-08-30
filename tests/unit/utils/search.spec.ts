import { describe, expect, it } from 'vitest'
import {
  MIN_SEARCH_LENGTH,
  SNIPPET_END,
  SNIPPET_START,
  splitSnippetSegments,
} from '#shared/utils/search'

describe('MIN_SEARCH_LENGTH', () => {
  it('is 2', () => {
    expect(MIN_SEARCH_LENGTH).toBe(2)
  })
})

describe('splitSnippetSegments', () => {
  it('returns a single plain segment for a snippet with no sentinels', () => {
    expect(splitSnippetSegments('plain leading text')).toEqual([
      { text: 'plain leading text', highlight: false },
    ])
  })

  it('splits a highlighted phrase in the middle of the snippet', () => {
    const snippet = `before ${SNIPPET_START}match${SNIPPET_END} after`

    expect(splitSnippetSegments(snippet)).toEqual([
      { text: 'before ', highlight: false },
      { text: 'match', highlight: true },
      { text: ' after', highlight: false },
    ])
  })

  it('handles a highlight at the very start of the snippet', () => {
    const snippet = `${SNIPPET_START}match${SNIPPET_END} after`

    expect(splitSnippetSegments(snippet)).toEqual([
      { text: 'match', highlight: true },
      { text: ' after', highlight: false },
    ])
  })

  it('handles multiple highlighted spans', () => {
    const snippet
      = `${SNIPPET_START}one${SNIPPET_END} and `
        + `${SNIPPET_START}two${SNIPPET_END}`

    expect(splitSnippetSegments(snippet)).toEqual([
      { text: 'one', highlight: true },
      { text: ' and ', highlight: false },
      { text: 'two', highlight: true },
    ])
  })

  it('treats an unterminated start sentinel as highlighted to the end', () => {
    const snippet = `before ${SNIPPET_START}unterminated`

    expect(splitSnippetSegments(snippet)).toEqual([
      { text: 'before ', highlight: false },
      { text: 'unterminated', highlight: true },
    ])
  })

  it('returns [] for an empty snippet', () => {
    expect(splitSnippetSegments('')).toEqual([])
  })

  it('never needs raw <mark> tags to convey a highlight', () => {
    const snippet = `${SNIPPET_START}<mark>literal</mark>${SNIPPET_END}`

    const segments = splitSnippetSegments(snippet)

    expect(segments).toEqual([
      { text: '<mark>literal</mark>', highlight: true },
    ])
  })
})
