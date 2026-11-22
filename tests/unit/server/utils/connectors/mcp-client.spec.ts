import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CONNECTOR_CALL_RESPONSE_MAX_BYTES,
  CONNECTOR_SSE_SESSION_MAX_BYTES,
  CONNECTOR_SSE_SESSION_TIMEOUT_MS,
} from '#shared/utils/connectors-policy'
import {
  closeAfterJsonRpcResponse,
  createConcurrencyLimiter,
  createConnectorClientHandle,
  createConnectorTransportFetch,
  isSseResponseEvent,
} from '~~/server/utils/connectors/mcp-client'
import type { ConnectorClient } from '~~/server/utils/connectors/mcp-client'

function fakeClient(close = vi.fn(async () => undefined)) {
  return { close } as unknown as ConnectorClient
}

describe('connector transport fetch', () => {
  it('answers the inbound event stream locally with 405 and sends '
    + 'everything else through the mcp safeFetch', async () => {
    const safeFetch = vi.fn(async () => new Response('ok'))
    const createFetch = vi.fn(() => safeFetch as unknown as typeof fetch)
    const transportFetch = createConnectorTransportFetch(
      'streamable-http',
      createFetch,
    )

    const inbound = await transportFetch('https://mcp.example.com/mcp', {
      method: 'GET',
      headers: { accept: 'text/event-stream' },
    })
    const missingMethod = await transportFetch('https://mcp.example.com/mcp')

    expect(inbound.status).toBe(405)
    expect(missingMethod.status).toBe(405)
    expect(safeFetch).not.toHaveBeenCalled()

    await transportFetch('https://mcp.example.com/mcp', { method: 'POST' })
    await transportFetch('https://mcp.example.com/mcp', { method: 'DELETE' })

    expect(createFetch).toHaveBeenCalledWith('mcp')
    expect(safeFetch).toHaveBeenCalledTimes(2)
  })

  async function sentInits(largeCallResponses: boolean) {
    const safeFetch = vi.fn(async () => new Response('ok'))
    const createFetch = vi.fn(() => safeFetch as unknown as typeof fetch)
    const transportFetch = createConnectorTransportFetch(
      'streamable-http',
      createFetch,
      undefined,
      true,
      largeCallResponses,
    )
    const message = (method: string) => {
      return JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: {} })
    }

    await transportFetch('https://mcp.example.com/mcp', {
      method: 'POST',
      body: message('tools/call'),
    })
    await transportFetch('https://mcp.example.com/mcp', {
      method: 'POST',
      body: message('tools/list'),
    })
    await transportFetch('https://mcp.example.com/mcp', {
      method: 'POST',
      body: 'not json',
    })

    return safeFetch.mock.calls.map((call) => {
      return (call as unknown as [string, Record<string, unknown>])[1]
    })
  }

  it('raises the body cap to 8 MiB for tools/call of an image send only',
    async () => {
      const inits = await sentInits(true)

      expect(inits[0]?.maxResponseBytes)
        .toBe(CONNECTOR_CALL_RESPONSE_MAX_BYTES)
      expect(inits[1]).not.toHaveProperty('maxResponseBytes')
      expect(inits[2]).not.toHaveProperty('maxResponseBytes')
    })

  it('keeps the 1 MiB default for every request of a send without images',
    async () => {
      const inits = await sentInits(false)

      for (const init of inits) {
        expect(init).not.toHaveProperty('maxResponseBytes')
      }
    })

  it('gives the legacy SSE transport a session deadline and size cap',
    () => {
      const createFetch = vi.fn(() => vi.fn() as unknown as typeof fetch)

      createConnectorTransportFetch('sse', createFetch)

      expect(createFetch).toHaveBeenCalledWith('mcp', {
        timeoutMs: CONNECTOR_SSE_SESSION_TIMEOUT_MS,
        maxResponseBytes: CONNECTOR_SSE_SESSION_MAX_BYTES,
      })
    })
})

describe('closeAfterJsonRpcResponse', () => {
  const encoder = new TextEncoder()

  function openStream(chunks: string[], keepsOpen = true) {
    let canceled = false
    const queue = [...chunks]
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const next = queue.shift()

        if (next !== undefined) {
          controller.enqueue(encoder.encode(next))

          return
        }

        if (!keepsOpen) {
          controller.close()
        }
      },
      cancel() {
        canceled = true
      },
    })

    return {
      response: new Response(body, {
        headers: { 'content-type': 'text/event-stream' },
      }),
      isCanceled: () => canceled,
    }
  }

  it('recognizes the response event, also in a batch, and nothing else',
    () => {
      const response = JSON.stringify({ jsonrpc: '2.0', id: 7, result: {} })

      expect(isSseResponseEvent(`event: message\ndata: ${response}`, 7))
        .toBe(true)
      expect(isSseResponseEvent(`data: [${response}]`, 7)).toBe(true)
      expect(isSseResponseEvent(`data: ${response}`, 8)).toBe(false)
      expect(isSseResponseEvent(`event: ping\ndata: ${response}`, 7))
        .toBe(false)
      expect(isSseResponseEvent(': keep-alive', 7)).toBe(false)
      expect(isSseResponseEvent(
        'data: {"jsonrpc":"2.0","method":"notifications/progress"}',
        7,
      )).toBe(false)
    })

  it('ends a stream the server keeps open once the response arrived',
    async () => {
      const response = JSON.stringify({ jsonrpc: '2.0', id: 3, result: {} })
      const progress = JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/progress',
      })
      const stream = openStream([
        `data: ${progress}\n\n`,
        `data: ${response.slice(0, 10)}`,
        `${response.slice(10)}\n\n`,
      ])
      const closed = closeAfterJsonRpcResponse(stream.response, 3)
      const text = await closed.text()

      expect(text).toBe(`data: ${progress}\n\ndata: ${response}\n\n`)
      expect(stream.isCanceled()).toBe(true)
    })

  it('finds a CRLF separator split across chunks', async () => {
    const response = JSON.stringify({ jsonrpc: '2.0', id: 'a1', result: {} })
    const stream = openStream([
      `event: message\r\ndata: ${response}\r\n`,
      '\r\n',
      'data: never read\r\n\r\n',
    ])
    const text = await closeAfterJsonRpcResponse(stream.response, 'a1').text()

    expect(text).toBe(`event: message\r\ndata: ${response}\r\n\r\n`)
    expect(stream.isCanceled()).toBe(true)
  })

  it('leaves JSON answers and requests without an id alone', async () => {
    const json = new Response('{}', {
      headers: { 'content-type': 'application/json' },
    })

    expect(closeAfterJsonRpcResponse(json, 1)).toBe(json)

    const safeFetch = vi.fn(async () => openStream(['data: x\n\n'], false).response)
    const transportFetch = createConnectorTransportFetch(
      'streamable-http',
      vi.fn(() => safeFetch as unknown as typeof fetch),
    )
    const notification = await transportFetch('https://mcp.example.com/mcp', {
      method: 'POST',
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/x' }),
    })

    expect(await notification.text()).toBe('data: x\n\n')
  })
})

describe('connector transport fetch logging', () => {
  it('scopes the safe-fetch net record under the connectors attributes', () => {
    const createFetch = vi.fn(() => vi.fn() as unknown as typeof fetch)
    const logged: unknown[] = []

    createConnectorTransportFetch(
      'streamable-http',
      createFetch,
      { set: (values: unknown) => logged.push(values) } as never,
    )

    const options = (createFetch.mock.calls[0] as unknown as [
      string,
      { logger: { set: (data: Record<string, unknown>) => void } },
    ])[1]

    options.logger.set({ attributes: { net: { status: 429 } } })
    options.logger.set({ other: true })

    expect(logged).toEqual([
      { attributes: { connectors: { net: { status: 429 } } } },
    ])
  })
})

describe('connector transport fetch host logging', () => {
  function netLogger(logsHost: boolean) {
    const createFetch = vi.fn(() => vi.fn() as unknown as typeof fetch)
    const logged: unknown[] = []

    createConnectorTransportFetch(
      'streamable-http',
      createFetch,
      { set: (values: unknown) => logged.push(values) } as never,
      logsHost,
    )

    const options = (createFetch.mock.calls[0] as unknown as [
      string,
      { logger: { set: (data: Record<string, unknown>) => void } },
    ])[1]

    options.logger.set({
      attributes: { net: { host: 'mcp.private.example', status: 502 } },
    })

    return logged
  }

  it('drops the host for a custom connector and keeps the status', () => {
    expect(netLogger(false)).toEqual([
      { attributes: { connectors: { net: { status: 502 } } } },
    ])
  })

  it('keeps the host for a preset connector', () => {
    expect(netLogger(true)).toEqual([{
      attributes: {
        connectors: { net: { host: 'mcp.private.example', status: 502 } },
      },
    }])
  })
})

describe('concurrency limiter', () => {
  it('runs at most the given number of tasks at once', async () => {
    const limiter = createConcurrencyLimiter(3)
    let active = 0
    let peak = 0
    const releases: Array<() => void> = []
    const tasks = Array.from({ length: 7 }, () => {
      return limiter.run(async () => {
        active += 1
        peak = Math.max(peak, active)
        await new Promise<void>(resolve => releases.push(resolve))
        active -= 1
      })
    })

    await vi.waitFor(() => expect(releases).toHaveLength(3))
    expect(peak).toBe(3)

    while (releases.length > 0) {
      releases.shift()!()
      await new Promise(resolve => setTimeout(resolve, 0))
    }

    await Promise.all(tasks)

    expect(peak).toBe(3)
    expect(active).toBe(0)
  })

  it('releases the slot when a task throws', async () => {
    const limiter = createConcurrencyLimiter(1)

    await expect(limiter.run(async () => {
      throw new Error('boom')
    })).rejects.toThrow('boom')
    await expect(limiter.run(async () => 'next')).resolves.toBe('next')
  })
})

describe('connector client handle', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  function createHandle(overrides: {
    createClient?: (...args: never[]) => Promise<ConnectorClient>
    resolveAuth?: (rejectedToken?: string) => Promise<{
      headers: Record<string, string>
      secrets: string[]
    } | null>
  } = {}) {
    const createClient = vi.fn(
      overrides.createClient ?? (async () => fakeClient()),
    )

    return {
      createClient,
      handle: createConnectorClientHandle({
        connectorId: 'c1',
        slug: 'linear',
        url: 'https://mcp.linear.app/mcp',
        transport: 'streamable-http',
        resolveAuth: overrides.resolveAuth
          ?? (async () => ({ headers: { Authorization: 'Bearer t1' }, secrets: [] })),
        limiter: createConcurrencyLimiter(3),
        dependencies: { createClient: createClient as never },
      }),
    }
  }

  it('does not connect until a client is requested and connects once',
    async () => {
      const { handle, createClient } = createHandle()

      expect(createClient).not.toHaveBeenCalled()

      const first = await handle.getClient()
      const second = await handle.getClient()

      expect(first).toBe(second)
      expect(createClient).toHaveBeenCalledTimes(1)
      expect(createClient.mock.calls[0]![0]).toMatchObject({
        transport: {
          type: 'http',
          url: 'https://mcp.linear.app/mcp',
          headers: { Authorization: 'Bearer t1' },
        },
      })
    })

  it('closes an open client once and a never-opened handle without '
    + 'connecting', async () => {
    const close = vi.fn(async () => undefined)
    const opened = createHandle({ createClient: async () => fakeClient(close) })
    const idle = createHandle()

    await opened.handle.getClient()
    await opened.handle.close()
    await opened.handle.close()
    await idle.handle.close()

    expect(close).toHaveBeenCalledTimes(1)
    expect(idle.createClient).not.toHaveBeenCalled()
    await expect(opened.handle.getClient()).rejects.toMatchObject({
      code: 'CONNECTOR_UNREACHABLE',
    })
  })

  it('retries once with the rejected token after a 401', async () => {
    const resolveAuth = vi.fn(async (rejectedToken?: string) => ({
      headers: { Authorization: `Bearer ${rejectedToken ? 'fresh' : 'stale'}` },
      secrets: [],
    }))
    const createClient = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('401'), {
        statusCode: 401,
      }))
      .mockResolvedValueOnce(fakeClient())
    const { handle } = createHandle({
      resolveAuth,
      createClient: createClient as never,
    })

    await handle.getClient()

    expect(resolveAuth.mock.calls.map(call => call[0]))
      .toEqual([undefined, 'stale'])
    expect(createClient).toHaveBeenCalledTimes(2)
  })

  it('does not retry a non-401 failure and keeps the failure', async () => {
    const createClient = vi.fn().mockRejectedValue(
      Object.assign(new Error('500'), { statusCode: 500 }),
    )
    const { handle } = createHandle({ createClient: createClient as never })

    await expect(handle.getClient()).rejects.toThrow('500')
    expect(createClient).toHaveBeenCalledTimes(1)
  })

  it('fails when the credentials are gone', async () => {
    const { handle, createClient } = createHandle({
      resolveAuth: async () => null,
    })

    await expect(handle.getClient()).rejects.toMatchObject({
      code: 'CONNECTOR_REAUTH_REQUIRED',
    })
    expect(createClient).not.toHaveBeenCalled()
  })

  it('gives up after ten seconds and closes a client that connects '
    + 'late', async () => {
    vi.useFakeTimers()

    const close = vi.fn(async () => undefined)
    let finish: (client: ConnectorClient) => void = () => {}
    const { handle } = createHandle({
      createClient: () => new Promise((resolve) => {
        finish = resolve
      }),
    })
    const pending = handle.getClient()
    const assertion = expect(pending).rejects.toMatchObject({
      code: 'CONNECTOR_UNREACHABLE',
    })

    await vi.advanceTimersByTimeAsync(10_001)
    await assertion

    finish(fakeClient(close))
    await vi.advanceTimersByTimeAsync(0)

    expect(close).toHaveBeenCalledTimes(1)
  })
})
