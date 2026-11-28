import { createError } from 'evlog'
import {
  GOOGLE_DOWNLOAD_TIMEOUT_MS,
  GOOGLE_FETCH_HOSTS,
  assertGoogleUrl,
  cancelBody,
  isRedirect,
  linkSignals,
  parseJsonObject,
  readCappedText,
  redirectRefused,
  timedOut,
  unreachable,
} from '~~/server/utils/google/http'
import type { GoogleFetchImplementation } from '~~/server/utils/google/http'

export const GOOGLE_DOWNLOAD_TOO_LARGE_CODE = 'google_download_too_large'

const MAX_DOWNLOAD_REDIRECTS = 1
const ERROR_BODY_MAX_BYTES = 16 * 1024
const GOOGLEUSERCONTENT_HOST_PATTERN
  = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.googleusercontent\.com$/

export interface GoogleDownloadRequest {
  headers?: Record<string, string>
  signal?: AbortSignal
}

export interface GoogleDownloadOptions {
  maxBytes: number
  fetchImpl?: GoogleFetchImplementation
  timeoutMs?: number
}

export type GoogleDownloadResult
  = | { ok: true, bytes: Uint8Array, contentType: string | null }
    | { ok: false, status: number, reason: string | null }

function downloadTooLarge(maxBytes: number) {
  return createError({
    message: 'Google file too large',
    status: 413,
    code: GOOGLE_DOWNLOAD_TOO_LARGE_CODE,
    why: `The file is larger than ${maxBytes} bytes`,
    fix: 'Pick a smaller file',
  })
}

interface RedirectTarget {
  url: URL
  keepsAuthorization: boolean
}

/**
 * A download redirect may only go one hop, to HTTPS on a Google API host
 * (the bearer token stays) or on a `*.googleusercontent.com` host (the
 * token and the resource-key header are dropped: such URLs carry their own
 * authorization, and neither credential may reach a content host).
 * Anything else is refused.
 */
function resolveRedirectTarget(
  location: string,
  from: URL,
): RedirectTarget {
  let target: URL

  try {
    target = new URL(location, from)
  } catch {
    throw redirectRefused()
  }

  const isPlainHttps = target.protocol === 'https:'
    && !target.username
    && !target.password
    && !target.port

  if (!isPlainHttps) {
    throw redirectRefused()
  }

  if (GOOGLE_FETCH_HOSTS.has(target.hostname)) {
    return { url: target, keepsAuthorization: true }
  }

  if (GOOGLEUSERCONTENT_HOST_PATTERN.test(target.hostname)) {
    return { url: target, keepsAuthorization: false }
  }

  throw redirectRefused()
}

const CREDENTIAL_HEADER_NAMES: ReadonlySet<string> = new Set([
  'authorization',
  'x-goog-drive-resource-keys',
])

function withoutCredentials(
  headers: Record<string, string>,
): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).filter(([name]) => {
    return !CREDENTIAL_HEADER_NAMES.has(name.toLowerCase())
  }))
}

function readErrorReason(text: string): string | null {
  const body = parseJsonObject(text)
  const error = body?.error

  if (typeof error !== 'object' || error === null) {
    return null
  }

  const errors = (error as { errors?: unknown }).errors

  if (Array.isArray(errors)) {
    const reason = (errors[0] as { reason?: unknown } | undefined)?.reason

    if (typeof reason === 'string') {
      return reason
    }
  }

  const status = (error as { status?: unknown }).status

  return typeof status === 'string' ? status : null
}

async function readErrorText(response: Response): Promise<string> {
  try {
    return await readCappedText(response, ERROR_BODY_MAX_BYTES)
  } catch {
    return ''
  }
}

async function readOutcome(
  response: Response,
  maxBytes: number,
): Promise<GoogleDownloadResult> {
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      reason: readErrorReason(await readErrorText(response)),
    }
  }

  const declaredLength = Number(response.headers.get('content-length'))

  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await cancelBody(response)

    throw downloadTooLarge(maxBytes)
  }

  const reader = response.body?.getReader()
  const chunks: Uint8Array[] = []
  let received = 0

  while (reader) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    received += value.byteLength

    if (received > maxBytes) {
      await reader.cancel()

      throw downloadTooLarge(maxBytes)
    }

    chunks.push(value)
  }

  const bytes = new Uint8Array(received)
  let offset = 0

  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  return {
    ok: true,
    bytes,
    contentType: response.headers.get('content-type'),
  }
}

/**
 * Downloads a Google API response as bytes: HTTPS GET on an allow-listed
 * Google host, `redirect: 'manual'` with at most one hop to an allowed
 * host (see `resolveRedirectTarget`), the byte cap enforced while the body
 * streams in (and from `Content-Length` before it), and one timeout over
 * the whole exchange. A non-2xx answer is returned as a value with Google's
 * error reason so the caller can map it; only a cap breach, a refused
 * redirect, a timeout or an unreachable host throw.
 */
export async function googleFetchBytes(
  rawUrl: string,
  request: GoogleDownloadRequest,
  options: GoogleDownloadOptions,
): Promise<GoogleDownloadResult> {
  let url = assertGoogleUrl(rawUrl)
  let headers: Record<string, string> = { ...request.headers }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? GOOGLE_DOWNLOAD_TIMEOUT_MS
  const controller = new AbortController()
  const timeoutReason = new Error('google-download-timeout')
  const timer = setTimeout(() => {
    controller.abort(timeoutReason)
  }, timeoutMs)
  const unlink = linkSignals(controller, request.signal)

  try {
    for (let hop = 0; hop <= MAX_DOWNLOAD_REDIRECTS; hop++) {
      const response = await fetchImpl(url.toString(), {
        method: 'GET',
        headers,
        redirect: 'manual',
        signal: controller.signal,
      })

      if (!isRedirect(response)) {
        return await readOutcome(response, options.maxBytes)
      }

      const location = response.headers.get('location')

      await cancelBody(response)

      if (hop === MAX_DOWNLOAD_REDIRECTS || !location) {
        throw redirectRefused()
      }

      const target = resolveRedirectTarget(location, url)

      if (!target.keepsAuthorization) {
        headers = withoutCredentials(headers)
      }

      url = target.url
    }

    throw redirectRefused()
  } catch (exception) {
    if (controller.signal.reason === timeoutReason) {
      throw timedOut(timeoutMs)
    }

    if (
      exception instanceof Error
      && 'status' in exception
      && typeof exception.status === 'number'
    ) {
      throw exception
    }

    throw unreachable()
  } finally {
    clearTimeout(timer)
    unlink()
  }
}
