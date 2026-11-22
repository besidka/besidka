import { describe, expect, it } from 'vitest'
import {
  createInvalidSpecError,
  parseStoredSpec,
} from '~~/server/utils/documents/stored-spec'

describe('parseStoredSpec', () => {
  it('parses stored JSON', () => {
    expect(parseStoredSpec('{"specVersion":1,"format":"pdf"}'))
      .toEqual({ specVersion: 1, format: 'pdf' })
  })

  it.each([
    ['truncated JSON', '{"specVersion":1,'],
    ['plain text', 'not json'],
    ['an empty object', ''],
  ])('answers undefined for %s instead of throwing', (_label, text) => {
    expect(parseStoredSpec(text)).toBeUndefined()
  })
})

describe('createInvalidSpecError', () => {
  it('is a 422 with the spec_invalid code', () => {
    expect(createInvalidSpecError()).toMatchObject({
      status: 422,
      why: 'spec_invalid',
    })
  })
})
