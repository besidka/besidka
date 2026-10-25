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

describe('buildSearchMatchExpression operator option', () => {
  it('keeps the default expression identical to the explicit and operator', () => {
    const defaultResult = buildSearchMatchExpression('книзі школи', 42)
    const andResult = buildSearchMatchExpression(
      'книзі школи',
      42,
      { operator: 'and' },
    )

    expect(andResult).toEqual(defaultResult)
  })

  it('joins token clauses with OR inside parentheses under the owner', () => {
    const result = buildSearchMatchExpression(
      'книзі школи',
      42,
      { operator: 'or' },
    )

    expect(result.match).toBe(
      '{owner}: u42 AND (({body}: "книзі"* OR {body_stem}: "кни"*)'
      + ' OR ({body}: "школи"* OR {body_stem}: "школ"*))',
    )
    expect(result.tokens).toEqual(['книзі', 'школи'])
  })

  it('drops one-character tokens but keeps two-character ones in or mode', () => {
    const result = buildSearchMatchExpression(
      'AI a я DB R2',
      1,
      { operator: 'or' },
    )

    expect(result.tokens).toEqual(['ai', 'db', 'r2'])
    expect(result.match).not.toContain('"a"*')
    expect(result.match).not.toContain('"я"*')
    expect(result.match).toContain('{body}: "ai"*')
    expect(result.match).toContain('{body}: "r2"*')
  })

  it('returns no match when every token is one character in or mode', () => {
    const result = buildSearchMatchExpression('a я z', 1, { operator: 'or' })

    expect(result).toEqual({ match: null, tokens: [] })
  })

  it('keeps one-character tokens in the and expression unchanged', () => {
    const result = buildSearchMatchExpression('go is a', 1)

    expect(result.tokens).toEqual(['go', 'is', 'a'])
    expect(result.match).toBe(
      '{owner}: u1 AND ({body}: "go"* OR {body_stem}: "go"*)'
      + ' AND ({body}: "is"* OR {body_stem}: "is"*)'
      + ' AND ({body}: "a"* OR {body_stem}: "a"*)',
    )
  })

  it('returns match: null for an unusable query in or mode', () => {
    const result = buildSearchMatchExpression('😀', 1, { operator: 'or' })

    expect(result.match).toBeNull()
  })

  it('escapes quotes in or mode', () => {
    const result = buildSearchMatchExpression('say"hi', 1, { operator: 'or' })

    expect(result.match).not.toContain('"say"hi"')
  })
})

describe('or expression executed against FTS5', () => {
  let testDb: ReturnType<typeof createSearchIndexTestDb>

  function searchRowIds(match: string): number[] {
    const rows = testDb.sqlite.prepare(
      'select rowid from message_search where message_search match ?',
    ).all(match) as Array<{ rowid: number }>

    return rows.map(row => row.rowid)
  }

  beforeEach(() => {
    testDb = createSearchIndexTestDb()
    testDb.sqlite.exec(`
      insert into message_search(rowid, owner, body, body_stem) values
        (1, 'u1', 'alpha only', 'alpha only'),
        (2, 'u1', 'bravo only', 'bravo only'),
        (3, 'u2', 'bravo foreign', 'bravo foreign')
    `)
  })

  afterEach(() => {
    testDb.close()
  })

  it('matches rows containing any token but only for the owner', () => {
    const { match } = buildSearchMatchExpression(
      'alpha bravo',
      1,
      { operator: 'or' },
    )

    expect(searchRowIds(match!).sort()).toEqual([1, 2])
  })

  it('never returns another owner row through the second OR branch', () => {
    const { match } = buildSearchMatchExpression(
      'zulu bravo',
      1,
      { operator: 'or' },
    )

    expect(searchRowIds(match!)).toEqual([2])
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
