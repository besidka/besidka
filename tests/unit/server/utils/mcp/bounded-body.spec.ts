import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { readBody, readRawBody } from 'h3'
import { describe, expect, it, vi } from 'vitest'
import {
  McpBodyTooLargeError,
  readBoundedRawBody,
} from '~~/server/utils/mcp/bounded-body'

const H3_RAW_BODY = Symbol.for('h3RawBody')

type BoundedBodyEvent = Parameters<typeof readBoundedRawBody>[0]

function createWorkersEvent(body: Buffer) {
  const mockRequest = Object.assign(new EventEmitter(), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': String(body.length),
    },
    readable: false,
    readableEnded: true,
    body,
  })

  return { node: { req: mockRequest, res: {} }, context: {}, method: 'POST' }
}

function createEvent(
  chunks: Array<Buffer | string>,
  extra: Record<string, unknown> = {},
): BoundedBodyEvent {
  return {
    node: { req: Readable.from(chunks, { objectMode: false }) },
    ...extra,
  } as unknown as BoundedBodyEvent
}

async function readCachedBody(event: BoundedBodyEvent): Promise<Buffer> {
  const cached = (event.node.req as unknown as Record<symbol, Promise<Buffer>>)[
    H3_RAW_BODY
  ]

  return await cached!
}

describe('readBoundedRawBody', () => {
  it('returns the text and caches the bytes where h3 reads them', async () => {
    const readPreparedBody = vi.fn()
    const event = createEvent(['{"a":', '"б"}'])
    const text = await readBoundedRawBody(event, 100, readPreparedBody)

    expect(text).toBe('{"a":"б"}')
    expect(readPreparedBody).not.toHaveBeenCalled()
    await expect(readCachedBody(event)).resolves.toEqual(
      Buffer.from('{"a":"б"}'),
    )
  })

  it('leaves the body readable for h3, as the toolkit reads it', async () => {
    const request = Readable.from(['{"jsonrpc":"2.0","id":1}'], {
      objectMode: false,
    })

    Object.assign(request, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': '24' },
    })

    const event = { node: { req: request, res: {} }, context: {}, method: 'POST' }

    await expect(readBoundedRawBody(
      event as unknown as BoundedBodyEvent,
      100,
      vi.fn(),
    )).resolves.toBe('{"jsonrpc":"2.0","id":1}')
    await expect(readRawBody(event as never, 'utf8'))
      .resolves.toBe('{"jsonrpc":"2.0","id":1}')
    await expect(readBody(event as never))
      .resolves.toEqual({ jsonrpc: '2.0', id: 1 })
  })

  it('accepts a body exactly at the cap', async () => {
    const event = createEvent([Buffer.alloc(10, 'a')])

    await expect(readBoundedRawBody(event, 10, vi.fn()))
      .resolves.toBe('a'.repeat(10))
  })

  it('throws once more bytes arrive than the cap, whatever was declared',
    async () => {
      const event = createEvent([Buffer.alloc(6), Buffer.alloc(6)])

      await expect(readBoundedRawBody(event, 10, vi.fn()))
        .rejects.toBeInstanceOf(McpBodyTooLargeError)
      expect((event.node.req as unknown as Record<symbol, unknown>)[
        H3_RAW_BODY
      ]).toBeUndefined()
    })

  it('resolves an empty body to undefined and leaves it uncached',
    async () => {
      const event = createEvent([])

      await expect(readBoundedRawBody(event, 10, vi.fn()))
        .resolves.toBeUndefined()
      expect((event.node.req as unknown as Record<symbol, unknown>)[
        H3_RAW_BODY
      ]).toBeUndefined()
    })

  it('measures bytes, not characters', async () => {
    const event = createEvent([Buffer.from('ббб')])

    await expect(readBoundedRawBody(event, 5, vi.fn()))
      .rejects.toBeInstanceOf(McpBodyTooLargeError)
  })

  it('falls back to the prepared body and still enforces the cap',
    async () => {
      const event = createEvent([], { _requestBody: 'already read' })

      await expect(readBoundedRawBody(
        event,
        100,
        async () => 'prepared',
      )).resolves.toBe('prepared')
      await expect(readBoundedRawBody(
        event,
        3,
        async () => 'prepared',
      )).rejects.toBeInstanceOf(McpBodyTooLargeError)
    })

  it('rejects when the stream errors', async () => {
    const request = new Readable({
      read() {
        this.destroy(new Error('socket reset'))
      },
    })

    await expect(readBoundedRawBody(
      { node: { req: request } } as unknown as BoundedBodyEvent,
      10,
      vi.fn(),
    )).rejects.toThrow('socket reset')
  })

  describe('on Workers, where Nitro hands over a mock request', () => {
    const payload = Buffer.from('{"jsonrpc":"2.0","id":1,"method":"tools/list"}')

    it('reads the prepared bytes instead of waiting on a stream that never emits',
      async () => {
        const event = createWorkersEvent(payload)

        await expect(readBoundedRawBody(
          event as unknown as BoundedBodyEvent,
          100,
          () => readRawBody(event as never, 'utf8'),
        )).resolves.toBe(payload.toString())
        await expect(readBody(event as never)).resolves.toEqual({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/list',
        })
      })

    it('enforces the cap on the prepared bytes', async () => {
      const event = createWorkersEvent(payload)

      await expect(readBoundedRawBody(
        event as unknown as BoundedBodyEvent,
        10,
        () => readRawBody(event as never, 'utf8'),
      )).rejects.toBeInstanceOf(McpBodyTooLargeError)
    })

    it('resolves an ended stream without a prepared body instead of hanging',
      async () => {
        const event = createWorkersEvent(payload)

        delete (event.node.req as { body?: Buffer }).body

        await expect(readBoundedRawBody(
          event as unknown as BoundedBodyEvent,
          100,
          vi.fn(),
        )).resolves.toBeUndefined()
      })
  })
})
