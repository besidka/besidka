import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { readCappedJsonBody } from '~~/server/utils/knowledge/body'

vi.mock('evlog', () => ({
  createError: (input: {
    message: string
    status?: number
    why?: string
    fix?: string
  }) => {
    const exception = new Error(input.message)

    Object.assign(exception, input)

    return exception
  },
}))

const schema = z.object({ name: z.string() })
const CAP = 1024

function streamOf(chunks: Uint8Array[], onPull?: () => void) {
  let position = 0
  const cancel = vi.fn()
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      onPull?.()

      if (position >= chunks.length) {
        controller.close()

        return
      }

      controller.enqueue(chunks[position++])
    },
    cancel,
  })

  return { stream, cancel }
}

function eventFor(
  body: string | ReadableStream<Uint8Array> | undefined,
  headers: Record<string, string> = {},
) {
  const init: RequestInit & { duplex?: 'half' } = { method: 'POST' }

  if (body !== undefined) {
    init.body = body
    init.duplex = 'half'
  }

  return {
    headers,
    req: new Request('http://localhost/x', init),
  } as never
}

describe('readCappedJsonBody', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'getRequestHeader',
      (event: { headers?: Record<string, string> }, name: string) => {
        return event.headers?.[name.toLowerCase()]
      },
    )
  })

  it('parses and validates a body within the cap', async () => {
    const result = await readCappedJsonBody(
      eventFor(JSON.stringify({ name: 'a' })),
      schema,
      CAP,
    )

    expect(result.success).toBe(true)
    expect(result.data).toEqual({ name: 'a' })
  })

  it('accepts a body of exactly the cap', async () => {
    const body = JSON.stringify({ name: 'a'.repeat(CAP - 11) })

    expect(new TextEncoder().encode(body).length).toBe(CAP)

    const result = await readCappedJsonBody(eventFor(body), schema, CAP)

    expect(result.success).toBe(true)
  })

  it('returns the schema error instead of throwing for a wrong shape', async () => {
    const result = await readCappedJsonBody(
      eventFor(JSON.stringify({ name: 3 })),
      schema,
      CAP,
    )

    expect(result.success).toBe(false)
    expect(result.error?.message).toEqual(expect.any(String))
  })

  it('rejects an over-cap Content-Length with 413 before reading anything', async () => {
    const { stream } = streamOf([new Uint8Array(10)])
    const event = eventFor(stream, { 'content-length': String(CAP + 1) })

    await expect(readCappedJsonBody(event, schema, CAP))
      .rejects.toMatchObject({ status: 413 })

    expect((event as any).req.bodyUsed).toBe(false)
    expect((event as any).req.body.locked).toBe(false)
  })

  it('rejects a body that outgrows the cap without a Content-Length', async () => {
    const { stream, cancel } = streamOf([
      new Uint8Array(CAP / 2).fill(97),
      new Uint8Array(CAP / 2).fill(97),
      new Uint8Array(CAP / 2).fill(97),
    ])

    await expect(readCappedJsonBody(eventFor(stream), schema, CAP))
      .rejects.toMatchObject({ status: 413 })
    expect(cancel).toHaveBeenCalled()
  })

  it('rejects a body that outgrows the cap when the header lies', async () => {
    const { stream } = streamOf([new Uint8Array(CAP * 3).fill(97)])

    await expect(readCappedJsonBody(
      eventFor(stream, { 'content-length': '10' }),
      schema,
      CAP,
    )).rejects.toMatchObject({ status: 413 })
  })

  it('stops reading after the cap is crossed', async () => {
    const onPull = vi.fn()
    const { stream } = streamOf(
      Array.from({ length: 50 }, () => new Uint8Array(CAP).fill(97)),
      onPull,
    )

    await expect(readCappedJsonBody(eventFor(stream), schema, CAP))
      .rejects.toMatchObject({ status: 413 })
    expect(onPull.mock.calls.length).toBeLessThan(5)
  })

  it.each([
    ['malformed JSON', '{"name":'],
    ['an empty body', ''],
    ['plain text', 'hello'],
  ])('answers 400 for %s', async (_label, body) => {
    await expect(readCappedJsonBody(eventFor(body), schema, CAP))
      .rejects.toMatchObject({ status: 400 })
  })

  it('answers 400 for a missing body', async () => {
    await expect(readCappedJsonBody(eventFor(undefined), schema, CAP))
      .rejects.toMatchObject({ status: 400 })
  })

  it('answers 400 for invalid UTF-8', async () => {
    const { stream } = streamOf([new Uint8Array([123, 0xff, 125])])

    await expect(readCappedJsonBody(eventFor(stream), schema, CAP))
      .rejects.toMatchObject({ status: 400 })
  })

  it.each(['abc', '-1', '1.5', '1e3'])('answers 400 for the Content-Length %j', async (value) => {
    await expect(readCappedJsonBody(
      eventFor(JSON.stringify({ name: 'a' }), { 'content-length': value }),
      schema,
      CAP,
    )).rejects.toMatchObject({ status: 400 })
  })
})
