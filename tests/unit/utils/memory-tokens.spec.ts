import { describe, expect, it } from 'vitest'
import type { KnowledgeTokenFamily } from '#shared/types/project-knowledge.d'
import { estimateMemoryTokens } from '#shared/utils/memory-tokens'
import { KNOWLEDGE_CHARS_PER_TOKEN } from '#shared/utils/project-knowledge-policy'

const CYRILLIC_PROFILE = 'Я бекенд-розробник, пишу на TypeScript і Rust. '
  .repeat(20)

const LEGACY_CYRILLIC_CHARS_PER_TOKEN = 2.5

describe('estimateMemoryTokens', () => {
  it('returns 0 for an empty string', () => {
    expect(estimateMemoryTokens('')).toBe(0)
  })

  it.each([
    ['default', 'a', 'latin'],
    ['default', 'я', 'cyrillic'],
    ['default', '漢', 'other'],
    ['anthropic', 'a', 'latin'],
    ['anthropic', 'я', 'cyrillic'],
    ['anthropic', '漢', 'other'],
    ['qwen', 'я', 'cyrillic'],
    ['deepseek', 'я', 'cyrillic'],
    ['moonshotai', 'я', 'cyrillic'],
    ['openai', 'я', 'cyrillic'],
    ['google', 'я', 'cyrillic'],
  ] as const)('uses the %s knowledge factor for %s (%s)', (
    family,
    character,
    characterClass,
  ) => {
    const charsPerToken = KNOWLEDGE_CHARS_PER_TOKEN[family][characterClass]
    const count = 600

    expect(estimateMemoryTokens(character.repeat(count), family))
      .toBe(Math.ceil(count / charsPerToken))
  })

  it.each([
    'anthropic',
    'qwen',
    'deepseek',
    'moonshotai',
  ] as const)('estimates Cyrillic on %s above the old 2.5 chars per token',
    (family: KnowledgeTokenFamily) => {
      const legacyEstimate = Math.ceil(
        'я'.repeat(1000).length / LEGACY_CYRILLIC_CHARS_PER_TOKEN,
      )

      expect(estimateMemoryTokens('я'.repeat(1000), family))
        .toBeGreaterThan(legacyEstimate)
    })

  it('estimates a Cyrillic profile higher on Claude than by default', () => {
    expect(estimateMemoryTokens(CYRILLIC_PROFILE, 'anthropic'))
      .toBeGreaterThan(estimateMemoryTokens(CYRILLIC_PROFILE))
  })

  it('falls back to the default family without one', () => {
    expect(estimateMemoryTokens(CYRILLIC_PROFILE))
      .toBe(estimateMemoryTokens(CYRILLIC_PROFILE, 'default'))
  })

  it('counts an emoji surrogate pair as one character', () => {
    expect(estimateMemoryTokens('😀'.repeat(3))).toBe(2)
  })

  it('treats accented Latin letters as Latin', () => {
    expect(estimateMemoryTokens('ąćęłńóśźż'.repeat(4))).toBe(11)
  })

  it('treats typographic punctuation as other characters', () => {
    expect(estimateMemoryTokens('—')).toBe(1)
    expect(estimateMemoryTokens('…‹›')).toBe(2)
  })

  it('rounds the summed total up once, not per class', () => {
    expect(estimateMemoryTokens('ab')).toBe(1)
    expect(estimateMemoryTokens('abя', 'openai')).toBe(1)
    expect(estimateMemoryTokens('abяя', 'openai')).toBe(2)
  })

  it('estimates the same Cyrillic text higher than Latin text', () => {
    const latin = 'x'.repeat(1000)
    const cyrillic = 'ж'.repeat(1000)

    expect(estimateMemoryTokens(cyrillic)).toBeGreaterThan(
      estimateMemoryTokens(latin),
    )
  })
})
