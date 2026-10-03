import { describe, expect, it } from 'vitest'
import { normalizeChatError } from '../../../../server/utils/chats/errors'

describe('normalizeChatError status classification', () => {
  it('classifies a 402 as provider-quota-exceeded', () => {
    const chatError = normalizeChatError({
      error: { statusCode: 402, message: 'Insufficient balance' },
    })

    expect(chatError.code).toBe('provider-quota-exceeded')
    expect(chatError.fix).toBe(
      'Check your provider billing or switch to a different saved key.',
    )
  })

  it('still classifies a 429 as provider-rate-limit', () => {
    const chatError = normalizeChatError({
      error: { statusCode: 429, message: 'Too many requests' },
    })

    expect(chatError.code).toBe('provider-rate-limit')
  })
})

describe('normalizeChatError why/message deduplication', () => {
  it('drops why when it is identical to the raw upstream message', () => {
    const chatError = normalizeChatError({
      error: {
        statusCode: 400,
        message: 'No endpoints available for any resolved phaser models: '
          + 'z-ai/glm-5.2',
      },
    })

    expect(chatError.message).toBe(
      'No endpoints available for any resolved phaser models: z-ai/glm-5.2',
    )
    expect(chatError.why).toBeUndefined()
  })

  it('keeps why when it adds detail beyond the message', () => {
    const chatError = normalizeChatError({
      error: { statusCode: 401, message: 'invalid api key' },
    })

    expect(chatError.message).not.toBe(chatError.why)
    expect(chatError.why).toBe(
      'The saved API key is missing, invalid, or does not allow this model.',
    )
  })

  it('dedupes why on the structured-error path too', () => {
    const structuredError = JSON.stringify({
      code: 'unknown',
      message: 'No endpoints found for this model',
      why: 'No endpoints found for this model',
    })
    const chatError = normalizeChatError({ error: structuredError })

    expect(chatError.message).toBe('No endpoints found for this model')
    expect(chatError.why).toBeUndefined()
  })
})

describe('normalizeChatError deterministic-routing fix text', () => {
  it('does not advise retrying a deterministic "no endpoints" failure',
    () => {
      const chatError = normalizeChatError({
        error: {
          statusCode: 400,
          message: 'No endpoints available for any resolved phaser models: '
            + 'z-ai/glm-5.2',
        },
      })

      expect(chatError.fix).toBe('Try a different model or provider.')
    })

  it('still advises retrying an ordinary unknown failure', () => {
    const chatError = normalizeChatError({
      error: { statusCode: 400, message: 'Something went wrong upstream' },
    })

    expect(chatError.fix).toBe('Retry the message.')
  })
})

describe('assistant-empty-answer error code', () => {
  it('has default message/why/fix text explaining the tool-only turn',
    () => {
      const chatError = normalizeChatError({
        error: new Error('assistant-empty-answer'),
        code: 'assistant-empty-answer',
      })

      expect(chatError.code).toBe('assistant-empty-answer')
      expect(chatError.message).toBe(
        'The model finished searching but didn\'t write an answer.',
      )
      expect(chatError.fix).toBe('Try again or pick another model.')
    })
})
