import type { RequestLogger } from 'evlog'
import type { ChatErrorPayload } from '#shared/types/chat-errors.d'
import { streamText, toUIMessageStream } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { describe, expect, it, vi } from 'vitest'
import { normalizeChatError } from '~~/server/utils/chats/errors'
import {
  buildStreamErrorTelemetry,
  recordStreamError,
} from '~~/server/utils/chats/stream-error-telemetry'

const GOOGLE_PROJECT_SPEND_CAP_BODY = {
  error: {
    code: 429,
    message: 'Your project has exceeded its monthly spending cap.',
    status: 'RESOURCE_EXHAUSTED',
  },
}
const PRIVATE_PROMPT = 'my private diary entry'
const FAKE_KEY = 'AIzaSyFakeKeyForTests1234567890abcdef'

function spendCapFetch() {
  const fetcher = vi.fn(async () => {
    return new Response(JSON.stringify(GOOGLE_PROJECT_SPEND_CAP_BODY), {
      status: 429,
      headers: {
        'content-type': 'application/json',
        'retry-after-ms': '0',
      },
    })
  })

  return fetcher
}

async function streamGoogleSendAndCaptureError() {
  const fetcher = spendCapFetch()
  const google = createGoogleGenerativeAI({
    apiKey: FAKE_KEY,
    fetch: fetcher as unknown as typeof fetch,
  })
  const result = streamText({
    model: google('gemini-3.8-flash'),
    prompt: PRIVATE_PROMPT,
  })
  const captured: { error?: unknown, errorText?: string } = {}
  const uiStream = toUIMessageStream({
    stream: result.stream,
    onError(error) {
      captured.error = error

      return JSON.stringify(normalizeChatError({
        error,
        providerId: 'google',
      }))
    },
  })

  for await (const chunk of uiStream) {
    if (chunk.type === 'error') {
      captured.errorText = chunk.errorText
    }
  }

  return { ...captured, fetcher }
}

function fakeLogger() {
  const set = vi.fn()

  return { logger: { set } as unknown as RequestLogger, set }
}

describe('a Google spend cap through the real SDK stream', () => {
  it('reaches the client as a spend cap with the Google line', async () => {
    const {
      error,
      errorText,
      fetcher,
    } = await streamGoogleSendAndCaptureError()
    const chatError = JSON.parse(errorText!) as ChatErrorPayload

    expect(fetcher).toHaveBeenCalledTimes(3)
    expect((error as Error).message).toBe(
      'Failed after 3 attempts. Last error: AI_APICallError: '
      + 'Your project has exceeded its monthly spending cap.',
    )
    expect(chatError).toMatchObject({
      code: 'provider-quota-exceeded',
      status: 429,
      message: 'Your Google API key reached its spend cap.',
      why: 'Google returned 429 RESOURCE_EXHAUSTED: '
        + 'Your project has exceeded its monthly spending cap.',
    })
    expect(chatError.fix).toContain('aistudio.google.com/spend')
  })

  it('records the code, provider status and summary on the wide event', async () => {
    const { error, errorText } = await streamGoogleSendAndCaptureError()
    const chatError = JSON.parse(errorText!) as ChatErrorPayload
    const { logger, set } = fakeLogger()

    recordStreamError({
      chatError,
      error,
      stage: 'stream',
      providerId: 'google',
    }, logger)

    expect(set).toHaveBeenCalledWith({
      errorCode: 'provider-quota-exceeded',
      attributes: {
        streamError: {
          stage: 'stream',
          code: 'provider-quota-exceeded',
          status: 429,
          providerStatus: 429,
          providerCode: 'RESOURCE_EXHAUSTED',
          attempts: 3,
          summary: 'Google returned 429 RESOURCE_EXHAUSTED: '
            + 'Your project has exceeded its monthly spending cap.',
        },
      },
    })

    const logged = JSON.stringify(set.mock.calls)

    expect(logged).not.toContain(PRIVATE_PROMPT)
    expect(logged).not.toContain(FAKE_KEY)
    expect(logged).not.toContain('googleapis')
  })
})

describe('buildStreamErrorTelemetry', () => {
  it('records only the chat error for a failure Besidka raised itself', () => {
    const chatError = normalizeChatError({
      error: new Error('assistant-empty-answer'),
      code: 'assistant-empty-answer',
    })

    expect(buildStreamErrorTelemetry({
      chatError,
      error: undefined,
      stage: 'assistant-empty-answer',
    })).toEqual({
      stage: 'assistant-empty-answer',
      code: 'assistant-empty-answer',
      status: 500,
    })
  })

  it('keeps the provider status of a 400 but no summary', () => {
    const error = {
      statusCode: 400,
      message: `Invalid value: '${PRIVATE_PROMPT}'`,
      responseBody: JSON.stringify({
        error: {
          message: `Invalid value: '${PRIVATE_PROMPT}'`,
          status: 'INVALID_ARGUMENT',
        },
      }),
    }
    const telemetry = buildStreamErrorTelemetry({
      chatError: normalizeChatError({ error, providerId: 'google' }),
      error,
      stage: 'stream',
      providerId: 'google',
    })

    expect(telemetry).toMatchObject({
      providerStatus: 400,
      providerCode: 'INVALID_ARGUMENT',
    })
    expect(telemetry.summary).toBeUndefined()
  })
})
