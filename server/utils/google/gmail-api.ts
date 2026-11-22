import {
  GOOGLE_GMAIL_ID_SHAPE,
  GOOGLE_GMAIL_THREAD_RESPONSE_MAX_BYTES,
} from '#shared/utils/google-gmail-tools'
import { readReason } from '~~/server/utils/google/drive'
import {
  GOOGLE_RESPONSE_TOO_LARGE_MESSAGE,
  googleFetchJson,
} from '~~/server/utils/google/http'
import type {
  GoogleFetchImplementation,
  GoogleFetchOptions,
} from '~~/server/utils/google/http'

const GMAIL_MESSAGES_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/messages'
const GMAIL_THREADS_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/threads'
const GMAIL_DRAFTS_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/drafts'
const MESSAGE_METADATA_FIELDS = 'id,threadId,internalDate,snippet,'
  + 'payload/headers'
const REPLY_METADATA_FIELDS = 'messages(payload/headers)'
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
    + 'client. Reconnect it on the API Keys page, Google tab.',
  api_disabled: 'The Gmail API is not turned on in the Google Cloud project '
    + 'of your own Google client. Turn it on there and try again.',
  no_access: 'Gmail refused the request. Reconnect your own Google client on '
    + 'the API Keys page and allow the Gmail access this tool needs.',
  not_found: 'Gmail has no message or thread with that id.',
  rate_limited: 'Gmail asked Besidka to slow down. Try again in a moment.',
  too_large: 'This thread is too large to read here. Tell the user to open '
    + 'it in Gmail.',
  bad_request: 'Gmail did not accept the request. Check the search words or '
    + 'the draft and try again.',
  failed: 'Gmail could not be reached or answered with an error. Try again '
    + 'in a moment.',
}

export type GmailResult<Value>
  = | { ok: true, value: Value }
    | { ok: false, code: GmailFailureCode }

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
      }
    }

    return { ok: true, value: response.body }
  } catch (exception) {
    const message = exception instanceof Error ? exception.message : ''

    return {
      ok: false,
      code: message === GOOGLE_RESPONSE_TOO_LARGE_MESSAGE
        ? 'too_large'
        : 'failed',
    }
  }
}

/**
 * `users.messages.list` with the user's search words in `q` and a small
 * `maxResults`. Spam and trash stay out (`includeSpamTrash` false).
 */
export async function listGmailMessages(
  query: string,
  maxResults: number,
  context: GmailRequestContext,
): Promise<GmailResult<Array<{ id: string, threadId: string }>>> {
  const url = `${GMAIL_MESSAGES_URL}?${new URLSearchParams({
    q: query,
    maxResults: String(maxResults),
    includeSpamTrash: 'false',
    fields: 'messages(id,threadId)',
  }).toString()}`
  const result = await requestJson(
    url,
    { method: 'GET', headers: headersOf(context) },
    toFetchOptions(context),
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
      const record = message as { id?: unknown, threadId?: unknown }

      return typeof record?.id === 'string'
        && typeof record.threadId === 'string'
        && GOOGLE_GMAIL_ID_SHAPE.test(record.id)
        && GOOGLE_GMAIL_ID_SHAPE.test(record.threadId)
        ? [{ id: record.id, threadId: record.threadId }]
        : []
    }),
  }
}

/**
 * `users.messages.get` with `format=metadata` and only the From, Subject
 * and Date headers.
 */
export async function getGmailMessageMetadata(
  messageId: string,
  context: GmailRequestContext,
): Promise<GmailResult<Record<string, unknown>>> {
  assertSafeId(messageId)

  const url = `${GMAIL_MESSAGES_URL}/${encodeURIComponent(messageId)}?${[
    'format=metadata',
    'metadataHeaders=From',
    'metadataHeaders=Subject',
    'metadataHeaders=Date',
    `fields=${encodeURIComponent(MESSAGE_METADATA_FIELDS)}`,
  ].join('&')}`

  return await requestJson(
    url,
    { method: 'GET', headers: headersOf(context) },
    toFetchOptions(context),
  )
}

/**
 * `users.threads.get` with `format=full`. The answer may be large (the
 * bodies are base64), so it is read with its own cap and a thread over it
 * is a `too_large` failure.
 */
export async function getGmailThread(
  threadId: string,
  context: GmailRequestContext,
): Promise<GmailResult<Record<string, unknown>>> {
  assertSafeId(threadId)

  return await requestJson(
    `${GMAIL_THREADS_URL}/${encodeURIComponent(threadId)}?format=full`,
    { method: 'GET', headers: headersOf(context) },
    toFetchOptions(context, {
      maxResponseBytes: GOOGLE_GMAIL_THREAD_RESPONSE_MAX_BYTES,
    }),
  )
}

/**
 * The headers of a thread that a reply needs (`Message-ID` and
 * `References` of every message), as `format=metadata` returns them.
 */
export async function getGmailThreadReplyHeaders(
  threadId: string,
  context: GmailRequestContext,
): Promise<GmailResult<Record<string, unknown>>> {
  assertSafeId(threadId)

  const url = `${GMAIL_THREADS_URL}/${encodeURIComponent(threadId)}?${[
    'format=metadata',
    ...MESSAGE_ID_HEADERS.map(header => `metadataHeaders=${header}`),
    `fields=${encodeURIComponent(REPLY_METADATA_FIELDS)}`,
  ].join('&')}`

  return await requestJson(
    url,
    { method: 'GET', headers: headersOf(context) },
    toFetchOptions(context),
  )
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
    GMAIL_DRAFTS_URL,
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
