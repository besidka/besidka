import { createError } from 'evlog'
import type { RequestEvent } from 'nuxt/server'
import { getRequestHeader } from 'nuxt/server'
import type { z } from 'zod'

export const KNOWLEDGE_BODY_LIMITS = {
  itemsBatch: 6.25 * 1024 * 1024,
  note: 640 * 1024,
  small: 64 * 1024,
} as const

function createBodyTooLargeError(maxBytes: number) {
  return createError({
    message: 'Request body is too large',
    status: 413,
    why: `The request body exceeds ${maxBytes} bytes`,
    fix: 'Send a smaller request',
  })
}

function createInvalidJsonError(why: string) {
  return createError({
    message: 'Invalid JSON body',
    status: 400,
    why,
    fix: 'Send a valid UTF-8 JSON document',
  })
}

function readContentLength(event: RequestEvent): number | null {
  const header = getRequestHeader(event, 'content-length')

  if (header === undefined || header === '') {
    return null
  }

  if (!/^\d+$/.test(header.trim())) {
    throw createError({
      message: 'Invalid Content-Length header',
      status: 400,
    })
  }

  const contentLength = Number(header)

  if (!Number.isSafeInteger(contentLength)) {
    throw createError({
      message: 'Invalid Content-Length header',
      status: 400,
    })
  }

  return contentLength
}

async function readCappedBytes(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!body) {
    return new Uint8Array(0)
  }

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0

  while (true) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    totalBytes += value.byteLength

    if (totalBytes > maxBytes) {
      await reader.cancel()

      throw createBodyTooLargeError(maxBytes)
    }

    chunks.push(value)
  }

  const bytes = new Uint8Array(totalBytes)
  let offset = 0

  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  return bytes
}

/**
 * Reads a JSON request body with a hard size cap and validates it with a
 * zod schema. A `Content-Length` above the cap is a 413 before anything is
 * read, and the stream is counted while it is read because the header may be
 * absent or wrong. Malformed JSON or invalid UTF-8 is a 400. The result is
 * the schema's `safeParse` result so the caller keeps its own 400 message.
 */
export async function readCappedJsonBody<Schema extends z.ZodType>(
  event: RequestEvent,
  schema: Schema,
  maxBytes: number,
): Promise<ReturnType<Schema['safeParse']>> {
  const contentLength = readContentLength(event)

  if (contentLength !== null && contentLength > maxBytes) {
    throw createBodyTooLargeError(maxBytes)
  }

  const bytes = await readCappedBytes(event.req.body, maxBytes)
  let parsed: unknown

  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch (_exception) {
    throw createInvalidJsonError('The body is not valid JSON')
  }

  return schema.safeParse(parsed) as ReturnType<Schema['safeParse']>
}
