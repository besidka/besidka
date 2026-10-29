import { beforeEach, describe, expect, it, vi } from 'vitest'
import { MCP_MAX_REQUEST_BODY_BYTES } from '~~/config/mcp-server'

const mocks = vi.hoisted(() => {
  return {
    setResponseStatus: vi.fn(),
  }
})

vi.mock('nuxt/server', () => {
  return {
    defineEventHandler: (handler: unknown) => {
      return handler
    },
    getRequestHeader: (
      event: { req: Request },
      name: string,
    ) => {
      return event.req.headers.get(name) ?? undefined
    },
    setResponseStatus: mocks.setResponseStatus,
  }
})

interface GuardEvent {
  req: Request
  url: URL
}

type Guard = (event: GuardEvent) => Promise<unknown>

function createEvent(
  method: string,
  path: string,
  headers: Record<string, string> = {},
): GuardEvent {
  const url = new URL(path, 'https://besidka.com')

  return {
    req: new Request(url, { method, headers }),
    url,
  }
}

async function createGuard(body: string | undefined) {
  vi.resetModules()

  const readBody = vi.fn(async () => body)
  const { createMcpRequestGuard } = await import(
    '~~/server/middleware/01.mcp-request-guard'
  )

  return {
    readBody,
    guard: createMcpRequestGuard({ readBody }) as unknown as Guard,
  }
}

const TOOLS_CALL = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'tools/call',
  params: { name: 'list_models', arguments: {} },
})

describe('mcp request guard', () => {
  beforeEach(() => {
    mocks.setResponseStatus.mockReset()
  })

  it('lets a small JSON-RPC POST through and reads the body once',
    async () => {
      const { guard, readBody } = await createGuard(TOOLS_CALL)
      const result = await guard(createEvent('POST', '/mcp', {
        'content-length': String(TOOLS_CALL.length),
      }))

      expect(result).toBeUndefined()
      expect(readBody).toHaveBeenCalledTimes(1)
      expect(mocks.setResponseStatus).not.toHaveBeenCalled()
    })

  it('accepts the trailing slash form and a query string', async () => {
    const { guard } = await createGuard(TOOLS_CALL)

    for (const path of ['/mcp/', '/mcp?x=1']) {
      const result = await guard(createEvent('POST', path, {
        'content-length': '10',
      }))

      expect(result).toBeUndefined()
    }
  })

  it('answers 413 with a JSON-RPC error above the limit', async () => {
    const { guard, readBody } = await createGuard(TOOLS_CALL)
    const event = createEvent('POST', '/mcp', {
      'content-length': String(MCP_MAX_REQUEST_BODY_BYTES + 1),
    })

    await expect(guard(event)).resolves.toEqual({
      jsonrpc: '2.0',
      error: { code: -32600, message: expect.stringContaining('Content-Length') },
      id: null,
    })
    expect(mocks.setResponseStatus).toHaveBeenCalledWith(event, 413)
    expect(readBody).not.toHaveBeenCalled()
  })

  it('accepts a body exactly at the limit', async () => {
    const { guard } = await createGuard(TOOLS_CALL)
    const result = await guard(createEvent('POST', '/mcp', {
      'content-length': String(MCP_MAX_REQUEST_BODY_BYTES),
    }))

    expect(result).toBeUndefined()
  })

  it('answers 413 when content-length is missing (chunked upload)',
    async () => {
      const { guard, readBody } = await createGuard(TOOLS_CALL)
      const event = createEvent('POST', '/mcp', {
        'transfer-encoding': 'chunked',
      })

      await expect(guard(event)).resolves.toMatchObject({ id: null })
      expect(mocks.setResponseStatus).toHaveBeenCalledWith(event, 413)
      expect(readBody).not.toHaveBeenCalled()
    })

  it('answers 413 when content-length is not a plain integer', async () => {
    const { guard } = await createGuard(TOOLS_CALL)

    for (const value of ['abc', '-5', '1e3', '12, 13', '']) {
      mocks.setResponseStatus.mockReset()

      const event = createEvent('POST', '/mcp', { 'content-length': value })

      await guard(event)

      expect(mocks.setResponseStatus).toHaveBeenCalledWith(event, 413)
    }
  })

  it('answers 400 with id null for a JSON-RPC batch array', async () => {
    const batch = `[${TOOLS_CALL},${TOOLS_CALL}]`
    const { guard } = await createGuard(batch)
    const event = createEvent('POST', '/mcp', {
      'content-length': String(batch.length),
    })

    await expect(guard(event)).resolves.toEqual({
      jsonrpc: '2.0',
      error: { code: -32600, message: expect.stringContaining('batch') },
      id: null,
    })
    expect(mocks.setResponseStatus).toHaveBeenCalledWith(event, 400)
  })

  it('detects a batch behind leading whitespace', async () => {
    const batch = `\n  [${TOOLS_CALL}]`
    const { guard } = await createGuard(batch)
    const event = createEvent('POST', '/mcp', {
      'content-length': String(batch.length),
    })

    await guard(event)

    expect(mocks.setResponseStatus).toHaveBeenCalledWith(event, 400)
  })

  it('lets an empty body reach the SDK', async () => {
    const { guard } = await createGuard(undefined)
    const result = await guard(createEvent('POST', '/mcp', {
      'content-length': '0',
    }))

    expect(result).toBeUndefined()
  })

  it('ignores other methods and other paths', async () => {
    const { guard, readBody } = await createGuard(TOOLS_CALL)
    const ignored: Array<[string, string]> = [
      ['GET', '/mcp'],
      ['DELETE', '/mcp'],
      ['POST', '/mcp/deeplink'],
      ['POST', '/mcpx'],
      ['POST', '/api/v1/chats'],
      ['POST', '/'],
    ]

    for (const [method, path] of ignored) {
      const result = await guard(createEvent(method, path))

      expect(result).toBeUndefined()
    }

    expect(readBody).not.toHaveBeenCalled()
    expect(mocks.setResponseStatus).not.toHaveBeenCalled()
  })
})

describe('mcp request guard helpers', () => {
  it('matches only the exact endpoint path', async () => {
    const { isMcpEndpointPath } = await import(
      '~~/server/middleware/01.mcp-request-guard'
    )

    expect(isMcpEndpointPath('/mcp')).toBe(true)
    expect(isMcpEndpointPath('/mcp/')).toBe(true)
    expect(isMcpEndpointPath('/mcp/badge.svg')).toBe(false)
    expect(isMcpEndpointPath('/MCP')).toBe(false)
  })

  it('treats only a leading bracket as a batch', async () => {
    const { isJsonRpcBatch } = await import(
      '~~/server/middleware/01.mcp-request-guard'
    )

    expect(isJsonRpcBatch('[{}]')).toBe(true)
    expect(isJsonRpcBatch('{"a":[1]}')).toBe(false)
    expect(isJsonRpcBatch('')).toBe(false)
    expect(isJsonRpcBatch(undefined)).toBe(false)
  })
})
