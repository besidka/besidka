import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSearchIndexTestDb } from '../../../setup/helpers/search-index-db'
import {
  buildSearchMatchExpression,
  buildSearchOwnerTag,
  MAX_SEARCH_QUERY_LENGTH,
} from '../../../../server/utils/search/query'
import { MAX_SEARCH_TOKENS } from '../../../../server/utils/search/tokens'

describe('buildSearchOwnerTag', () => {
  it('builds an owner tag from a numeric user id', () => {
    expect(buildSearchOwnerTag(42)).toBe('u42')
  })
})

describe('buildSearchMatchExpression', () => {
  it('produces the exact expected expression for a known input', () => {
    const result = buildSearchMatchExpression('книзі школи', 42)

    expect(result.match).toBe(
      '{owner}: u42 AND ({body}: "книзі"* OR {body_stem}: "кни"*)'
      + ' AND ({body}: "школи"* OR {body_stem}: "школ"*)',
    )
  })

  it('returns match: null for an emoji-only query', () => {
    const result = buildSearchMatchExpression('😀😀😀', 1)

    expect(result.match).toBeNull()
    expect(result.tokens).toEqual([])
  })

  it('returns match: null for a whitespace-only query', () => {
    const result = buildSearchMatchExpression('   \n\t  ', 1)

    expect(result.match).toBeNull()
  })

  it('caps the token count at MAX_SEARCH_TOKENS', () => {
    const words = Array.from({ length: MAX_SEARCH_TOKENS + 5 }, (_, index) => {
      return `word${index}`
    })
    const result = buildSearchMatchExpression(words.join(' '), 1)

    expect(result.tokens).toHaveLength(MAX_SEARCH_TOKENS)
  })

  it('caps the query length at MAX_SEARCH_QUERY_LENGTH', () => {
    const longQuery = 'a'.repeat(MAX_SEARCH_QUERY_LENGTH + 100)
    const result = buildSearchMatchExpression(longQuery, 1)

    expect(result.tokens).toEqual(['a'.repeat(MAX_SEARCH_QUERY_LENGTH)])
  })

  it('bounds a pathologically long query (10x the cap)', () => {
    const pathologicalQuery = 'a'.repeat(MAX_SEARCH_QUERY_LENGTH * 10)
    const result = buildSearchMatchExpression(pathologicalQuery, 1)

    expect(result.tokens).toEqual(['a'.repeat(MAX_SEARCH_QUERY_LENGTH)])
  })
})

describe('buildSearchMatchExpression adversarial matrix (executed against FTS5)', () => {
  let testDb: ReturnType<typeof createSearchIndexTestDb>

  beforeEach(() => {
    testDb = createSearchIndexTestDb()
    testDb.sqlite.exec(`
      insert into message_search(rowid, owner, body, body_stem)
      values (1, 'u1', 'quoted" text with NEAR and AND OR c++', 'quot text near and or c')
    `)
  })

  afterEach(() => {
    testDb.close()
  })

  const adversarialInputs = [
    'NEAR',
    'AND',
    'OR',
    'c++',
    'quoted"',
    '😀',
    '   ',
    'книзі школа',
    'колонка:',
  ]

  it.each(adversarialInputs)(
    'produces a MATCH string FTS5 accepts for input %j',
    (input) => {
      const { match } = buildSearchMatchExpression(input, 1)

      if (!match) {
        return
      }

      expect(() => {
        testDb.sqlite.prepare(
          'select rowid from message_search where message_search match ?',
        ).all(match)
      }).not.toThrow()
    },
  )

  it('matches the exact-form phrase for a real adversarial input', () => {
    const { match } = buildSearchMatchExpression('NEAR', 1)

    const rows = testDb.sqlite.prepare(
      'select rowid from message_search where message_search match ?',
    ).all(match)

    expect(rows).toEqual([{ rowid: 1 }])
  })
})
