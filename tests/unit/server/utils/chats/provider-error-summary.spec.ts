import { describe, expect, it } from 'vitest'
import { normalizeChatError } from '~~/server/utils/chats/errors'
import { summarizeProviderError } from '~~/server/utils/chats/provider-error-summary'

function apiCallError(statusCode: number, body: unknown, message = 'failed') {
  return {
    name: 'AI_APICallError',
    message,
    statusCode,
    responseBody: typeof body === 'string' ? body : JSON.stringify(body),
  }
}

describe('summarizeProviderError', () => {
  it('reads a Google RESOURCE_EXHAUSTED body', () => {
    const summary = summarizeProviderError(apiCallError(429, {
      error: {
        code: 429,
        message: 'Your project has exceeded its spending cap.',
        status: 'RESOURCE_EXHAUSTED',
      },
    }), 'google')

    expect(summary).toBe(
      'Google returned 429 RESOURCE_EXHAUSTED: '
      + 'Your project has exceeded its spending cap.',
    )
  })

  it('reads an Anthropic overloaded body', () => {
    expect(summarizeProviderError(apiCallError(529, {
      type: 'error',
      error: { type: 'overloaded_error', message: 'Overloaded' },
    }), 'anthropic')).toBe('Anthropic returned 529 overloaded_error: Overloaded')
  })

  it('reads an OpenAI insufficient_quota body', () => {
    expect(summarizeProviderError(apiCallError(429, {
      error: {
        message: 'You exceeded your current quota, please check your plan.',
        type: 'insufficient_quota',
        param: null,
        code: 'insufficient_quota',
      },
    }), 'openai')).toBe(
      'OpenAI returned 429 insufficient_quota: '
      + 'You exceeded your current quota, please check your plan.',
    )
  })

  it('says only the status when the provider sent no body', () => {
    expect(summarizeProviderError(
      { statusCode: 500, message: '' },
      'google',
    )).toBe('Google returned 500')
    expect(summarizeProviderError({ statusCode: 503 })).toBe(
      'The provider returned 503',
    )
  })

  it('ignores a body that is not JSON and falls back to the error message', () => {
    expect(summarizeProviderError(
      apiCallError(500, '<html>oops</html>', 'Internal Server Error'),
      'google',
    )).toBe('Google returned 500: Internal Server Error')
  })

  it('never summarises a status where the text could echo the request', () => {
    expect(summarizeProviderError(apiCallError(400, {
      error: { message: 'Invalid value: \'my secret diary entry\'' },
    }), 'openai')).toBeUndefined()
    expect(summarizeProviderError({ message: 'no status here' }, 'openai'))
      .toBeUndefined()
    expect(summarizeProviderError('a string', 'openai')).toBeUndefined()
  })

  it('removes URLs, key-shaped tokens and key assignments', () => {
    const summary = summarizeProviderError(apiCallError(500, {
      error: {
        message: 'Failed at https://generativelanguage.googleapis.com/v1/m?key=AIzaSyD-1234567890abcdefghijklmnop '
          + 'with api_key: sk-abcdefghijklmnopqrstuv and Bearer abc123token',
        status: 'INTERNAL',
      },
    }), 'google')!

    expect(summary).not.toMatch(/https?:|AIza|sk-|abc123token|googleapis/)
    expect(summary).toContain('Google returned 500 INTERNAL: Failed at')
  })

  it('collapses control characters and caps the line at 160 characters', () => {
    const summary = summarizeProviderError(apiCallError(500, {
      error: { message: `line one\n\nline\ttwo ${'word '.repeat(80)}` },
    }), 'xai')!

    expect(summary.length).toBeLessThanOrEqual(160)
    expect(summary).not.toMatch(/[\n\t]/)
    expect(summary.startsWith('xAI returned 500: line one line two word')).toBe(true)
    expect(summary.endsWith('…')).toBe(true)
  })

  it('ignores a free-text field posing as a code', () => {
    expect(summarizeProviderError(apiCallError(500, {
      error: { status: 'this is a whole sentence with spaces', message: 'x' },
    }), 'google')).toBe('Google returned 500: x')
  })
})

describe('normalizeChatError with a provider body', () => {
  it('puts the Google status and message in the why of a 500', () => {
    const chatError = normalizeChatError({
      error: apiCallError(500, {
        error: { code: 500, message: 'Internal error encountered.', status: 'INTERNAL' },
      }),
      providerId: 'google',
    })

    expect(chatError.code).toBe('provider-unavailable')
    expect(chatError.why).toBe(
      'Google returned 500 INTERNAL: Internal error encountered.',
    )
  })

  it('shows a spend cap on a 429 instead of the generic throttle line', () => {
    const chatError = normalizeChatError({
      error: apiCallError(429, {
        error: { message: 'Quota exceeded for this project.', status: 'RESOURCE_EXHAUSTED' },
      }),
      providerId: 'google',
    })

    expect(chatError.why).toBe(
      'Google returned 429 RESOURCE_EXHAUSTED: Quota exceeded for this project.',
    )
  })

  it('shows the status for an Anthropic and an OpenAI error', () => {
    expect(normalizeChatError({
      error: apiCallError(529, {
        type: 'error',
        error: { type: 'overloaded_error', message: 'Overloaded' },
      }),
      providerId: 'anthropic',
    }).why).toBe('Anthropic returned 529 overloaded_error: Overloaded')
    expect(normalizeChatError({
      error: apiCallError(402, {
        error: { message: 'Insufficient balance', type: 'insufficient_quota' },
      }),
      providerId: 'openai',
    }).why).toBe('OpenAI returned 402 insufficient_quota: Insufficient balance')
  })

  it('keeps the generic copy when there is no status', () => {
    const chatError = normalizeChatError({
      error: new Error('The server had an error while processing your request'),
      providerId: 'openai',
    })

    expect(chatError.code).toBe('provider-unavailable')
    expect(chatError.why).toBe(
      'The upstream model provider returned an internal error.',
    )
  })

  it('does not summarise a rejected key or an explicit why', () => {
    expect(normalizeChatError({
      error: apiCallError(401, { error: { message: 'bad key' } }),
      providerId: 'openai',
    }).why).toBe(
      'The saved API key is missing, invalid, or does not allow this model.',
    )
    expect(normalizeChatError({
      error: apiCallError(500, { error: { message: 'x' } }),
      providerId: 'openai',
      why: 'Because',
    }).why).toBe('Because')
  })
})
