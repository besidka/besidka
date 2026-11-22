import { describe, expect, it } from 'vitest'
import { getGatewayGeneratedImageFailureText } from '../../../../shared/utils/chat-failure-text'
import {
  getPersistedImageGenerationFailureText,
  getSafeImageGenerationError,
  isPersistedImageGenerationFailureText,
} from '../../../../server/utils/ai/image-generation-errors'
import { createStorageFullError } from '../../../../server/utils/storage/errors'

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

  it('classifies a missing previous image as source-image-unavailable', () => {
    const error = getSafeImageGenerationError(
      new Error('The earlier image is no longer available to edit.'),
      'openai',
    )

    expect(error).toMatchObject({
      code: 'source-image-unavailable',
      status: 404,
      message: 'The earlier image is no longer available to edit.',
    })
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

  it('resolves and recognizes the source-image-unavailable text', () => {
    const persistedText = getPersistedImageGenerationFailureText(
      JSON.stringify({ code: 'source-image-unavailable' }),
    )

    expect(persistedText).toBe(
      'The earlier image is no longer available to edit.'
      + ' Attach it again, then try again.',
    )
    expect(isPersistedImageGenerationFailureText(persistedText)).toBe(true)
  })

  it('maps the shared storage full error to the storage quota failure', () => {
    const error = getSafeImageGenerationError(
      createStorageFullError({ usedBytes: 20, totalBytes: 20 }),
      'openai',
    )

    expect(error).toMatchObject({
      code: 'storage-quota',
      fix: 'Free space on the Storage page, then try again.',
    })
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
