import { describe, expect, it } from 'vitest'
import {
  joinPhrases,
  listTokens,
  plainToken,
  pluralize,
  quoteText,
} from '~~/server/utils/besidka-tools/summary'

describe('besidka tool summary helpers', () => {
  it('quotes text and replaces inner quotes', () => {
    expect(quoteText('Quarterly plan')).toBe('"Quarterly plan"')
    expect(quoteText('say "hi"')).toBe('"say \'hi\'"')
  })

  it('collapses newlines, control and invisible characters', () => {
    expect(quoteText('first\nsecond\r\n\tthird')).toBe('"first second third"')
    expect(quoteText('a‮b​c\u0000d')).toBe('"a b c d"')
    expect(quoteText('line one line two')).toBe('"line one line two"')
  })

  it('caps long text with an ellipsis', () => {
    const quoted = quoteText('x'.repeat(200))

    expect(quoted).toBe(`"${'x'.repeat(59)}…"`)
    expect(quoteText('abcdef', 4)).toBe('"abc…"')
  })

  it('does not split an emoji when capping', () => {
    expect(quoteText('😀'.repeat(10), 4)).toBe(`"${'😀'.repeat(3)}…"`)
  })

  it('caps plain tokens without quotes', () => {
    expect(plainToken('01HZX\n3K')).toBe('01HZX 3K')
    expect(plainToken('y'.repeat(100))).toBe(`${'y'.repeat(39)}…`)
  })

  it('pluralizes counts', () => {
    expect(pluralize(1, 'chat')).toBe('1 chat')
    expect(pluralize(3, 'chat')).toBe('3 chats')
    expect(pluralize(2, 'public link')).toBe('2 public links')
    expect(pluralize(0, 'child', 'children')).toBe('0 children')
  })

  it('lists up to three tokens and counts the rest', () => {
    expect(listTokens(['a', 'b'])).toBe('a, b')
    expect(listTokens(['a', 'b', 'c'])).toBe('a, b, c')
    expect(listTokens(['a', 'b', 'c', 'd', 'e'])).toBe('a, b, c and 2 more')
  })

  it('joins phrases in plain English', () => {
    expect(joinPhrases([])).toBe('')
    expect(joinPhrases(['pin it'])).toBe('pin it')
    expect(joinPhrases(['pin it', 'rename it'])).toBe('pin it and rename it')
    expect(joinPhrases(['a', 'b', 'c'])).toBe('a, b and c')
  })
})
