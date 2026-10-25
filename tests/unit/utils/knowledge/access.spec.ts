import { describe, expect, it } from 'vitest'
import { encodePublicId } from '~~/server/utils/custom-db-types'
import { decodeKnowledgeEntityId } from '~~/server/utils/knowledge/access'

describe('decodeKnowledgeEntityId', () => {
  it('decodes the canonical public id of a positive integer', () => {
    expect(decodeKnowledgeEntityId(encodePublicId(1))).toBe(1)
    expect(decodeKnowledgeEntityId(encodePublicId(123456))).toBe(123456)
  })

  it.each([
    '',
    'not-an-id',
    '!!!',
    '0',
    ' ',
    'x'.repeat(200),
    `${encodePublicId(5)}x`,
  ])('returns null for %j', (publicId) => {
    expect(decodeKnowledgeEntityId(publicId)).toBeNull()
  })

  it('returns null for values that are not strings', () => {
    expect(decodeKnowledgeEntityId(undefined)).toBeNull()
    expect(decodeKnowledgeEntityId(null)).toBeNull()
    expect(decodeKnowledgeEntityId(5)).toBeNull()
    expect(decodeKnowledgeEntityId({})).toBeNull()
  })

  it('returns null for an id longer than 32 characters', () => {
    expect(decodeKnowledgeEntityId('a'.repeat(33))).toBeNull()
    expect(decodeKnowledgeEntityId('a'.repeat(1000))).toBeNull()
  })

  it('returns null for the encoding of zero', () => {
    expect(decodeKnowledgeEntityId(encodePublicId(0))).toBeNull()
  })
})
