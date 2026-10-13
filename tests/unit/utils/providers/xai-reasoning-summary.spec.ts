import { describe, expect, it, vi } from 'vitest'
import {
  addXaiReasoningSummary,
  withXaiReasoningSummary,
} from '../../../../server/utils/providers/xai-reasoning-summary'

const RESPONSES_URL = 'https://api.x.ai/v1/responses'

function createFetchSpy() {
  return vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
    return new Response('{}')
  })
}

function readForwardedBody(fetchSpy: ReturnType<typeof createFetchSpy>) {
  return JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))
}

describe('addXaiReasoningSummary', () => {
  it('creates a reasoning object when the SDK sent none', () => {
    const body = addXaiReasoningSummary(JSON.stringify({ model: 'grok' }))

    expect(JSON.parse(body)).toEqual({
      model: 'grok',
      reasoning: { summary: 'detailed' },
    })
  })

  it('merges the summary into an existing effort', () => {
    const body = addXaiReasoningSummary(JSON.stringify({
      reasoning: { effort: 'low' },
    }))

    expect(JSON.parse(body).reasoning).toEqual({
      effort: 'low',
      summary: 'detailed',
    })
  })

  it('replaces a null reasoning value', () => {
    const body = addXaiReasoningSummary(JSON.stringify({ reasoning: null }))

    expect(JSON.parse(body).reasoning).toEqual({ summary: 'detailed' })
  })

  it('keeps an explicit summary sent by the SDK', () => {
    const body = addXaiReasoningSummary(JSON.stringify({
      reasoning: { summary: 'concise' },
    }))

    expect(JSON.parse(body).reasoning).toEqual({ summary: 'concise' })
  })

  it.each(['not json', '[1,2]', 'null'])(
    'passes a non-object body through untouched: %s',
    (rawBody) => {
      expect(addXaiReasoningSummary(rawBody)).toBe(rawBody)
    },
  )
})

describe('withXaiReasoningSummary', () => {
  it('rewrites the body of a POST to the responses endpoint', async () => {
    const fetchSpy = createFetchSpy()
    const headers = { 'x-grok-conv-id': 'chat-slug' }

    await withXaiReasoningSummary(fetchSpy)(RESPONSES_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: 'grok-4.20-0309-reasoning' }),
    })

    expect(fetchSpy.mock.calls[0]?.[0]).toBe(RESPONSES_URL)
    expect(fetchSpy.mock.calls[0]?.[1]?.headers).toBe(headers)
    expect(readForwardedBody(fetchSpy).reasoning).toEqual({
      summary: 'detailed',
    })
  })

  it('accepts URL and Request inputs', async () => {
    const fetchSpy = createFetchSpy()
    const shimmedFetch = withXaiReasoningSummary(fetchSpy)
    const init = { method: 'POST', body: '{}' }

    await shimmedFetch(new URL(RESPONSES_URL), init)
    await shimmedFetch(new Request(RESPONSES_URL, { method: 'POST' }), init)

    for (const [, forwardedInit] of fetchSpy.mock.calls) {
      expect(JSON.parse(String(forwardedInit?.body))).toEqual({
        reasoning: { summary: 'detailed' },
      })
    }
  })

  it.each([
    ['a non-responses endpoint', 'https://api.x.ai/v1/images/generations',
      { method: 'POST', body: '{}' }],
    ['a GET request', RESPONSES_URL, { method: 'GET' }],
    ['a non-string body', RESPONSES_URL,
      { method: 'POST', body: new Uint8Array([123, 125]) }],
  ])('leaves %s untouched', async (_label, url, init) => {
    const fetchSpy = createFetchSpy()

    await withXaiReasoningSummary(fetchSpy)(url, init)

    expect(fetchSpy).toHaveBeenCalledWith(url, init)
  })

  it('leaves a request without init untouched', async () => {
    const fetchSpy = createFetchSpy()

    await withXaiReasoningSummary(fetchSpy)(RESPONSES_URL)

    expect(fetchSpy).toHaveBeenCalledWith(RESPONSES_URL, undefined)
  })
})
