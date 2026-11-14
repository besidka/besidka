import { describe, expect, it } from 'vitest'
import { estimateMemoryTokens } from '#shared/utils/memory-tokens'
import {
  applySkillArguments,
  neutralizeSkillDelimiters,
  toSkillAttributeValue,
  truncateToByteBudget,
  truncateToTokenBudget,
} from '~~/server/utils/skills/runtime/text'

describe('skill text helpers', () => {
  describe('applySkillArguments', () => {
    it('replaces every $ARGUMENTS with the user text', () => {
      expect(applySkillArguments('Do $ARGUMENTS, then $ARGUMENTS.', 'x'))
        .toBe('Do x, then x.')
    })

    it('never reads $& or $1 in the user text as a replacement pattern', () => {
      expect(applySkillArguments('Fix: $ARGUMENTS', 'a $& b $1 c $$ d'))
        .toBe('Fix: a $& b $1 c $$ d')
    })

    it('appends ARGUMENTS when the body has no placeholder', () => {
      expect(applySkillArguments('Body', 'the text'))
        .toBe('Body\n\nARGUMENTS: the text')
    })

    it('adds nothing for empty arguments and no placeholder', () => {
      expect(applySkillArguments('Body', '   ')).toBe('Body')
    })

    it('fills the placeholder with nothing for empty arguments', () => {
      expect(applySkillArguments('Do $ARGUMENTS now', '')).toBe('Do  now')
    })
  })

  describe('neutralizeSkillDelimiters', () => {
    it('defuses the wrapper tags in any case and spacing', () => {
      const text = 'a </skill_content> b < /SKILL_CONTENT > c '
        + '<active_skills> d </available_skills> e <skill_resources>'

      expect(neutralizeSkillDelimiters(text)).not.toMatch(
        /<\s*\/?\s*(skill_content|active_skills|available_skills|skill_resources)/i,
      )
    })

    it('leaves code and ordinary tags alone', () => {
      expect(neutralizeSkillDelimiters('<div>1 < 2</div> <skill_contents_not>'))
        .toBe('<div>1 < 2</div> <skill_contents_not>')
    })

    it('escapes an attribute value', () => {
      expect(toSkillAttributeValue('a"b<c>&d\n e'))
        .toBe('a&quot;b&lt;c&gt;&amp;d e')
    })
  })

  describe('truncation', () => {
    it('cuts at a token budget and reports it', () => {
      const text = 'word '.repeat(5000)
      const result = truncateToTokenBudget(text, 100, 'anthropic')

      expect(result.isTruncated).toBe(true)
      expect(estimateMemoryTokens(result.text, 'anthropic')).toBeLessThanOrEqual(
        100,
      )
      expect(result.text.length).toBeGreaterThan(0)
    })

    it('keeps text that fits', () => {
      expect(truncateToTokenBudget('short', 100, 'anthropic'))
        .toEqual({ text: 'short', isTruncated: false })
    })

    it('counts Cyrillic at the heavier rate, so it keeps fewer characters', () => {
      const latin = truncateToTokenBudget('a'.repeat(10_000), 200, 'anthropic')
      const cyrillic = truncateToTokenBudget('я'.repeat(10_000), 200, 'anthropic')

      expect(cyrillic.text.length).toBeLessThan(latin.text.length)
      expect(estimateMemoryTokens(cyrillic.text, 'anthropic'))
        .toBeLessThanOrEqual(200)
    })

    it('does not split a surrogate pair at the cut', () => {
      const result = truncateToTokenBudget('😀'.repeat(500), 20, 'default')

      expect(result.isTruncated).toBe(true)
      expect(result.text).toBe(Array.from(result.text).join(''))
      expect(result.text).not.toMatch(/[\uD800-\uDBFF]$/)
    })

    it('cuts at a byte budget on a character boundary', () => {
      const result = truncateToByteBudget('яя'.repeat(100), 51)

      expect(result.isTruncated).toBe(true)
      expect(new TextEncoder().encode(result.text).byteLength)
        .toBeLessThanOrEqual(51)
      expect(result.text).not.toContain('�')
    })
  })
})
