import { describe, expect, it } from 'vitest'
import { APICallError, RetryError } from 'ai'
import { normalizeChatError } from '~~/server/utils/chats/errors'
import {
  readProviderErrorDetails,
  summarizeProviderError,
  unwrapRetryError,
} from '~~/server/utils/chats/provider-error-summary'

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

  it('never summarizes a status where the text could echo the request', () => {
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

  it('shows a quota 429 instead of the generic throttle line', () => {
    const chatError = normalizeChatError({
      error: apiCallError(429, {
        error: { message: 'Quota exceeded for this project.', status: 'RESOURCE_EXHAUSTED' },
      }, 'Quota exceeded for this project.'),
      providerId: 'google',
    })

    expect(chatError.code).toBe('provider-quota-exceeded')
    expect(chatError.message).toBe('The provider quota has been exceeded.')
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

  it('does not summarize a rejected key or an explicit why', () => {
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

const GOOGLE_PROJECT_SPEND_CAP_BODY = {
  error: {
    code: 429,
    message: 'Your project has exceeded its monthly spending cap.',
    status: 'RESOURCE_EXHAUSTED',
  },
}
const GOOGLE_BILLING_ACCOUNT_SPEND_CAP_BODY = {
  error: {
    code: 429,
    message: 'Your billing account has exceeded its monthly spending cap.',
    status: 'RESOURCE_EXHAUSTED',
  },
}
const ANTHROPIC_CREDIT_BALANCE_BODY = {
  type: 'error',
  error: {
    type: 'invalid_request_error',
    message: 'Your credit balance is too low to access the Anthropic API.'
      + ' Please go to Plans & Billing to upgrade or purchase credits.',
  },
}

function googleApiCallError(
  statusCode: number,
  body: { error: { message: string } },
) {
  return new APICallError({
    message: body.error.message,
    url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse',
    requestBodyValues: { contents: [{ role: 'user', parts: [{ text: 'private prompt' }] }] },
    statusCode,
    responseHeaders: { 'content-type': 'application/json' },
    responseBody: JSON.stringify(body),
  })
}

function retriedThreeTimes(lastError: APICallError): RetryError {
  return new RetryError({
    message: `Failed after 3 attempts. Last error: ${lastError.message}`,
    reason: 'maxRetriesExceeded',
    errors: [lastError, lastError, lastError],
  })
}

describe('provider errors the SDK retried', () => {
  it('reads the status and body of the last attempt', () => {
    const lastError = googleApiCallError(429, GOOGLE_PROJECT_SPEND_CAP_BODY)
    const retryError = retriedThreeTimes(lastError)

    expect(unwrapRetryError(retryError)).toBe(lastError)
    expect(summarizeProviderError(retryError, 'google')).toBe(
      'Google returned 429 RESOURCE_EXHAUSTED: '
      + 'Your project has exceeded its monthly spending cap.',
    )
    expect(readProviderErrorDetails(retryError)).toEqual({
      status: 429,
      code: 'RESOURCE_EXHAUSTED',
      attempts: 3,
    })
  })

  it('keeps a retried 500 as provider-unavailable with the Google line', () => {
    const chatError = normalizeChatError({
      error: retriedThreeTimes(googleApiCallError(500, {
        error: { message: 'Internal error encountered.' },
      })),
      providerId: 'google',
    })

    expect(chatError.code).toBe('provider-unavailable')
    expect(chatError.status).toBe(500)
    expect(chatError.why).toBe('Google returned 500: Internal error encountered.')
  })

  it('reads only codes and numbers for a 400, never the message', () => {
    expect(readProviderErrorDetails(googleApiCallError(400, {
      error: { message: 'Invalid value: \'my secret diary entry\'' },
    }))).toEqual({ status: 400 })
    expect(readProviderErrorDetails('a string')).toEqual({})
  })
})

describe('billing limits', () => {
  it('classifies a retried Google project spend cap', () => {
    const chatError = normalizeChatError({
      error: retriedThreeTimes(
        googleApiCallError(429, GOOGLE_PROJECT_SPEND_CAP_BODY),
      ),
      providerId: 'google',
    })

    expect(chatError).toMatchObject({
      code: 'provider-quota-exceeded',
      status: 429,
      message: 'Your Google API key reached its spend cap.',
      why: 'Google returned 429 RESOURCE_EXHAUSTED: '
        + 'Your project has exceeded its monthly spending cap.',
      fix: 'Raise or remove the monthly spend cap on the Spend page in Google'
        + ' AI Studio (aistudio.google.com/spend). A billing account cap'
        + ' resets on the 1st of the month.',
    })
  })

  it('classifies a Google billing account spend cap without a retry', () => {
    const chatError = normalizeChatError({
      error: googleApiCallError(429, GOOGLE_BILLING_ACCOUNT_SPEND_CAP_BODY),
      providerId: 'google',
    })

    expect(chatError.code).toBe('provider-quota-exceeded')
    expect(chatError.message).toBe('Your Google API key reached its spend cap.')
    expect(chatError.why).toContain('billing account has exceeded')
  })

  it('names a spend cap without Google copy for another provider', () => {
    const chatError = normalizeChatError({
      error: apiCallError(429, {
        error: { message: 'Your organization reached its monthly spend cap.' },
      }, 'Your organization reached its monthly spend cap.'),
      providerId: 'openrouter',
    })

    expect(chatError.message).toBe(
      'Your OpenRouter API key reached its spend cap.',
    )
    expect(chatError.fix).not.toContain('aistudio')
  })

  it('classifies an Anthropic credit balance 400 without echoing it', () => {
    const chatError = normalizeChatError({
      error: apiCallError(
        400,
        ANTHROPIC_CREDIT_BALANCE_BODY,
        ANTHROPIC_CREDIT_BALANCE_BODY.error.message,
      ),
      providerId: 'anthropic',
    })

    expect(chatError).toMatchObject({
      code: 'provider-quota-exceeded',
      status: 400,
      message: 'Your Anthropic account is out of credits.',
      why: 'The saved API key does not have enough remaining quota.',
      fix: 'Add credits in your provider\'s billing settings, or switch to a'
        + ' different saved key.',
    })
  })

  it('keeps OpenAI insufficient_quota and a plain 429 as before', () => {
    expect(normalizeChatError({
      error: apiCallError(429, {
        error: {
          message: 'You exceeded your current quota, please check your plan.',
          type: 'insufficient_quota',
          code: 'insufficient_quota',
        },
      }, 'You exceeded your current quota, please check your plan.'),
      providerId: 'openai',
    })).toMatchObject({
      code: 'provider-quota-exceeded',
      message: 'The provider quota has been exceeded.',
    })
    expect(normalizeChatError({
      error: apiCallError(429, { error: { message: 'Too many requests' } }),
      providerId: 'google',
    }).code).toBe('provider-rate-limit')
  })
})
