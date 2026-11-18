import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CONNECTOR_SSE_SESSION_MAX_BYTES,
  CONNECTOR_SSE_SESSION_TIMEOUT_MS,
} from '#shared/utils/connectors-policy'
import {
  createConcurrencyLimiter,
  createConnectorClientHandle,
  createConnectorTransportFetch,
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
