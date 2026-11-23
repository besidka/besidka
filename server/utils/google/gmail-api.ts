import {
  GOOGLE_GMAIL_ID_SHAPE,
  GOOGLE_GMAIL_SEARCH_THREAD_RESPONSE_MAX_BYTES,
  GOOGLE_GMAIL_THREAD_RESPONSE_MAX_BYTES,
} from '#shared/utils/google-gmail-tools'
import { readReason } from '~~/server/utils/google/drive'
import {
  GOOGLE_RESPONSE_TOO_LARGE_MESSAGE,
  GOOGLE_TIMED_OUT_MESSAGE,
  googleFetchJson,
} from '~~/server/utils/google/http'
import type {
  GoogleFetchImplementation,
  GoogleFetchOptions,
} from '~~/server/utils/google/http'

const GMAIL_MESSAGES_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages'
const GMAIL_THREADS_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/threads'
const GMAIL_DRAFTS_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/drafts'
const THREAD_LIST_FIELDS = 'threads(id)'
const THREAD_METADATA_FIELDS = 'id,messages(id,internalDate,snippet,'
  + 'payload/headers)'
const THREAD_FULL_FIELDS = 'id,messages(id,internalDate,payload)'
const THREAD_MINIMAL_FIELDS = 'id,messages(id,internalDate)'
const MESSAGE_FULL_FIELDS = 'id,internalDate,payload'
const REPLY_METADATA_FIELDS = 'messages(internalDate,payload/headers)'
const DRAFT_FIELDS = 'id,message(id,threadId)'
const SEARCH_HEADERS = ['From', 'Subject', 'Date'] as const
const MESSAGE_ID_HEADERS = ['Message-ID', 'References'] as const

export interface GmailRequestContext {
  accessToken: string
  fetchImpl?: GoogleFetchImplementation
}

export type GmailFailureCode
  = | 'reauthorize'
    | 'api_disabled'
    | 'no_access'
    | 'not_found'
    | 'rate_limited'
    | 'too_large'
    | 'bad_request'
    | 'failed'

export const GMAIL_FAILURE_TEXT: Readonly<Record<GmailFailureCode, string>> = {
  reauthorize: 'Google no longer accepts the connection to your own Google '
    + 'client. Reconnect it in your Besidka settings.',
  api_disabled: 'The Gmail API is not turned on in the Google Cloud project '
    + 'of your own Google client. Turn it on there and try again.',
  no_access: 'Gmail refused the request. Reconnect your own Google client in '
    + 'your Besidka settings and allow the Gmail access this tool needs.',
  not_found: 'Gmail has no message or thread with that id.',
  rate_limited: 'Gmail asked Besidka to slow down. Try again in a moment.',
  too_large: 'This thread is too large to read here. Tell the user to open '
    + 'it in Gmail.',
  bad_request: 'Gmail did not accept the request. Check the search words or '
    + 'the draft and try again.',
  failed: 'Gmail could not be reached or answered with an error. Try again '
    + 'in a moment.',
}

export type GmailFailureObservation = 'timeout' | 'non-json' | 'unreachable'

export type GmailResult<Value>
  = | { ok: true, value: Value }
    | {
      ok: false
      code: GmailFailureCode
      status?: number
      observed?: GmailFailureObservation
    }

const RATE_LIMIT_REASONS: ReadonlySet<string> = new Set([
  'rateLimitExceeded',
  'userRateLimitExceeded',
  'quotaExceeded',
])

/**
 * Maps a Gmail answer that is not a success to one code with a fixed
 * sentence. Google's own message text is never forwarded: it can echo the
 * request, which holds a search the user wrote.
 */
export function classifyGmailFailure(
  status: number,
  reason: string | null,
): GmailFailureCode {
  if (status === 401) {
    return 'reauthorize'
  }

  if (reason === 'accessNotConfigured' || reason === 'SERVICE_DISABLED') {
    return 'api_disabled'
  }

  if (status === 404) {
    return 'not_found'
  }

  if (status === 429 || (reason && RATE_LIMIT_REASONS.has(reason))) {
    return 'rate_limited'
  }

  if (status === 403) {
    return 'no_access'
  }

  return status === 400 ? 'bad_request' : 'failed'
}

/**
 * The failure code of a Google request that threw instead of answering:
 * an answer over its byte cap is `too_large`, anything else (a timeout, a
 * refused redirect, no connection) is `failed`.
 */
export function classifyGoogleRequestException(
  exception: unknown,
): GmailFailureCode {
  const message = exception instanceof Error ? exception.message : ''

  return message === GOOGLE_RESPONSE_TOO_LARGE_MESSAGE ? 'too_large' : 'failed'
}

function toFetchOptions(
  context: GmailRequestContext,
  extra: GoogleFetchOptions = {},
): GoogleFetchOptions {
  return context.fetchImpl
    ? { ...extra, fetchImpl: context.fetchImpl }
    : extra
}

function headersOf(context: GmailRequestContext): Record<string, string> {
  return { authorization: `Bearer ${context.accessToken}` }
}

function assertSafeId(id: string): void {
  if (!GOOGLE_GMAIL_ID_SHAPE.test(id)) {
    throw new TypeError('Invalid Gmail id')
  }
}

function queryOf(entries: ReadonlyArray<readonly [string, string]>): string {
  return entries
    .map(([key, value]) => {
      return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
    })
    .join('&')
}

async function requestJson(
  url: string,
  request: Parameters<typeof googleFetchJson>[1],
  options: GoogleFetchOptions,
): Promise<GmailResult<Record<string, unknown>>> {
  try {
    const response = await googleFetchJson(url, request, options)

    if (!response.ok || !response.body) {
      return {
        ok: false,
        code: response.ok
          ? 'failed'
          : classifyGmailFailure(response.status, readReason(response.body)),
        ...(response.ok
          ? { observed: 'non-json' as const }
          : { status: response.status }),
      }
    }

    return { ok: true, value: response.body }
  } catch (exception) {
    const message = exception instanceof Error ? exception.message : ''

    return {
      ok: false,
      code: classifyGoogleRequestException(exception),
      observed: message === GOOGLE_TIMED_OUT_MESSAGE
        ? 'timeout'
        : 'unreachable',
    }
  }
}

async function getJson(
  url: string,
  context: GmailRequestContext,
  extra: GoogleFetchOptions = {},
): Promise<GmailResult<Record<string, unknown>>> {
  return await requestJson(
    url,
    { method: 'GET', headers: headersOf(context) },
    toFetchOptions(context, extra),
  )
}

/**
 * `users.threads.list` with the user's search words in `q`: exactly up to
 * `maxResults` thread ids, spam and trash left out, only the ids
 * requested.
 */
export async function listGmailThreads(
  query: string,
  maxResults: number,
  context: GmailRequestContext,
): Promise<GmailResult<string[]>> {
  const result = await getJson(`${GMAIL_THREADS_URL}?${queryOf([
    ['q', query],
    ['maxResults', String(maxResults)],
    ['includeSpamTrash', 'false'],
    ['fields', THREAD_LIST_FIELDS],
  ])}`, context)

  if (!result.ok) {
    return result
  }

  const threads = Array.isArray(result.value.threads)
    ? result.value.threads
    : []
  const ids = threads.flatMap((thread: unknown) => {
    const id = (thread as { id?: unknown } | null)?.id

    return typeof id === 'string' && GOOGLE_GMAIL_ID_SHAPE.test(id) ? [id] : []
  })

  return { ok: true, value: [...new Set(ids)].slice(0, maxResults) }
}

/**
 * `users.threads.get` with `format=metadata`, the From, Subject and Date
 * headers and only the fields a search line needs, read with a larger cap
 * than the default because a long thread lists every message.
 */
export async function getGmailThreadMetadata(
  threadId: string,
  context: GmailRequestContext,
): Promise<GmailResult<Record<string, unknown>>> {
  assertSafeId(threadId)

  return await getJson(`${GMAIL_THREADS_URL}/${encodeURIComponent(threadId)}?${
    queryOf([
      ['format', 'metadata'],
      ...SEARCH_HEADERS.map(name => ['metadataHeaders', name] as const),
      ['fields', THREAD_METADATA_FIELDS],
    ])
  }`, context, {
    maxResponseBytes: GOOGLE_GMAIL_SEARCH_THREAD_RESPONSE_MAX_BYTES,
  })
}

/**
 * `users.threads.get` with `format=full` and a `fields` mask (message id,
 * timestamp and payload only). The answer may be large (the bodies are
 * base64), so it is read with its own cap and a thread over it is a
 * `too_large` failure; the caller then reads it message by message.
 */
export async function getGmailThread(
  threadId: string,
  context: GmailRequestContext,
): Promise<GmailResult<Record<string, unknown>>> {
  assertSafeId(threadId)

  return await getJson(`${GMAIL_THREADS_URL}/${encodeURIComponent(threadId)}?${
    queryOf([['format', 'full'], ['fields', THREAD_FULL_FIELDS]])
  }`, context, { maxResponseBytes: GOOGLE_GMAIL_THREAD_RESPONSE_MAX_BYTES })
}

/**
 * The message ids and timestamps of a thread (`format=minimal`), for
 * reading a thread too large for one answer message by message.
 */
export async function getGmailThreadMessageIds(
  threadId: string,
  context: GmailRequestContext,
): Promise<GmailResult<Array<{ id: string, internalDate: number }>>> {
  assertSafeId(threadId)

  const result = await getJson(
    `${GMAIL_THREADS_URL}/${encodeURIComponent(threadId)}?${
      queryOf([['format', 'minimal'], ['fields', THREAD_MINIMAL_FIELDS]])
    }`,
    context,
    { maxResponseBytes: GOOGLE_GMAIL_SEARCH_THREAD_RESPONSE_MAX_BYTES },
  )

  if (!result.ok) {
    return result
  }

  const messages = Array.isArray(result.value.messages)
    ? result.value.messages
    : []

  return {
    ok: true,
    value: messages.flatMap((message: unknown) => {
      const record = message as { id?: unknown, internalDate?: unknown } | null
      const internalDate = Number(record?.internalDate)

      return typeof record?.id === 'string'
        && GOOGLE_GMAIL_ID_SHAPE.test(record.id)
        ? [{
          id: record.id,
          internalDate: Number.isFinite(internalDate) ? internalDate : 0,
        }]
        : []
    }),
  }
}

/**
 * One message with `format=full` and the same `fields` mask as a thread,
 * under the thread cap.
 */
export async function getGmailMessage(
  messageId: string,
  context: GmailRequestContext,
): Promise<GmailResult<Record<string, unknown>>> {
  assertSafeId(messageId)

  return await getJson(`${GMAIL_MESSAGES_URL}/${encodeURIComponent(messageId)}?${
    queryOf([['format', 'full'], ['fields', MESSAGE_FULL_FIELDS]])
  }`, context, { maxResponseBytes: GOOGLE_GMAIL_THREAD_RESPONSE_MAX_BYTES })
}

/**
 * The headers of a thread that a reply needs (`Message-ID` and
 * `References` of every message, with its timestamp), as
 * `format=metadata` returns them.
 */
export async function getGmailThreadReplyHeaders(
  threadId: string,
  context: GmailRequestContext,
): Promise<GmailResult<Record<string, unknown>>> {
  assertSafeId(threadId)

  return await getJson(`${GMAIL_THREADS_URL}/${encodeURIComponent(threadId)}?${
    queryOf([
      ['format', 'metadata'],
      ...MESSAGE_ID_HEADERS.map(name => ['metadataHeaders', name] as const),
      ['fields', REPLY_METADATA_FIELDS],
    ])
  }`, context, {
    maxResponseBytes: GOOGLE_GMAIL_SEARCH_THREAD_RESPONSE_MAX_BYTES,
  })
}

export interface CreatedGmailDraft {
  draftId: string
  messageId: string | null
  threadId: string | null
}

/**
 * `users.drafts.create`: the one write of the Gmail tools. The body is
 * `{ message: { raw, threadId? } }`, where `raw` is the base64url message
 * from `buildGmailDraftRaw`. This module has no function for any other
 * write: no send, no modify, no delete.
 */
export async function createGmailDraft(
  input: { raw: string, threadId?: string },
  context: GmailRequestContext,
): Promise<GmailResult<CreatedGmailDraft>> {
  if (input.threadId !== undefined) {
    assertSafeId(input.threadId)
  }

  const body = JSON.stringify({
    message: {
      raw: input.raw,
      ...(input.threadId ? { threadId: input.threadId } : {}),
    },
  })
  const result = await requestJson(
    `${GMAIL_DRAFTS_URL}?${queryOf([['fields', DRAFT_FIELDS]])}`,
    {
      method: 'POST',
      headers: headersOf(context),
      rawBody: {
        contentType: 'application/json',
        data: new TextEncoder().encode(body) as Uint8Array<ArrayBuffer>,
      },
    },
    toFetchOptions(context),
  )

  if (!result.ok) {
    return result
  }

  const message = result.value.message as
    | { id?: unknown, threadId?: unknown }
    | undefined

  if (typeof result.value.id !== 'string') {
    return { ok: false, code: 'failed' }
  }

  return {
    ok: true,
    value: {
      draftId: result.value.id,
      messageId: typeof message?.id === 'string' ? message.id : null,
      threadId: typeof message?.threadId === 'string'
        ? message.threadId
        : null,
    },
  }
}
