import type { ChatErrorPayload } from '#shared/types/chat-errors.d'

export const TOO_MANY_REQUESTS_MESSAGE
  = 'Too many requests. Wait a moment and try again.'
export const SERVICE_UNAVAILABLE_MESSAGE
  = 'The chat service is unavailable right now. Try again in a moment.'
export const GENERIC_REQUEST_FAILED_MESSAGE = 'The chat request failed.'

const HTTP_TOO_MANY_REQUESTS = 429
const HTTP_SERVER_ERROR_MIN = 500
const HTML_BODY_PATTERN = /^\s*(?:<!doctype html|<html|<head|<body|<\?xml)/i
const HTML_TAG_PATTERN = /<\/?(?:html|head|body|div|title|meta|script)\b/i
const RATE_LIMIT_BODY_PATTERN
  = /error code:?\s*1015|you are being rate limited|too many requests/i

export const GENERATION_RETRY_DELAYS_MS = [4_000, 8_000, 15_000] as const

/**
 * The delay before the `attempt`-th resend (1-based) of a turn that is
 * still generating or whose connection dropped: 4 s, 8 s, then 15 s each,
 * so a long wait costs a handful of requests a minute instead of fifteen.
 */
export function getGenerationRetryDelayMs(attempt: number): number {
  const index = Math.min(
    Math.max(attempt, 1) - 1,
    GENERATION_RETRY_DELAYS_MS.length - 1,
  )

  return GENERATION_RETRY_DELAYS_MS[index]!
}

/**
 * Whether an error text is a markup page (a Cloudflare error page such as
 * 1015 "You are being rate limited", a proxy's 502) rather than a message a
 * person can read.
 */
export function isMarkupErrorText(text: string | undefined): boolean {
  if (!text) {
    return false
  }

  return HTML_BODY_PATTERN.test(text) || HTML_TAG_PATTERN.test(text)
}

export function isRateLimitErrorText(text: string | undefined): boolean {
  return !!text && RATE_LIMIT_BODY_PATTERN.test(text)
}

/**
 * A short readable error for a response whose body is not the app's JSON:
 * never the body itself, which is usually an HTML error page.
 */
export function toReadableRequestError(input: {
  status?: number
  bodyText?: string
  requestId?: string
}): ChatErrorPayload {
  const status = input.status
  const isRateLimited = status === HTTP_TOO_MANY_REQUESTS
    || isRateLimitErrorText(input.bodyText)

  if (isRateLimited) {
    return {
      code: 'unknown',
      message: TOO_MANY_REQUESTS_MESSAGE,
      why: 'The server is limiting how often this browser can send requests.',
      status: HTTP_TOO_MANY_REQUESTS,
      requestId: input.requestId,
    }
  }

  if (status !== undefined && status >= HTTP_SERVER_ERROR_MIN) {
    return {
      code: 'unknown',
      message: SERVICE_UNAVAILABLE_MESSAGE,
      why: `The server answered with status ${status}.`,
      status,
      requestId: input.requestId,
    }
  }

  return {
    code: 'unknown',
    message: GENERIC_REQUEST_FAILED_MESSAGE,
    why: status === undefined
      ? undefined
      : `The server answered with status ${status}.`,
    status,
    requestId: input.requestId,
  }
}

function isJsonResponse(response: Response): boolean {
  const contentType = response.headers.get('content-type') ?? ''

  return contentType.includes('json')
}

/**
 * Passes a successful or JSON response through and turns any other failed
 * response (an HTML error page from Cloudflare or a proxy) into the app's
 * JSON error, so the chat never shows markup as a message.
 */
export async function toReadableErrorResponse(
  response: Response,
  requestId: string | undefined,
): Promise<Response> {
  if (response.ok || isJsonResponse(response)) {
    return response
  }

  let bodyText: string | undefined

  try {
    bodyText = await response.text()
  } catch {
    bodyText = undefined
  }

  const payload = toReadableRequestError({
    status: response.status,
    bodyText,
    requestId,
  })

  return new Response(JSON.stringify(payload), {
    status: response.status,
    statusText: response.statusText,
    headers: { 'content-type': 'application/json' },
  })
}

export interface ClientErrorReportLimiter {
  allow: (key: string, now?: number) => boolean
}

/**
 * Caps the client error reports one page session sends: each distinct
 * error once, at most `maxPerWindow` in `windowMs`, at most
 * `maxPerSession` overall. A retry loop that fails in a burst therefore
 * sends a few reports, never one per attempt (151 in five seconds got the
 * owner rate limited by Cloudflare on 2026-11-21).
 */
export function createClientErrorReportLimiter(options: {
  maxPerWindow: number
  windowMs: number
  maxPerSession: number
}): ClientErrorReportLimiter {
  const reportedKeys = new Set<string>()
  const sentAt: number[] = []
  let sentCount = 0

  return {
    allow(key, now = Date.now()) {
      if (reportedKeys.has(key) || sentCount >= options.maxPerSession) {
        return false
      }

      while (sentAt.length && now - sentAt[0]! >= options.windowMs) {
        sentAt.shift()
      }

      if (sentAt.length >= options.maxPerWindow) {
        return false
      }

      reportedKeys.add(key)
      sentAt.push(now)
      sentCount += 1

      return true
    },
  }
}
