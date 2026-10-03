import { describe, expect, it } from 'vitest'
import {
  getGatewayGeneratedImageFailureText,
  getPersistedEmptyAnswerFailureText,
  getPersistedOversizedResponseFailureText,
  IMAGE_GENERATION_FAILURE_TEXT,
  isPersistedEmptyAnswerFailureText,
  isPersistedImageFailureText,
  parsePersistedChatFailureNotice,
} from '../../../shared/utils/chat-failure-text'

describe('empty-answer failure text', () => {
  it('recognizes the exact persisted text', () => {
    const text = getPersistedEmptyAnswerFailureText()

    expect(isPersistedEmptyAnswerFailureText(text)).toBe(true)
  })

  it('does not match unrelated assistant text', () => {
    expect(isPersistedEmptyAnswerFailureText('Here is the answer.'))
      .toBe(false)
  })

  it('does not match a real answer that merely mentions searching', () => {
    expect(isPersistedEmptyAnswerFailureText(
      'I searched the web and found the answer.',
    )).toBe(false)
  })
})

describe('parsePersistedChatFailureNotice', () => {
  it('recognizes the empty-answer notice', () => {
    const text = getPersistedEmptyAnswerFailureText()

    expect(parsePersistedChatFailureNotice(text)).toEqual({ message: text })
  })

  it('recognizes the oversized-response notice', () => {
    const text = getPersistedOversizedResponseFailureText()

    expect(parsePersistedChatFailureNotice(text)).toEqual({ message: text })
  })

  it('recognizes an image-generation notice and extracts the reference', () => {
    expect(parsePersistedChatFailureNotice(
      'Image generation failed. Revise the prompt or try a different'
      + ' provider. (ref: a402ad19eeccd2c5)',
    )).toEqual({
      message: 'Image generation failed. Revise the prompt or try a'
        + ' different provider.',
      requestId: 'a402ad19eeccd2c5',
    })
  })

  it('recognizes an image-generation notice without a reference', () => {
    expect(parsePersistedChatFailureNotice(
      'The generated image could not be saved. Try again. If it keeps'
      + ' failing, contact support.',
    )).toEqual({
      message: 'The generated image could not be saved. Try again. If it'
        + ' keeps failing, contact support.',
      requestId: undefined,
    })
  })

  it('returns null for real assistant content', () => {
    expect(parsePersistedChatFailureNotice('Here is the answer.'))
      .toBeNull()
  })

  it('recognizes the gateway generated-image-save failure text', () => {
    const text = getGatewayGeneratedImageFailureText()

    expect(parsePersistedChatFailureNotice(text)).toEqual({
      message: text,
      requestId: undefined,
    })
  })
})

describe('isPersistedImageFailureText', () => {
  it('recognizes every image-generation persistence text', () => {
    for (const text of Object.values(IMAGE_GENERATION_FAILURE_TEXT)) {
      expect(isPersistedImageFailureText(text)).toBe(true)
    }
  })

  it('recognizes the gateway generated-image-save failure text', () => {
    expect(isPersistedImageFailureText(getGatewayGeneratedImageFailureText()))
      .toBe(true)
  })

  it('recognizes a ref-suffixed image-generation text', () => {
    expect(isPersistedImageFailureText(
      `${IMAGE_GENERATION_FAILURE_TEXT.generic} (ref: abc123)`,
    )).toBe(true)
  })

  it('does not match unrelated assistant text', () => {
    expect(isPersistedImageFailureText('Here is the answer.')).toBe(false)
  })
})
