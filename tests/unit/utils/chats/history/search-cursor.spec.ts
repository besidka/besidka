import { describe, expect, it } from 'vitest'
import { MAX_SEARCH_RESULTS } from '~~/server/utils/chats/history/search'
import {
  createSearchCursor,
  parseSearchCursor,
} from '~~/server/utils/chats/history/search-cursor'
import { createHistoryCursor } from '~~/server/utils/chats/history/cursor'

describe('createSearchCursor / parseSearchCursor', () => {
  it('round-trips an offset through create and parse', () => {
    const cursor = createSearchCursor(30)

    expect(parseSearchCursor(cursor)).toBe(30)
  })

  it('returns null for an undefined cursor', () => {
    expect(parseSearchCursor(undefined)).toBeNull()
  })

  it('returns null for a negative offset', () => {
    expect(parseSearchCursor('{"offset":-1}')).toBeNull()
  })

  it('returns null for an offset above MAX_SEARCH_RESULTS', () => {
    const outOfRange = MAX_SEARCH_RESULTS + 1

    expect(parseSearchCursor(`{"offset":${outOfRange}}`)).toBeNull()
  })

  it('accepts an offset exactly at MAX_SEARCH_RESULTS', () => {
    expect(parseSearchCursor(`{"offset":${MAX_SEARCH_RESULTS}}`)).toBe(
      MAX_SEARCH_RESULTS,
    )
  })

  it('returns null for garbage input', () => {
    expect(parseSearchCursor('garbage')).toBeNull()
  })

  it('returns null for a non-integer offset', () => {
    expect(parseSearchCursor('{"offset":1.5}')).toBeNull()
  })

  it('returns null for a wrong-shape recency cursor', () => {
    const recencyCursor = createHistoryCursor({
      activityAt: new Date('2026-01-01T00:00:00.000Z'),
      id: 'chat-1',
    })

    expect(parseSearchCursor(recencyCursor)).toBeNull()
  })
})
