import { describe, expect, it } from 'vitest'
import { SEARCH_APOSTROPHE } from '../../../../server/utils/search/text'
import {
  buildStemmedSearchText,
  isCyrillicToken,
  MIN_STEMMABLE_TOKEN_LENGTH,
  stemSearchToken,
  tokenizeSearchText,
} from '../../../../server/utils/search/tokens'

describe('tokenizeSearchText', () => {
  it('keeps U+02BC inside tokens', () => {
    const value = `зʼїзд`

    expect(tokenizeSearchText(value)).toEqual(['зʼїзд'])
    expect(SEARCH_APOSTROPHE).toBe('ʼ')
  })

  it('splits on punctuation and emoji', () => {
    expect(tokenizeSearchText('hello, world! 😀 test.')).toEqual([
      'hello', 'world', 'test',
    ])
  })

  it('lowercases tokens', () => {
    expect(tokenizeSearchText('TypeScript Школа')).toEqual([
      'typescript', 'школа',
    ])
  })
})

describe('isCyrillicToken', () => {
  it('is true for a fully Cyrillic token', () => {
    expect(isCyrillicToken('школа')).toBe(true)
  })

  it('is false for a Latin token', () => {
    expect(isCyrillicToken('hello')).toBe(false)
  })

  it('is false for a code-identifier-like token', () => {
    expect(isCyrillicToken('c++')).toBe(false)
  })

  it('is true when at least half the letters are Cyrillic', () => {
    expect(isCyrillicToken('школаab')).toBe(true)
  })
})

describe('stemSearchToken', () => {
  it('skips tokens shorter than MIN_STEMMABLE_TOKEN_LENGTH', () => {
    const shortToken = 'а'.repeat(MIN_STEMMABLE_TOKEN_LENGTH - 1)

    expect(stemSearchToken(shortToken)).toBe(shortToken)
  })

  it('skips non-Cyrillic tokens', () => {
    expect(stemSearchToken('database')).toBe('database')
  })

  it('stems a sufficiently long Cyrillic token', () => {
    expect(stemSearchToken('книзі')).toBe('кни')
  })
})

describe('buildStemmedSearchText', () => {
  it('is symmetric with the query path for a mixed sentence', () => {
    const sentence = 'Українська школа та TypeScript код'
    const tokens = tokenizeSearchText(sentence)
    const expectedStems = tokens.map(stemSearchToken).join(' ')

    expect(buildStemmedSearchText(sentence)).toBe(expectedStems)
  })
})
