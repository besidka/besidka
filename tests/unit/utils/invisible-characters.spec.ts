import { describe, expect, it } from 'vitest'
import {
  hasControlCharacters,
  hasFormatCharacters,
} from '#shared/utils/invisible-characters'

describe('invisible characters', () => {
  it.each([
    ['a right-to-left override', 'a‮b'],
    ['a zero-width space', 'a​b'],
    ['a zero-width joiner', 'a‍b'],
    ['a byte order mark', '﻿ab'],
  ])('flags %s as a format character', (_label, value) => {
    expect(hasFormatCharacters(value)).toBe(true)
  })

  it.each([
    ['a bell', 'a\u0007b'],
    ['a tab', 'a\tb'],
    ['a newline', 'a\nb'],
    ['a C1 control', 'a\u0085b'],
  ])('flags %s as a control character', (_label, value) => {
    expect(hasControlCharacters(value)).toBe(true)
  })

  it('accepts Cyrillic text with an emoji', () => {
    expect(hasFormatCharacters('Бесідка 🚀')).toBe(false)
    expect(hasControlCharacters('Бесідка 🚀')).toBe(false)
  })
})
