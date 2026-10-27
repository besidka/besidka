import { describe, expect, it } from 'vitest'
import {
  KNOWLEDGE_STORAGE_PREFIX,
  knowledgeItemTextKey,
  knowledgePackIndexKey,
  knowledgePackKey,
  knowledgeProjectPrefix,
  knowledgeUserPrefix,
} from '~~/server/utils/knowledge/storage-keys'

const INVALID_IDS = [
  { label: 'zero', value: 0 },
  { label: 'negative', value: -3 },
  { label: 'fractional', value: 1.5 },
  { label: 'NaN', value: Number.NaN },
  { label: 'Infinity', value: Number.POSITIVE_INFINITY },
  { label: 'unsafe integer', value: Number.MAX_SAFE_INTEGER + 1 },
  { label: 'string at runtime', value: '1' as unknown as number },
  { label: 'public id at runtime', value: 'k3Ypq' as unknown as number },
]

describe('knowledge storage keys', () => {
  it('uses the knowledge prefix constant', () => {
    expect(KNOWLEDGE_STORAGE_PREFIX).toBe('knowledge')
  })

  it('builds the exact user prefix', () => {
    expect(knowledgeUserPrefix(42)).toBe('knowledge/u42/')
  })

  it('builds the exact project prefix', () => {
    expect(knowledgeProjectPrefix(42, 7)).toBe('knowledge/u42/p7/')
  })

  it('builds the exact item text key', () => {
    expect(knowledgeItemTextKey(42, 7, 123)).toBe(
      'knowledge/u42/p7/items/123.md',
    )
  })

  it('builds the exact pack key', () => {
    expect(knowledgePackKey(42, 7, 3)).toBe(
      'knowledge/u42/p7/pack/v3.jsonl.gz',
    )
  })

  it('builds the exact pack index key', () => {
    expect(knowledgePackIndexKey(42, 7, 3)).toBe(
      'knowledge/u42/p7/pack/v3.index.json.gz',
    )
  })

  it('keeps every key under the user prefix and project prefix', () => {
    const keys = [
      knowledgeItemTextKey(5, 6, 7),
      knowledgePackKey(5, 6, 1),
      knowledgePackIndexKey(5, 6, 1),
    ]

    for (const key of keys) {
      expect(key.startsWith(knowledgeUserPrefix(5))).toBe(true)
      expect(key.startsWith(knowledgeProjectPrefix(5, 6))).toBe(true)
    }
  })

  it('does not let user 1 prefix match user 12', () => {
    expect(knowledgeUserPrefix(12).startsWith(knowledgeUserPrefix(1)))
      .toBe(false)
  })

  describe.each(INVALID_IDS)('with $label', ({ value }) => {
    it('rejects it as a user id', () => {
      expect(() => knowledgeUserPrefix(value)).toThrow()
      expect(() => knowledgeProjectPrefix(value, 1)).toThrow()
      expect(() => knowledgeItemTextKey(value, 1, 1)).toThrow()
    })

    it('rejects it as a project id', () => {
      expect(() => knowledgeProjectPrefix(1, value)).toThrow()
      expect(() => knowledgePackKey(1, value, 1)).toThrow()
    })

    it('rejects it as an item id', () => {
      expect(() => knowledgeItemTextKey(1, 1, value)).toThrow()
    })

    it('rejects it as a pack version', () => {
      expect(() => knowledgePackKey(1, 1, value)).toThrow()
      expect(() => knowledgePackIndexKey(1, 1, value)).toThrow()
    })
  })
})
