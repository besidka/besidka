import type { Readable } from 'node:stream'

const H3_RAW_BODY = Symbol.for('h3RawBody')

export class McpBodyTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`The request body is larger than ${maxBytes} bytes.`)
    this.name = 'McpBodyTooLargeError'
  }
}

interface BoundedBodyEvent {
  _requestBody?: unknown
  web?: { request?: { body?: unknown } }
  node: { req: Readable & { [H3_RAW_BODY]?: Promise<Buffer> } }
}

function hasPreparedBody(event: BoundedBodyEvent): boolean {
  return Boolean(
    event._requestBody
    || event.web?.request?.body
    || event.node.req[H3_RAW_BODY],
  )
}

function collectBounded(
  request: Readable,
  maxBytes: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let receivedBytes = 0
    let isSettled = false

    request.on('error', (exception) => {
      if (!isSettled) {
        isSettled = true
        reject(exception)
      }
    })
    request.on('data', (chunk: Buffer | string) => {
      if (isSettled) {
        return
      }

      const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk

      receivedBytes += buffer.length

      if (receivedBytes > maxBytes) {
        isSettled = true
        chunks.length = 0
        reject(new McpBodyTooLargeError(maxBytes))

        return
      }

      chunks.push(buffer)
    })
    request.on('end', () => {
      if (!isSettled) {
        isSettled = true
        resolve(Buffer.concat(chunks))
      }
    })
  })
}

/**
 * Reads the request body while counting the bytes actually received, so a
 * lying or absent Content-Length cannot make the Worker buffer more than
 * `maxBytes`. The bytes are stored where h3's `readRawBody` caches them, so
 * the toolkit's own `readBody` and the SDK's request stream still see the
 * same body afterwards. An empty body resolves to `undefined` and is left
 * uncached, exactly like `readRawBody`.
 */
export async function readBoundedRawBody(
  event: BoundedBodyEvent,
  maxBytes: number,
  readPreparedBody: () => Promise<string | undefined>,
): Promise<string | undefined> {
  if (hasPreparedBody(event)) {
    const text = await readPreparedBody()

    if (text !== undefined && Buffer.byteLength(text) > maxBytes) {
      throw new McpBodyTooLargeError(maxBytes)
    }

    return text
  }

  const body = await collectBounded(event.node.req, maxBytes)

  if (body.length === 0) {
    return undefined
  }

  event.node.req[H3_RAW_BODY] = Promise.resolve(body)

  return body.toString('utf8')
}
