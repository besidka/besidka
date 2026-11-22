import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  set: vi.fn(),
  emit: vi.fn((): unknown => ({ message: 'AI stream client disconnected' })),
  createRequestLogger: vi.fn(),
  ship: vi.fn(async () => undefined),
}))

vi.mock('evlog', () => ({
  createRequestLogger: mocks.createRequestLogger,
}))

vi.stubGlobal('shipWideEventToAxiom', mocks.ship)

const {
  logClientDisconnect,
  withClientDisconnect,
  withClientDisconnectResponse,
} = await import('~~/server/utils/chats/stream-disconnect')

function createSource(chunks: string[]) {
  let canceled: unknown = null
  const queue = [...chunks]
  const stream = new ReadableStream<string>({
    pull(controller) {
      const next = queue.shift()

      if (next === undefined) {
        controller.close()

        return
      }

      controller.enqueue(next)
    },
    cancel(reason) {
      canceled = reason ?? 'canceled'
    },
  })

  return { stream, wasCanceled: () => canceled }
}

describe('withClientDisconnect', () => {
  it('passes every chunk and never reports a normal end', async () => {
    const onCancel = vi.fn()
    const source = createSource(['a', 'b'])
    const chunks: string[] = []

    for await (const chunk of withClientDisconnect(source.stream, onCancel)) {
      chunks.push(chunk)
    }

    expect(chunks).toEqual(['a', 'b'])
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('reports a cancel once and passes it to the source', async () => {
    const onCancel = vi.fn(() => {
      throw new Error('logging failed')
    })
    const source = createSource(['a', 'b', 'c'])
    const reader = withClientDisconnect(source.stream, onCancel).getReader()

    await reader.read()
    await reader.cancel('client gone')

    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onCancel).toHaveBeenCalledWith('client gone')
    expect(source.wasCanceled()).toBe('client gone')
  })

  it('reports a cancel that arrives through the response pipes', async () => {
    const onCancel = vi.fn()
    const source = createSource(['a', 'b', 'c'])
    const response = withClientDisconnect(source.stream, onCancel)
      .pipeThrough(new TransformStream<string, string>())
      .pipeThrough(new TextEncoderStream())
    const reader = response.getReader()

    await reader.read()
    await reader.cancel('client gone')
    await vi.waitFor(() => {
      expect(onCancel).toHaveBeenCalledWith('client gone')
    })
  })

  it('leaves anything that is not a stream as it is', () => {
    const notAStream = { fake: true } as never

    expect(withClientDisconnect(notAStream, vi.fn())).toBe(notAStream)
  })
})

describe('withClientDisconnectResponse', () => {
  it('keeps status and headers and reports when the body is canceled',
    async () => {
      const onCancel = vi.fn()
      const source = createSource(['data: a\n\n', 'data: b\n\n'])
      const response = withClientDisconnectResponse(
        new Response(source.stream.pipeThrough(new TextEncoderStream()), {
          status: 200,
          headers: { 'x-vercel-ai-ui-message-stream': 'v1' },
        }),
        onCancel,
      )

      expect(response.status).toBe(200)
      expect(response.headers.get('x-vercel-ai-ui-message-stream'))
        .toBe('v1')

      const reader = response.body!.getReader()

      await reader.read()
      await reader.cancel('client gone')
      await vi.waitFor(() => {
        expect(onCancel).toHaveBeenCalledWith('client gone')
      })
    })

  it('passes anything that is not a response through', () => {
    const notAResponse = { ready: Promise.resolve() }

    expect(withClientDisconnectResponse(notAResponse, vi.fn()))
      .toBe(notAResponse)
  })
})

describe('logClientDisconnect', () => {
  it('writes one disconnected event and ships it through waitUntil', () => {
    const waitUntil = vi.fn()

    mocks.createRequestLogger.mockReturnValue({
      set: mocks.set,
      emit: mocks.emit,
    })

    logClientDisconnect({
      aiStreamPath: '/api/v1/chats/01M7XAWDPVDVZ7DTYBZ7Z9AJBE',
      parentRequestId: 'request-1',
      chatId: 'chat-1',
      userId: 7,
      modelId: 'deepseek-v4-flash',
      runId: 'run-1',
      isStoppedRun: false,
      waitUntil,
    })

    expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'client-disconnected',
      _parentRequestId: 'request-1',
      chatId: 'chat-1',
      attributes: {
        generationGuard: { runId: 'run-1', stoppedBeforeDisconnect: false },
      },
    }))
    expect(mocks.emit).toHaveBeenCalledWith({
      message: 'AI stream client disconnected',
      status: 499,
    })
    expect(mocks.ship).toHaveBeenCalledTimes(1)
    expect(waitUntil).toHaveBeenCalledTimes(1)
  })

  it('ends the run first and records the outcome on the event', async () => {
    const waitUntil = vi.fn()
    const order: string[] = []

    mocks.set.mockClear()
    mocks.emit.mockClear()
    mocks.emit.mockImplementation(() => {
      order.push('emit')

      return { message: 'AI stream client disconnected' }
    })
    mocks.createRequestLogger.mockReturnValue({
      set: mocks.set,
      emit: mocks.emit,
    })

    logClientDisconnect({
      aiStreamPath: '/api/v1/chats/01M7XAWDPVDVZ7DTYBZ7Z9AJBE',
      parentRequestId: 'request-1',
      chatId: 'chat-1',
      userId: 7,
      modelId: 'gemini-3.8-flash',
      runId: 'run-1',
      isStoppedRun: false,
      waitUntil,
      endRun: async () => {
        order.push('end-run')

        return { leaseReleased: true }
      },
    })

    expect(waitUntil).toHaveBeenCalledTimes(1)

    await waitUntil.mock.calls[0]?.[0]

    expect(order).toEqual(['end-run', 'emit'])
    expect(mocks.set).toHaveBeenCalledWith({
      attributes: { generationGuard: { leaseReleased: true } },
    })
  })
})
