import { createError } from 'evlog'
import {
  CONNECTOR_REJECTED_HEADER_NAMES,
  SAFE_FETCH_DEFAULT_TIMEOUT_MS,
  SAFE_FETCH_MAX_REDIRECTS,
  SAFE_FETCH_OAUTH_MAX_BYTES,
  SAFE_FETCH_REGISTRY_MAX_BYTES,
  CONNECTOR_CALL_TIMEOUT_MS,
  CONNECTOR_RESPONSE_MAX_BYTES,
  REGISTRY_FETCH_TIMEOUT_MS,
  SAFE_FETCH_CONNECTORS_USER_AGENT,
  SAFE_FETCH_SKILLS_USER_AGENT,
} from '#shared/utils/connectors-policy'
import { SKILL_MAX_GITHUB_ARCHIVE_BYTES } from '#shared/utils/skills-policy'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { parseSafeOutboundUrl } from '~~/server/utils/net/safe-url'
import type { SafeUrlRejection } from '~~/server/utils/net/safe-url'

export const SAFE_FETCH_PURPOSES = [
  'mcp',
  'oauth',
  'registry',
  'skills-github',
  'skills-url',
] as const

export type SafeFetchPurpose = typeof SAFE_FETCH_PURPOSES[number]

export type SafeFetchRedirectPolicy = 'none' | 'same-origin' | 'validated'

export interface SafeFetchPurposePolicy {
  redirects: SafeFetchRedirectPolicy
  timeoutMs: number
  maxResponseBytes: number
  userAgent: string
}

const SKILLS_URL_MAX_BYTES = 256 * 1024
const SKILLS_GITHUB_TIMEOUT_MS = 30 * 1000

export const SAFE_FETCH_PURPOSE_POLICY: Readonly<
  Record<SafeFetchPurpose, SafeFetchPurposePolicy>
> = {
  'mcp': {
    redirects: 'same-origin',
    timeoutMs: CONNECTOR_CALL_TIMEOUT_MS,
    maxResponseBytes: CONNECTOR_RESPONSE_MAX_BYTES,
    userAgent: SAFE_FETCH_CONNECTORS_USER_AGENT,
  },
  'oauth': {
    redirects: 'validated',
    timeoutMs: SAFE_FETCH_DEFAULT_TIMEOUT_MS,
    maxResponseBytes: SAFE_FETCH_OAUTH_MAX_BYTES,
    userAgent: SAFE_FETCH_CONNECTORS_USER_AGENT,
  },
  'registry': {
    redirects: 'validated',
    timeoutMs: REGISTRY_FETCH_TIMEOUT_MS,
    maxResponseBytes: SAFE_FETCH_REGISTRY_MAX_BYTES,
    userAgent: SAFE_FETCH_CONNECTORS_USER_AGENT,
  },
  'skills-github': {
    redirects: 'none',
    timeoutMs: SKILLS_GITHUB_TIMEOUT_MS,
    maxResponseBytes: SKILL_MAX_GITHUB_ARCHIVE_BYTES,
    userAgent: SAFE_FETCH_SKILLS_USER_AGENT,
  },
  'skills-url': {
    redirects: 'validated',
    timeoutMs: SAFE_FETCH_DEFAULT_TIMEOUT_MS,
    maxResponseBytes: SKILLS_URL_MAX_BYTES,
    userAgent: SAFE_FETCH_SKILLS_USER_AGENT,
  },
}

export interface SafeFetchInit extends RequestInit {
  purpose: SafeFetchPurpose
  maxRedirects?: number
  timeoutMs?: number
  maxResponseBytes?: number
  logger?: LoggerLike
}

export type SafeFetchOptions = Pick<
  SafeFetchInit,
  'maxRedirects' | 'timeoutMs' | 'maxResponseBytes' | 'logger'
>

const REDIRECT_STATUSES: ReadonlySet<number> = new Set([
  301,
  302,
  303,
  307,
  308,
])
const CROSS_ORIGIN_HEADER_SAFELIST: ReadonlySet<string> = new Set([
  'accept',
  'accept-language',
  'content-language',
])
const BODY_HEADERS: readonly string[] = [
  'content-type',
  'content-length',
  'content-encoding',
  'content-language',
  'content-location',
]
const MCP_TRANSPORT_HEADERS: ReadonlySet<string> = new Set([
  'mcp-session-id',
  'mcp-protocol-version',
])
const MAX_LOGGED_HOST_LENGTH = 253

const REJECTION_WHY: Readonly<Record<SafeUrlRejection, string>> = {
  'length': 'The address is too long',
  'characters': 'The address has spaces or control characters',
  'invalid': 'The address is not a valid URL',
  'scheme': 'Only https addresses are allowed',
  'credentials': 'The address contains a user name or password',
  'ip-literal': 'The address is an IP number, not a host name',
  'special-name': 'The host name is local or private',
  'own-host': 'The address points back to Besidka',
  'port': 'Only the ports 443 and 8443 are allowed',
  'path': 'The address must not have a path',
}

function describeHost(url: URL | null): string | null {
  return url ? url.hostname.slice(0, MAX_LOGGED_HOST_LENGTH) : null
}

function createRejectedError(reason: SafeUrlRejection) {
  return createError({
    message: 'This address is not allowed',
    status: 400,
    code: `safe-fetch-${reason}`,
    why: REJECTION_WHY[reason],
    fix: 'Use a public https address with a host name',
  })
}

function validateOrThrow(input: string): URL {
  const result = parseSafeOutboundUrl(input)

  if (!result.ok) {
    throw createRejectedError(result.reason)
  }

  return result.url
}

function createOriginChangedError() {
  return createError({
    message: 'The server moved to another address',
    status: 400,
    code: 'CONNECTOR_ORIGIN_CHANGED',
    why: 'The server answered with a redirect to a different origin, which '
      + 'is never followed',
    fix: 'Edit the connector address to the new one',
  })
}

function createRedirectRefusedError() {
  return createError({
    message: 'The server answered with a redirect',
    status: 502,
    code: 'safe-fetch-redirect-refused',
    why: 'Redirects are never followed for this kind of request',
    fix: 'Use the final address of the server',
  })
}

function createTooManyRedirectsError() {
  return createError({
    message: 'The server redirected too many times',
    status: 502,
    code: 'safe-fetch-redirects',
    why: 'The redirect limit was reached',
    fix: 'Use the final address of the server',
  })
}

function createTooLargeError(maxBytes: number) {
  return createError({
    message: 'The server answered with too much data',
    status: 502,
    code: 'safe-fetch-too-large',
    why: `The response is larger than ${maxBytes} bytes`,
    fix: 'Try again later or use a different server',
  })
}

function createUnrepeatableError() {
  return createError({
    message: 'The server redirected a request that cannot be repeated',
    status: 502,
    code: 'safe-fetch-unrepeatable',
    why: 'The request body is a stream, which cannot be sent twice',
    fix: 'Use the final address of the server',
  })
}

function createTimeoutError(timeoutMs: number) {
  return createError({
    message: 'The server did not answer in time',
    status: 504,
    code: 'safe-fetch-timeout',
    why: `No complete answer arrived within ${timeoutMs} ms`,
    fix: 'Try again later',
  })
}

const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,39}$/

function describeNetworkFailure(exception: unknown): string {
  if (!(exception instanceof Error)) {
    return 'Unknown'
  }

  const cause = exception.cause as { code?: unknown } | undefined
  const rawCode = (exception as { code?: unknown }).code ?? cause?.code
  const code = typeof rawCode === 'string' && ERROR_CODE_PATTERN.test(rawCode)
    ? rawCode
    : null

  return code ? `${exception.name} ${code}` : exception.name
}

function createNetworkError(exception: unknown) {
  return createError({
    message: 'The server could not be reached',
    status: 502,
    code: 'safe-fetch-network',
    why: `The connection failed (${describeNetworkFailure(exception)})`,
    fix: 'Check the address and try again',
  })
}

function isRedirect(response: Response): boolean {
  return REDIRECT_STATUSES.has(response.status)
    && response.headers.has('location')
}

function isStreamBody(body: unknown): boolean {
  return typeof ReadableStream !== 'undefined'
    && body instanceof ReadableStream
}

function isRejectedHeader(lowerName: string, purpose: SafeFetchPurpose) {
  if (!CONNECTOR_REJECTED_HEADER_NAMES.includes(lowerName)) {
    return false
  }

  return !(purpose === 'mcp' && MCP_TRANSPORT_HEADERS.has(lowerName))
}

function buildHopHeaders(
  base: Headers,
  purpose: SafeFetchPurpose,
  options: { crossOrigin: boolean, dropBody: boolean },
): Headers {
  const headers = new Headers()

  for (const [name, value] of base) {
    const lowerName = name.toLowerCase()

    if (isRejectedHeader(lowerName, purpose)) {
      continue
    }

    if (options.crossOrigin && !CROSS_ORIGIN_HEADER_SAFELIST.has(lowerName)) {
      continue
    }

    if (options.dropBody && BODY_HEADERS.includes(lowerName)) {
      continue
    }

    headers.set(name, value)
  }

  headers.set('user-agent', SAFE_FETCH_PURPOSE_POLICY[purpose].userAgent)

  return headers
}

function nextMethod(status: number, method: string): string {
  if (status === 303 && method !== 'HEAD') {
    return 'GET'
  }

  if ((status === 301 || status === 302) && method === 'POST') {
    return 'GET'
  }

  return method
}

function mergeSignals(
  deadline: AbortController,
  callerSignal: AbortSignal | null | undefined,
): () => void {
  if (!callerSignal) {
    return () => undefined
  }

  if (callerSignal.aborted) {
    deadline.abort(callerSignal.reason)

    return () => undefined
  }

  const forward = () => {
    deadline.abort(callerSignal.reason)
  }

  callerSignal.addEventListener('abort', forward, { once: true })

  return () => {
    callerSignal.removeEventListener('abort', forward)
  }
}

function capResponseBody(
  response: Response,
  context: {
    finalUrl: URL
    maxBytes: number
    controller: AbortController
    release: () => void
    timeoutError: Error
    timeoutMs: number
    onComplete: (bytes: number) => void
  },
): Response {
  const declaredLength = Number(response.headers.get('content-length'))
  const isEncoded = response.headers.has('content-encoding')

  if (
    !isEncoded
    && Number.isFinite(declaredLength)
    && declaredLength > context.maxBytes
  ) {
    context.controller.abort()
    context.release()
    response.body?.cancel().catch(() => undefined)

    throw createTooLargeError(context.maxBytes)
  }

  const headers = new Headers(response.headers)

  headers.delete('content-length')
  headers.delete('content-encoding')

  if (!response.body) {
    context.release()
    context.onComplete(0)

    return decorate(
      new Response(null, {
        status: response.status,
        statusText: response.statusText,
        headers,
      }),
      context.finalUrl,
    )
  }

  const reader = response.body.getReader()
  let total = 0

  const stream = new ReadableStream<Uint8Array>({
    async pull(streamController) {
      try {
        const { done, value } = await reader.read()

        if (done) {
          context.release()
          context.onComplete(total)
          streamController.close()

          return
        }

        total += value.byteLength

        if (total > context.maxBytes) {
          context.controller.abort()
          context.release()
          await reader.cancel().catch(() => undefined)
          streamController.error(createTooLargeError(context.maxBytes))

          return
        }

        streamController.enqueue(value)
      } catch (exception) {
        context.release()
        streamController.error(
          context.controller.signal.reason === context.timeoutError
            ? createTimeoutError(context.timeoutMs)
            : exception,
        )
      }
    },
    async cancel(reason) {
      context.release()
      context.controller.abort()
      await reader.cancel(reason).catch(() => undefined)
    },
  })

  return decorate(
    new Response(stream, {
      status: response.status,
      statusText: response.statusText,
      headers,
    }),
    context.finalUrl,
  )
}

function decorate(response: Response, finalUrl: URL): Response {
  Object.defineProperty(response, 'url', { value: finalUrl.toString() })

  return response
}

async function resolveRequest(
  input: string | URL | Request,
  init: SafeFetchInit,
): Promise<{
  url: string
  method: string
  headers: Headers
  body: BodyInit | null | undefined
}> {
  if (input instanceof Request) {
    const method = init.method ?? input.method
    const headers = new Headers(input.headers)

    for (const [name, value] of new Headers(init.headers)) {
      headers.set(name, value)
    }

    const hasBody = method !== 'GET' && method !== 'HEAD'
    const body = init.body !== undefined
      ? init.body
      : hasBody && input.body
        ? await input.clone().arrayBuffer()
        : undefined

    return { url: input.url, method, headers, body }
  }

  return {
    url: input.toString(),
    method: init.method ?? 'GET',
    headers: new Headers(init.headers),
    body: init.body,
  }
}

/**
 * Fetch for every URL a user, a model or a remote server chose. Each hop,
 * the first included, runs through `parseSafeOutboundUrl`; redirects are
 * followed by hand (`redirect: 'manual'`, because workerd throws on
 * `redirect: 'error'`) up to a hop limit; the `mcp` purpose never leaves the
 * origin. A hop to another origin keeps only a few harmless headers, so no
 * credential in any header (an `Authorization` or a connector's own header
 * name) crosses origins, and it drops the body and becomes a GET. Cookies are
 * never forwarded. One deadline covers the headers and the whole body, and
 * the body is counted as it streams, so a cap stops a transfer early rather
 * than after buffering.
 *
 * This guard cannot see DNS: Workers neither pin a resolution nor expose the
 * resolved address, so a public name that resolves to a private address
 * passes here. See docs/connectors.md section 4.5.
 */
export async function safeFetch(
  input: string | URL | Request,
  init: SafeFetchInit,
): Promise<Response> {
  const purposePolicy = SAFE_FETCH_PURPOSE_POLICY[init.purpose]
  const maxRedirects = init.maxRedirects ?? SAFE_FETCH_MAX_REDIRECTS
  const timeoutMs = init.timeoutMs ?? purposePolicy.timeoutMs
  const maxBytes = init.maxResponseBytes ?? purposePolicy.maxResponseBytes
  const request = await resolveRequest(input, init)
  const controller = new AbortController()
  const timeoutError = new Error('safe-fetch timeout')
  const timer = setTimeout(() => {
    controller.abort(timeoutError)
  }, timeoutMs)
  const detachCaller = mergeSignals(controller, init.signal)
  const release = () => {
    clearTimeout(timer)
    detachCaller()
  }

  let currentUrl: URL | null = null
  let method = request.method
  let headers = request.headers
  let body = request.body
  let redirects = 0

  try {
    for (;;) {
      try {
        currentUrl = validateOrThrow(
          currentUrl === null
            ? request.url
            : currentUrl.toString(),
        )
      } catch (exception) {
        init.logger?.set({
          attributes: {
            net: {
              purpose: init.purpose,
              host: describeHost(currentUrl),
              rejected: true,
              redirects,
            },
          },
        })

        throw exception
      }

      let response: Response

      try {
        response = await fetch(currentUrl.toString(), {
          method,
          headers: buildHopHeaders(headers, init.purpose, {
            crossOrigin: false,
            dropBody: false,
          }),
          body: body ?? undefined,
          redirect: 'manual',
          signal: controller.signal,
        })
      } catch (exception) {
        if (controller.signal.reason === timeoutError) {
          throw createTimeoutError(timeoutMs)
        }

        if (init.signal?.aborted) {
          throw exception
        }

        throw createNetworkError(exception)
      }

      if (!isRedirect(response)) {
        init.logger?.set({
          attributes: {
            net: {
              purpose: init.purpose,
              host: currentUrl.hostname,
              status: response.status,
              redirects,
            },
          },
        })

        return capResponseBody(response, {
          finalUrl: currentUrl,
          maxBytes,
          controller,
          release,
          timeoutError,
          timeoutMs,
          onComplete(bytes) {
            init.logger?.set({
              attributes: { net: { responseBytes: bytes } },
            })
          },
        })
      }

      await response.body?.cancel().catch(() => undefined)

      if (purposePolicy.redirects === 'none') {
        throw createRedirectRefusedError()
      }

      if (redirects >= maxRedirects) {
        throw createTooManyRedirectsError()
      }

      let nextUrl: URL

      try {
        nextUrl = new URL(response.headers.get('location')!, currentUrl)
      } catch {
        throw createRejectedError('invalid')
      }

      const isCrossOrigin = nextUrl.origin !== currentUrl.origin

      if (isCrossOrigin && purposePolicy.redirects === 'same-origin') {
        throw createOriginChangedError()
      }

      if (
        (response.status === 307 || response.status === 308)
        && !isCrossOrigin
        && isStreamBody(body)
      ) {
        throw createUnrepeatableError()
      }

      const redirectedMethod = nextMethod(response.status, method)
      const keepsBody = redirectedMethod === method && !isCrossOrigin

      method = isCrossOrigin && method !== 'HEAD' ? 'GET' : redirectedMethod
      body = keepsBody ? body : undefined
      headers = buildHopHeaders(headers, init.purpose, {
        crossOrigin: isCrossOrigin,
        dropBody: body === undefined,
      })
      currentUrl = nextUrl
      redirects += 1
    }
  } catch (exception) {
    release()

    throw exception
  }
}

/**
 * A `fetch` bound to a purpose, for libraries that take a `fetch` option:
 * the MCP SDK auth helpers (`fetchFn`) and the `@ai-sdk/mcp` transport.
 */
export function createSafeFetch(
  purpose: SafeFetchPurpose,
  options: SafeFetchOptions = {},
): typeof fetch {
  return ((input: string | URL | Request, init?: RequestInit) => {
    return safeFetch(input, { ...options, ...init, purpose })
  }) as typeof fetch
}
