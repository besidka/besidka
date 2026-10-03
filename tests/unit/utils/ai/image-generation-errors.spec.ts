import { describe, expect, it } from 'vitest'
import { getGatewayGeneratedImageFailureText } from '../../../../shared/utils/chat-failure-text'
import {
  getPersistedImageGenerationFailureText,
  getSafeImageGenerationError,
  isPersistedImageGenerationFailureText,
} from '../../../../server/utils/ai/image-generation-errors'

describe('isPersistedImageGenerationFailureText', () => {
  it('recognizes a direct-provider persistence text', () => {
    const error = getSafeImageGenerationError(
      new Error('safety violation'),
      'openai',
    )
    const persistedText = getPersistedImageGenerationFailureText(
      JSON.stringify({ code: error.code, message: error.message }),
    )

    expect(isPersistedImageGenerationFailureText(persistedText)).toBe(true)
  })

  it('recognizes a direct-provider persistence text with a ref suffix', () => {
    const persistedText = getPersistedImageGenerationFailureText(
      JSON.stringify({
        code: 'provider-auth',
        providerRequestId: 'cf-ray-abc123',
      }),
    )

    expect(persistedText).toMatch(/\(ref: cf-ray-abc123\)$/)
    expect(isPersistedImageGenerationFailureText(persistedText)).toBe(true)
  })

  it('recognizes the gateway generated-image-save failure text', () => {
    expect(isPersistedImageGenerationFailureText(
      getGatewayGeneratedImageFailureText(),
    )).toBe(true)
  })

  it('does not match unrelated assistant text', () => {
    expect(isPersistedImageGenerationFailureText('Here is the answer.'))
      .toBe(false)
  })
})

describe('getSafeImageGenerationError', () => {
  it('classifies a safety-rejection message as provider-safety', () => {
    const error = getSafeImageGenerationError(
      new Error('content policy violation'),
      'openai',
    )

    expect(error.code).toBe('provider-safety')
  })

  it('falls back to the generic error for an unrecognized message', () => {
    const error = getSafeImageGenerationError(
      new Error('something unexpected happened'),
      'openai',
    )

    expect(error.code).toBe('unknown')
  })
})

describe('getPersistedImageGenerationFailureText', () => {
  it('falls back to the generic persistence text for unparsable input', () => {
    expect(getPersistedImageGenerationFailureText(undefined)).toBe(
      getPersistedImageGenerationFailureText(
        JSON.stringify({ code: 'unknown' }),
      ),
    )
  })

  it('resolves the persistence text by code', () => {
    const persistedText = getPersistedImageGenerationFailureText(
      JSON.stringify({ code: 'storage-quota' }),
    )

    expect(persistedText).toBe(
      'Not enough storage space to generate an image.'
      + ' Delete files in the file manager, then try again.',
    )
  })
})
