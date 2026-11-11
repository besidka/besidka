import type { RequestEvent } from 'nuxt/server'
import { createError } from 'evlog'
import { getRequestHeader } from 'nuxt/server'

function createTooLargeError(maxBytes: number, why: string) {
  return createError({
    message: 'Request too large',
    status: 413,
    why,
    fix: `Send a file of at most ${maxBytes} bytes`,
  })
}

/**
 * Reads the declared body length. A missing, malformed or negative
 * `Content-Length` is refused (411) and a length above `maxBytes` is refused
 * (413), both before a single body byte is read.
 */
export function readDeclaredContentLength(
  event: RequestEvent,
  maxBytes: number,
): number {
  const header = getRequestHeader(event, 'content-length')
  const length = header === undefined ? Number.NaN : Number(header)

  if (!Number.isSafeInteger(length) || length < 0) {
    throw createError({
      message: 'Content-Length required',
      status: 411,
      why: 'The upload must declare its size in a Content-Length header',
      fix: 'Send the file as a raw body with a Content-Length header',
    })
  }

  if (length > maxBytes) {
    throw createTooLargeError(
      maxBytes,
      `The declared body is ${length} bytes; at most ${maxBytes} are accepted`,
    )
  }

  return length
}

/**
 * Reads the request body into one buffer and stops as soon as more than
 * `maxBytes` arrived, so a client that lies in `Content-Length` cannot make
 * the Worker hold more than the cap.
 */
export async function readBodyBytes(
  event: RequestEvent,
  maxBytes: number,
): Promise<Uint8Array> {
  const body = event.req.body

  if (!body) {
    return new Uint8Array(0)
  }

  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  while (true) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    total += value.byteLength

    if (total > maxBytes) {
      await reader.cancel()

      throw createTooLargeError(
        maxBytes,
        `The body is larger than the ${maxBytes} bytes that are accepted`,
      )
    }

    chunks.push(value)
  }

  const bytes = new Uint8Array(total)
  let offset = 0

  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  return bytes
}
