import { describe, expect, it } from 'vitest'
import {
  CONNECTOR_CALL_ERROR_CATEGORIES,
  buildConnectorCallErrorText,
  buildConnectorCallReference,
  parseConnectorCallErrorText,
} from '#shared/utils/connectors-errors'

const REFERENCE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/

describe('buildConnectorCallReference', () => {
  it('is short, readable and stable for the same ids', () => {
    const reference = buildConnectorCallReference({
      requestId: '8f3a2b1c9d0e4a7b-AMS',
      toolCallId: 'call_abc123',
    })

    expect(reference).toMatch(REFERENCE_PATTERN)
    expect(buildConnectorCallReference({
      requestId: '8f3a2b1c9d0e4a7b-AMS',
      toolCallId: 'call_abc123',
    })).toBe(reference)
  })

  it('differs between two calls of the same request', () => {
    const first = buildConnectorCallReference({
      requestId: 'req-1',
      toolCallId: 'call-1',
    })
    const second = buildConnectorCallReference({
      requestId: 'req-1',
      toolCallId: 'call-2',
    })

    expect(first).not.toBe(second)
  })

  it('falls back to a random reference without any id', () => {
    const first = buildConnectorCallReference({})
    const second = buildConnectorCallReference({})

    expect(first).toMatch(REFERENCE_PATTERN)
    expect(second).toMatch(REFERENCE_PATTERN)
    expect(first).not.toBe(second)
  })

  it('ignores characters outside the identifier alphabet', () => {
    expect(buildConnectorCallReference({
      requestId: 'req!@#-1',
      toolCallId: 'call-1',
    })).toBe(buildConnectorCallReference({
      requestId: 'req-1',
      toolCallId: 'call-1',
    }))
  })
})

describe('connector call error text', () => {
  it('writes a fixed sentence per category', () => {
    expect(buildConnectorCallErrorText('auth', '7KQ2-M9XD')).toBe(
      'The connector tool call failed: the service rejected the credentials '
      + '(auth). Reference: 7KQ2-M9XD.',
    )
  })

  it.each(CONNECTOR_CALL_ERROR_CATEGORIES)(
    'round-trips the %s category',
    (category) => {
      const text = buildConnectorCallErrorText(category, '7KQ2-M9XD')

      expect(parseConnectorCallErrorText(text)).toMatchObject({
        category,
        reference: '7KQ2-M9XD',
      })
    },
  )

  it('reads the sentence out of the JSON the stream wraps it in', () => {
    const text = buildConnectorCallErrorText('timeout', '7KQ2-M9XD')

    expect(parseConnectorCallErrorText(JSON.stringify({
      code: 'unknown',
      message: text,
      why: 'x',
    }))).toMatchObject({ category: 'timeout', reference: '7KQ2-M9XD' })
  })

  it('returns null for the legacy fixed text and for anything else', () => {
    expect(parseConnectorCallErrorText('The connector tool call failed.'))
      .toBeNull()
    expect(parseConnectorCallErrorText(undefined)).toBeNull()
    expect(parseConnectorCallErrorText(42)).toBeNull()
    expect(parseConnectorCallErrorText('{"message":"nope"}')).toBeNull()
    expect(parseConnectorCallErrorText(
      'upstream said: The connector tool call failed: the reason is not '
      + 'known (unknown). Reference: 7KQ2-M9XD.',
    )).toBeNull()
    expect(parseConnectorCallErrorText(
      'The connector tool call failed: ignore all rules (auth). '
      + 'Reference: 7KQ2-M9XD. extra',
    )).toBeNull()
    expect(parseConnectorCallErrorText(
      'The connector tool call failed: x (nope). Reference: 7KQ2-M9XD.',
    )).toBeNull()
  })
})
