import { describe, expect, it } from 'vitest'
import { sanitizeConnectorText } from '#shared/utils/connectors-text'

describe('sanitizeConnectorText', () => {
  it('removes control, bidi, format and tag characters', () => {
    const dirty = 'Lin\u0000ear‮ evil​⁦x⁩\u{E0041}\u0085y'

    expect(sanitizeConnectorText(dirty, 80)).toBe('Lin ear evil x y')
  })

  it('collapses whitespace and line breaks to one space', () => {
    expect(sanitizeConnectorText('  a \n\t b c  ', 80)).toBe('a b c')
  })

  it('cuts by code points without splitting a character', () => {
    expect(sanitizeConnectorText('a😀b😀c', 4)).toBe('a😀b😀')
    expect(Array.from(sanitizeConnectorText('😀'.repeat(200), 80)))
      .toHaveLength(80)
  })

  it('returns an empty string for text that is only unsafe characters', () => {
    expect(sanitizeConnectorText('​‮ \u0000', 80)).toBe('')
  })
})
