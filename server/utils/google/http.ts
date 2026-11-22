import { createError } from 'evlog'

export const GOOGLE_FETCH_TIMEOUT_MS = 15_000
export const GOOGLE_RESPONSE_MAX_BYTES = 64 * 1024

/**
 * Every host the server calls for Google. The authorization endpoint on
 * `accounts.google.com` is opened by the browser, never fetched here, so it
 * is not listed. Later children add `www.googleapis.com` when they call the
 * Drive API.
 */
export const GOOGLE_FETCH_HOSTS: ReadonlySet<string> = new Set([
  'oauth2.googleapis.com',
])

const FIRST_REDIRECT_STATUS = 300
const LAST_REDIRECT_STATUS = 399

export type GoogleFetchImplementation = (
  input: string,
  init: RequestInit,
) => Promise<Response>

export interface GoogleFetchRequest {
  method: 'GET' | 'POST'
  headers?: Record<string, string>
  form?: Record<string, string>
  signal?: AbortSignal
}

export interface GoogleFetchOptions {
  fetchImpl?: GoogleFetchImplementation
  timeoutMs?: number
}

export interface GoogleJsonResponse {
  status: number
  ok: boolean
  body: Record<string, unknown> | null
}

function refusedHost() {
  return createError({
    message: 'Google request refused',
    status: 500,
    why: 'The URL is not an allowed Google endpoint',
    fix: 'Only call the Google hosts listed in GOOGLE_FETCH_HOSTS',
  })
}

function redirectRefused() {
  return createError({
    message: 'Google answered with a redirect',
    status: 502,
    why: 'A Google endpoint redirected the request, which is never followed',
    fix: 'Try again later',
  })
}

function timedOut(timeoutMs: number) {
  return createError({
    message: 'Google did not answer in time',
    status: 504,
    why: `No complete answer arrived within ${timeoutMs} ms`,
    fix: 'Try again in a moment',
  })
}

function unreachable() {
  return createError({
    message: 'Google could not be reached',
    status: 502,
    why: 'The request to Google failed before an answer arrived',
    fix: 'Try again in a moment',
  })
}

function responseTooLarge() {
  return createError({
    message: 'Google answer too large',
    status: 502,
    why: `The answer exceeded ${GOOGLE_RESPONSE_MAX_BYTES} bytes`,
    fix: 'Try again later',
  })
}

export function assertGoogleUrl(rawUrl: string): URL {
  let url: URL

  try {
    url = new URL(rawUrl)
  } catch {
    throw refusedHost()
  }

  const isAllowed = url.protocol === 'https:'
    && !url.username
    && !url.password
    && !url.port
    && GOOGLE_FETCH_HOSTS.has(url.hostname)

  if (!isAllowed) {
    throw refusedHost()
  }

  return url
}

function isRedirect(response: Response): boolean {
  return response.type === 'opaqueredirect'
    || (
      response.status >= FIRST_REDIRECT_STATUS
      && response.status <= LAST_REDIRECT_STATUS
    )
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  if (!text) {
    return null
  }

  try {
    const parsed: unknown = JSON.parse(text)

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }

    return null
  } catch {
    return null
  }
}

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {
    return
  }
}

/**
 * Reads the body with a running byte count and cancels the stream as soon
 * as it passes the cap, so an oversized answer is never buffered whole.
 */
async function readCappedText(response: Response): Promise<string> {
  if (!response.body) {
    return ''
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let received = 0
  let text = ''

  while (true) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    received += value.byteLength

    if (received > GOOGLE_RESPONSE_MAX_BYTES) {
      await reader.cancel()

      throw responseTooLarge()
    }

    text += decoder.decode(value, { stream: true })
  }

  return text + decoder.decode()
}

function linkSignals(
  controller: AbortController,
  callerSignal: AbortSignal | undefined,
): () => void {
  if (!callerSignal) {
    return () => {}
  }

  if (callerSignal.aborted) {
    controller.abort(callerSignal.reason)

    return () => {}
  }

  const onAbort = () => {
    controller.abort(callerSignal.reason)
  }

  callerSignal.addEventListener('abort', onAbort, { once: true })

  return () => {
    callerSignal.removeEventListener('abort', onAbort)
  }
}

/**
 * The single outbound path to Google. The URL must be HTTPS on a host in
 * `GOOGLE_FETCH_HOSTS`; redirects are never followed (`redirect: 'manual'`,
 * because workerd throws on `'error'`) and any 3xx is an error; the timeout
 * covers the body read; the answer is parsed as a JSON object and its
 * stream is cut off past 64 KiB; a refused redirect has its body
 * canceled. Callers await each call before the next, so a request never
 * holds more than one Google connection. Bodies and tokens are never
 * logged here.
 */
export async function googleFetchJson(
  rawUrl: string,
  request: GoogleFetchRequest,
  options: GoogleFetchOptions = {},
): Promise<GoogleJsonResponse> {
  const url = assertGoogleUrl(rawUrl)
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? GOOGLE_FETCH_TIMEOUT_MS
  const controller = new AbortController()
  const timeoutReason = new Error('google-fetch-timeout')
  const timer = setTimeout(() => {
    controller.abort(timeoutReason)
  }, timeoutMs)
  const unlink = linkSignals(controller, request.signal)
  const headers: Record<string, string> = {
    accept: 'application/json',
    ...request.headers,
  }
  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: 'manual',
    signal: controller.signal,
  }

  if (request.form) {
    headers['content-type'] = 'application/x-www-form-urlencoded'
    init.body = new URLSearchParams(request.form).toString()
  }

  try {
    const response = await fetchImpl(url.toString(), init)

    if (isRedirect(response)) {
      await cancelBody(response)

      throw redirectRefused()
    }

    const text = await readCappedText(response)

    return {
      status: response.status,
      ok: response.ok,
      body: parseJsonObject(text),
    }
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
