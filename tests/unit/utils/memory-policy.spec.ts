import { describe, expect, it } from 'vitest'
import {
  MEMORY_ENTRY_SLUG_PATTERN,
  MEMORY_LIMITS,
  MEMORY_SETTING_DEFAULTS,
  alwaysInjectedMemoryCategories,
  memoryCategories,
  memorySensitiveCategories,
  neverStoreKindIds,
  neverStoreKinds,
} from '../../../shared/utils/memory-policy'

describe('neverStoreKinds', () => {
  it('lists the same ids, in the same order, as neverStoreKindIds', () => {
    expect(neverStoreKinds.map(kind => kind.id)).toEqual(
      [...neverStoreKindIds],
    )
  })

  it('has no duplicate ids', () => {
    expect(new Set(neverStoreKindIds).size).toBe(neverStoreKindIds.length)
  })

  it('gives every kind a label and a valid detection', () => {
    for (const kind of neverStoreKinds) {
      expect(kind.label.trim().length).toBeGreaterThan(0)
      expect(['deterministic', 'extractor']).toContain(kind.detection)
    }
  })

  it('keeps a catch-all kind for extractor-labelled items', () => {
    expect(neverStoreKindIds).toContain('other')
  })
})

describe('memorySensitiveCategories', () => {
  it('contains the eight GDPR Art. 9 special categories', () => {
    expect(memorySensitiveCategories).toEqual(expect.arrayContaining([
      'health',
      'religion-or-belief',
      'political-opinion',
      'racial-or-ethnic-origin',
      'sex-life-or-orientation',
      'trade-union',
      'genetic',
      'biometric',
    ]))
  })

  it('adds the two owner categories on top of Art. 9', () => {
    expect(memorySensitiveCategories).toContain('legal-dispute')
    expect(memorySensitiveCategories).toContain('drugs')
    expect(memorySensitiveCategories).toHaveLength(10)
  })

  it('has no duplicates', () => {
    expect(new Set(memorySensitiveCategories).size)
      .toBe(memorySensitiveCategories.length)
  })
})

describe('MEMORY_LIMITS', () => {
  it('keeps the always-injected body cap within the general body cap', () => {
    expect(MEMORY_LIMITS.maxAlwaysInjectedBodyBytes)
      .toBeLessThanOrEqual(MEMORY_LIMITS.maxBodyBytes)
  })

  it('caps bodies at 4096 bytes and always-injected bodies at 1536', () => {
    expect(MEMORY_LIMITS.maxBodyBytes).toBe(4096)
    expect(MEMORY_LIMITS.maxAlwaysInjectedBodyBytes).toBe(1536)
  })

  it('caps account memory at 30 and project memory at 15 entries', () => {
    expect(MEMORY_LIMITS.maxAccountEntries).toBe(30)
    expect(MEMORY_LIMITS.maxProjectEntries).toBe(15)
    expect(MEMORY_LIMITS.maxProjectEntries)
      .toBeLessThanOrEqual(MEMORY_LIMITS.maxAccountEntries)
  })

  it('only always-injects categories that exist', () => {
    for (const category of alwaysInjectedMemoryCategories) {
      expect(memoryCategories).toContain(category)
    }
  })
})

describe('MEMORY_SETTING_DEFAULTS', () => {
  it('keeps memory and chat search on, extraction and sensitive off', () => {
    expect(MEMORY_SETTING_DEFAULTS.memoryEnabled).toBe(true)
    expect(MEMORY_SETTING_DEFAULTS.memoryExtractionEnabled).toBe(false)
    expect(MEMORY_SETTING_DEFAULTS.chatSearchEnabled).toBe(true)
    expect(MEMORY_SETTING_DEFAULTS.memoryIncludeSensitive).toBe(false)
    expect(MEMORY_SETTING_DEFAULTS.aboutMe).toBeNull()
    expect(MEMORY_SETTING_DEFAULTS.useAccountMemory).toBe(true)
  })
})

describe('MEMORY_ENTRY_SLUG_PATTERN', () => {
  it('accepts lowercase kebab-case slugs', () => {
    expect(MEMORY_ENTRY_SLUG_PATTERN.test('coding-style')).toBe(true)
    expect(MEMORY_ENTRY_SLUG_PATTERN.test('a1')).toBe(true)
  })

  it('rejects uppercase, spaces and stray hyphens', () => {
    expect(MEMORY_ENTRY_SLUG_PATTERN.test('Coding')).toBe(false)
    expect(MEMORY_ENTRY_SLUG_PATTERN.test('two words')).toBe(false)
    expect(MEMORY_ENTRY_SLUG_PATTERN.test('-leading')).toBe(false)
    expect(MEMORY_ENTRY_SLUG_PATTERN.test('double--hyphen')).toBe(false)
  })
})
