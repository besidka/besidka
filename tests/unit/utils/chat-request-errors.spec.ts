import { describe, expect, it } from 'vitest'
import {
  GENERIC_REQUEST_FAILED_MESSAGE,
  SERVICE_UNAVAILABLE_MESSAGE,
  TOO_MANY_REQUESTS_MESSAGE,
  createClientErrorReportLimiter,
  getGenerationRetryDelayMs,
  isMarkupErrorText,
  toReadableErrorResponse,
  toReadableRequestError,
} from '~/utils/chat-request-errors'

const CLOUDFLARE_1015_PAGE = '<!DOCTYPE html><html lang="en-US"><head>'
  + '<title>Access denied | besidka.com used Cloudflare to restrict access'
  + '</title></head><body><h1>Error 1015</h1><h2>You are being rate limited'
  + '</h2></body></html>'

describe('getGenerationRetryDelayMs', () => {
  it('backs off from 4 s to 8 s and then stays at 15 s', () => {
    expect([1, 2, 3, 4, 40].map(getGenerationRetryDelayMs))
      .toEqual([4_000, 8_000, 15_000, 15_000, 15_000])
    expect(getGenerationRetryDelayMs(0)).toBe(4_000)
  })
})

describe('isMarkupErrorText', () => {
  it('recognizes an HTML error page and leaves plain text alone', () => {
    expect(isMarkupErrorText(CLOUDFLARE_1015_PAGE)).toBe(true)
    expect(isMarkupErrorText('  <html><body>Bad gateway</body></html>'))
      .toBe(true)
    expect(isMarkupErrorText('The chat request failed.')).toBe(false)
    expect(isMarkupErrorText('Use a < b in the formula')).toBe(false)
    expect(isMarkupErrorText(undefined)).toBe(false)
  })
})

describe('toReadableRequestError', () => {
  it('turns a 429 or a Cloudflare 1015 page into the rate limit copy', () => {
    expect(toReadableRequestError({ status: 429 }).message)
      .toBe(TOO_MANY_REQUESTS_MESSAGE)
    expect(toReadableRequestError({
      status: 403,
      bodyText: CLOUDFLARE_1015_PAGE,
    })).toEqual(expect.objectContaining({
      message: TOO_MANY_REQUESTS_MESSAGE,
      status: 429,
    }))
  })

  it('uses short copy for server and other errors, never the body', () => {
    const serverError = toReadableRequestError({
      status: 502,
      bodyText: '<html><body>Bad gateway</body></html>',
    })
    const otherError = toReadableRequestError({ status: 404 })

    expect(serverError.message).toBe(SERVICE_UNAVAILABLE_MESSAGE)
    expect(JSON.stringify(serverError)).not.toContain('<html')
    expect(otherError).toEqual(expect.objectContaining({
      message: GENERIC_REQUEST_FAILED_MESSAGE,
      why: 'The server answered with status 404.',
    }))
  })
})

describe('toReadableErrorResponse', () => {
  it('passes successful and JSON responses through untouched', async () => {
    const ok = new Response('data: {}', { status: 200 })
    const json = new Response('{"code":"unknown","message":"Nope"}', {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })

    expect(await toReadableErrorResponse(ok, 'ray-1')).toBe(ok)
    expect(await toReadableErrorResponse(json, 'ray-1')).toBe(json)
  })

  it('replaces an HTML error page with the app JSON error', async () => {
    const response = new Response(CLOUDFLARE_1015_PAGE, {
      status: 429,
      headers: { 'content-type': 'text/html; charset=UTF-8' },
    })
    const readable = await toReadableErrorResponse(response, 'ray-1')
    const body = await readable.json()

    expect(readable.status).toBe(429)
    expect(body).toEqual(expect.objectContaining({
      code: 'unknown',
      message: TOO_MANY_REQUESTS_MESSAGE,
      requestId: 'ray-1',
    }))
  })
})

describe('createClientErrorReportLimiter', () => {
  function createLimiter() {
    return createClientErrorReportLimiter({
      maxPerWindow: 3,
      windowMs: 60_000,
      maxPerSession: 5,
    })
  }

  it('reports each distinct error once', () => {
    const limiter = createLimiter()

    expect(limiter.allow('load-failed', 0)).toBe(true)
    expect(Array.from({ length: 150 }, () => limiter.allow('load-failed', 1)))
      .not.toContain(true)
  })

  it('caps a burst per minute and a page session overall', () => {
    const limiter = createLimiter()
    const burst = Array.from({ length: 151 }, (_value, index) => {
      return limiter.allow(`error-${index}`, index * 30)
    })

    expect(burst.filter(Boolean)).toHaveLength(3)
    expect(limiter.allow('later-1', 60_000)).toBe(true)
    expect(limiter.allow('later-2', 61_000)).toBe(true)
    expect(limiter.allow('later-3', 200_000)).toBe(false)
  })
})
