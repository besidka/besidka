import type { TextUIPart, UIMessage } from 'ai'
import { describe, expect, it } from 'vitest'
import {
  getPersistedEmptyAnswerFailureText,
} from '../../../shared/utils/chat-failure-text'
import {
  getPersistedFailureErrorPayload,
  isPersistedFailureTextPart,
} from '../../../app/utils/chat-failure-notice'

function createTextPart(text: string): TextUIPart {
  return { type: 'text', text }
}

describe('getPersistedFailureErrorPayload', () => {
  it('parses an image-generation failure notice with a reference', () => {
    const part = createTextPart(
      'Image generation failed. Revise the prompt or try a different'
      + ' provider. (ref: a402ad19eeccd2c5)',
    )

    expect(getPersistedFailureErrorPayload({ role: 'assistant' }, part))
      .toEqual({
        code: 'unknown',
        message: 'Image generation failed. Revise the prompt or try a'
          + ' different provider.',
        requestId: 'a402ad19eeccd2c5',
      })
  })

  it('parses an image-generation failure notice without a reference', () => {
    const part = createTextPart(
      'The image provider is temporarily unavailable. Try again later or'
      + ' use a different provider.',
    )

    expect(getPersistedFailureErrorPayload({ role: 'assistant' }, part))
      .toEqual({
        code: 'unknown',
        message: 'The image provider is temporarily unavailable. Try again'
          + ' later or use a different provider.',
        requestId: undefined,
      })
  })

  it('parses the empty-answer notice', () => {
    const part = createTextPart(getPersistedEmptyAnswerFailureText())

    expect(getPersistedFailureErrorPayload({ role: 'assistant' }, part))
      .toEqual({
        code: 'unknown',
        message: getPersistedEmptyAnswerFailureText(),
        requestId: undefined,
      })
  })

  it('returns null for a user message with the same text', () => {
    const part = createTextPart(getPersistedEmptyAnswerFailureText())

    expect(getPersistedFailureErrorPayload({ role: 'user' }, part))
      .toBeNull()
  })

  it('returns null for ordinary assistant text', () => {
    const part = createTextPart('Here is the answer you asked for.')

    expect(getPersistedFailureErrorPayload({ role: 'assistant' }, part))
      .toBeNull()
  })

  it('returns null for a non-text part', () => {
    const part = { type: 'file' } as UIMessage['parts'][number]

    expect(getPersistedFailureErrorPayload({ role: 'assistant' }, part))
      .toBeNull()
  })

  it('returns null for an undefined part', () => {
    expect(getPersistedFailureErrorPayload({ role: 'assistant' }, undefined))
      .toBeNull()
  })
})

describe('isPersistedFailureTextPart', () => {
  it('matches an assistant failure notice', () => {
    const part = createTextPart(getPersistedEmptyAnswerFailureText())

    expect(isPersistedFailureTextPart({ role: 'assistant' }, part))
      .toBe(true)
  })

  it('does not match ordinary assistant text', () => {
    const part = createTextPart('Here is the answer you asked for.')

    expect(isPersistedFailureTextPart({ role: 'assistant' }, part))
      .toBe(false)
  })
})
