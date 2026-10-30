import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MCP_MAX_AUTHENTICATED_REQUEST_BODY_BYTES,
  MCP_MAX_REQUEST_BODY_BYTES,
} from '~~/config/mcp-server'
import type { McpTokenVerification } from '~~/server/utils/mcp/auth'
import { MCP_OAUTH_SCOPES } from '#shared/utils/mcp-oauth-scopes'

const mocks = vi.hoisted(() => {
  return {
    setResponseStatus: vi.fn(),
    logger: { set: vi.fn() },
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

vi.mock('~~/server/utils/logging/request-logger', () => {
  return { useRequestLogger: () => mocks.logger }
})

interface GuardEvent {
  req: Request
  url: URL
  context: Record<string, unknown>
  res: { headers: Headers }
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
    context: {},
    res: { headers: new Headers() },
  }
}

const RESOURCE_METADATA_URL
  = 'https://besidka.com/.well-known/oauth-protected-resource/mcp'

const ALL_SCOPES = MCP_OAUTH_SCOPES.join(' ')

const VALID_AUTH = {
  userId: 42,
  clientId: 'client-abc',
  scopes: ['openid', 'chats:read'],
}

async function createGuard(
  body: string | undefined,
  verification: McpTokenVerification = {
    status: 'valid',
    auth: VALID_AUTH,
  },
  readBodyImplementation?: (maxBytes: number) => Promise<string | undefined>,
) {
  vi.resetModules()

  const readBody = vi.fn(readBodyImplementation ?? (async () => body))
  const verifyAccessToken = vi.fn(async () => verification)
  const { createMcpRequestGuard } = await import(
    '~~/server/middleware/01.mcp-request-guard'
  )

  return {
    readBody,
    verifyAccessToken,
    guard: createMcpRequestGuard({
      readBody,
      verifyAccessToken,
      resolveResourceMetadataUrl: () => RESOURCE_METADATA_URL,
    }) as unknown as Guard,
  }
}

function toolsCall(name: string, id: number | string = 1): string {
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    method: 'tools/call',
    params: { name, arguments: {} },
  })
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

  it('answers 413 with a JSON-RPC error above the anonymous limit',
    async () => {
      const { guard, readBody } = await createGuard(TOOLS_CALL)
      const event = createEvent('POST', '/mcp', {
        'content-length': String(MCP_MAX_REQUEST_BODY_BYTES + 1),
      })

      await expect(guard(event)).resolves.toEqual({
        jsonrpc: '2.0',
        error: {
          code: -32600,
          message: expect.stringContaining('Content-Length'),
        },
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

describe('mcp request guard authentication', () => {
  beforeEach(() => {
    mocks.setResponseStatus.mockReset()
    mocks.logger.set.mockReset()
  })

  it('lets anonymous initialize, tools/list and public tools through',
    async () => {
      const bodies = [
        JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
        JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
        toolsCall('list_models'),
      ]

      for (const body of bodies) {
        const { guard, verifyAccessToken } = await createGuard(body)
        const event = createEvent('POST', '/mcp', {
          'content-length': String(body.length),
        })

        await expect(guard(event)).resolves.toBeUndefined()
        expect(verifyAccessToken).not.toHaveBeenCalled()
        expect(event.context.mcpAuth).toBeUndefined()
      }
    })

  it('answers 401 advertising every scope for an anonymous private call',
    async () => {
      const body = toolsCall('list_chats', 'call-7')
      const { guard } = await createGuard(body)
      const event = createEvent('POST', '/mcp', {
        'content-length': String(body.length),
      })

      await expect(guard(event)).resolves.toEqual({
        jsonrpc: '2.0',
        error: { code: -32000, message: expect.any(String) },
        id: 'call-7',
      })
      expect(mocks.setResponseStatus).toHaveBeenCalledWith(event, 401)
      expect(event.res.headers.get('WWW-Authenticate')).toBe(
        `Bearer scope="${ALL_SCOPES}", `
        + `resource_metadata="${RESOURCE_METADATA_URL}"`,
      )
    })

  it('logs the method, tool and auth_required outcome for an anonymous '
    + 'private call', async () => {
    const body = toolsCall('list_chats')
    const { guard } = await createGuard(body)

    await guard(createEvent('POST', '/mcp', {
      'content-length': String(body.length),
    }))

    expect(mocks.logger.set).toHaveBeenCalledWith({
      mcp: {
        method: 'tools/call',
        tool: 'list_chats',
        outcome: 'auth_required',
      },
    })
  })

  it('advertises the same full scope list whatever tool was called',
    async () => {
      const body = toolsCall('add_memory')
      const { guard } = await createGuard(body)
      const event = createEvent('POST', '/mcp', {
        'content-length': String(body.length),
      })

      await guard(event)

      expect(event.res.headers.get('WWW-Authenticate'))
        .toContain(`scope="${ALL_SCOPES}"`)
    })

  it('passes a private call with a token that has the scope', async () => {
    const body = toolsCall('get_chat')
    const { guard, verifyAccessToken } = await createGuard(body)
    const event = createEvent('POST', '/mcp', {
      'content-length': String(body.length),
      'authorization': 'Bearer token',
    })

    await expect(guard(event)).resolves.toBeUndefined()
    expect(verifyAccessToken).toHaveBeenCalledWith('Bearer token')
    expect(event.context.mcpAuth).toEqual(VALID_AUTH)
    expect(mocks.logger.set).toHaveBeenCalledWith({
      mcp: { auth: 'token', user_id: 42, client_id: 'client-abc' },
    })
  })

  it('answers 403 insufficient_scope when the token lacks the scope',
    async () => {
      const body = toolsCall('delete_memory', 3)
      const { guard } = await createGuard(body)
      const event = createEvent('POST', '/mcp', {
        'content-length': String(body.length),
        'authorization': 'Bearer token',
      })

      await expect(guard(event)).resolves.toMatchObject({ id: 3 })
      expect(mocks.setResponseStatus).toHaveBeenCalledWith(event, 403)

      const header = event.res.headers.get('WWW-Authenticate') ?? ''

      expect(header).toMatch(/^Bearer error="insufficient_scope"/)
      expect(header).toContain('scope="openid chats:read data:delete"')
      expect(header).toContain(
        'error_description="The access token is missing the scope '
        + 'data:delete"',
      )
      expect(header).toContain(`resource_metadata="${RESOURCE_METADATA_URL}"`)
      expect(mocks.logger.set).toHaveBeenCalledWith({
        mcp: {
          auth_denied: 'insufficient_scope',
          tool: 'delete_memory',
          outcome: 'insufficient_scope',
        },
      })
    })

  it('keeps granted scopes in the 403 challenge in stable order', async () => {
    const body = toolsCall('delete_memory', 4)
    const { guard } = await createGuard(body, {
      status: 'valid',
      auth: {
        userId: 42,
        clientId: 'client-abc',
        scopes: ['memory:write', 'openid', 'chats:read', 'unknown:scope'],
      },
    })
    const event = createEvent('POST', '/mcp', {
      'content-length': String(body.length),
      'authorization': 'Bearer token',
    })

    await guard(event)

    expect(event.res.headers.get('WWW-Authenticate')).toContain(
      'scope="openid chats:read memory:write data:delete"',
    )
  })

  it('answers 401 invalid_token for an invalid token on any request',
    async () => {
      const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' })
      const { guard, readBody } = await createGuard(body, {
        status: 'invalid',
        reason: 'expired',
      })
      const event = createEvent('POST', '/mcp', {
        'content-length': String(body.length),
        'authorization': 'Bearer expired',
      })

      await guard(event)

      expect(mocks.setResponseStatus).toHaveBeenCalledWith(event, 401)
      expect(event.res.headers.get('WWW-Authenticate'))
        .toMatch(/^Bearer error="invalid_token"/)
      expect(event.res.headers.get('WWW-Authenticate'))
        .toContain(`scope="${ALL_SCOPES}"`)
      expect(event.context.mcpAuth).toBeUndefined()
      expect(readBody).not.toHaveBeenCalled()
    })

  it('answers 503 when verification is unavailable', async () => {
    const { guard } = await createGuard(TOOLS_CALL, {
      status: 'unavailable',
      reason: 'jwks',
    })
    const event = createEvent('POST', '/mcp', {
      'content-length': String(TOOLS_CALL.length),
      'authorization': 'Bearer token',
    })

    await guard(event)

    expect(mocks.setResponseStatus).toHaveBeenCalledWith(event, 503)
    expect(event.res.headers.get('WWW-Authenticate')).toBeNull()
  })

  it('allows up to the authenticated cap only with a verified token',
    async () => {
      const length = String(MCP_MAX_AUTHENTICATED_REQUEST_BODY_BYTES)
      const { guard } = await createGuard(TOOLS_CALL)
      const signedIn = createEvent('POST', '/mcp', {
        'content-length': length,
        'authorization': 'Bearer token',
      })

      await expect(guard(signedIn)).resolves.toBeUndefined()

      const anonymous = createEvent('POST', '/mcp', {
        'content-length': length,
      })

      await guard(anonymous)

      expect(mocks.setResponseStatus).toHaveBeenCalledWith(anonymous, 413)
    })

  it('answers 413 above the authenticated cap without verifying',
    async () => {
      const { guard, verifyAccessToken } = await createGuard(TOOLS_CALL)
      const event = createEvent('POST', '/mcp', {
        'content-length': String(MCP_MAX_AUTHENTICATED_REQUEST_BODY_BYTES + 1),
        'authorization': 'Bearer token',
      })

      await guard(event)

      expect(mocks.setResponseStatus).toHaveBeenCalledWith(event, 413)
      expect(verifyAccessToken).not.toHaveBeenCalled()
    })

  it('still rejects batches from a signed-in client', async () => {
    const batch = `[${toolsCall('list_chats')}]`
    const { guard } = await createGuard(batch)
    const event = createEvent('POST', '/mcp', {
      'content-length': String(batch.length),
      'authorization': 'Bearer token',
    })

    await guard(event)

    expect(mocks.setResponseStatus).toHaveBeenCalledWith(event, 400)
  })

  it('answers a parse error for a body it cannot read', async () => {
    const body = '{"method":"tools/call",'
    const { guard } = await createGuard(body)
    const event = createEvent('POST', '/mcp', {
      'content-length': String(body.length),
    })

    await expect(guard(event)).resolves.toMatchObject({
      error: { code: -32700 },
    })
    expect(mocks.setResponseStatus).toHaveBeenCalledWith(event, 400)
  })

  it('treats a non-Bearer Authorization scheme as anonymous', async () => {
    for (const authorization of ['Basic dXNlcjpwYXNz', 'DPoP abc', 'Bearerx']) {
      mocks.setResponseStatus.mockReset()

      const publicBody = toolsCall('list_models')
      const publicGuard = await createGuard(publicBody)
      const publicEvent = createEvent('POST', '/mcp', {
        'content-length': String(publicBody.length),
        authorization,
      })

      await expect(publicGuard.guard(publicEvent)).resolves.toBeUndefined()
      expect(publicGuard.verifyAccessToken).not.toHaveBeenCalled()
      expect(publicEvent.context.mcpAuth).toBeUndefined()

      const privateBody = toolsCall('list_chats')
      const privateGuard = await createGuard(privateBody)
      const privateEvent = createEvent('POST', '/mcp', {
        'content-length': String(privateBody.length),
        authorization,
      })

      await privateGuard.guard(privateEvent)

      expect(mocks.setResponseStatus).toHaveBeenCalledWith(privateEvent, 401)
      expect(privateEvent.res.headers.get('WWW-Authenticate'))
        .not.toContain('invalid_token')
    }
  })

  it('verifies every Bearer header and answers 401 when it is malformed',
    async () => {
      for (const authorization of ['Bearer', 'bearer', 'BEARER a b']) {
        mocks.setResponseStatus.mockReset()

        const { guard, verifyAccessToken } = await createGuard(
          TOOLS_CALL,
          { status: 'invalid', reason: 'scheme' },
        )
        const event = createEvent('POST', '/mcp', {
          'content-length': String(TOOLS_CALL.length),
          authorization,
        })

        await guard(event)

        expect(verifyAccessToken).toHaveBeenCalledWith(authorization)
        expect(mocks.setResponseStatus).toHaveBeenCalledWith(event, 401)
        expect(event.res.headers.get('WWW-Authenticate'))
          .toMatch(/^Bearer error="invalid_token"/)
      }
    })

  it('reads the body at the effective cap of the caller', async () => {
    const anonymous = await createGuard(TOOLS_CALL)

    await anonymous.guard(createEvent('POST', '/mcp', {
      'content-length': String(TOOLS_CALL.length),
    }))

    expect(anonymous.readBody).toHaveBeenCalledWith(MCP_MAX_REQUEST_BODY_BYTES)

    const signedIn = await createGuard(TOOLS_CALL)

    await signedIn.guard(createEvent('POST', '/mcp', {
      'content-length': String(TOOLS_CALL.length),
      'authorization': 'Bearer token',
    }))

    expect(signedIn.readBody).toHaveBeenCalledWith(
      MCP_MAX_AUTHENTICATED_REQUEST_BODY_BYTES,
    )
  })

  it('answers 413 when the bounded read finds more bytes than declared',
    async () => {
      const { guard } = await createGuard(
        TOOLS_CALL,
        undefined,
        async (maxBytes) => {
          const { McpBodyTooLargeError } = await import(
            '~~/server/utils/mcp/bounded-body'
          )

          throw new McpBodyTooLargeError(maxBytes)
        },
      )
      const event = createEvent('POST', '/mcp', {
        'content-length': '10',
      })

      await expect(guard(event)).resolves.toMatchObject({
        error: { message: expect.stringContaining(
          String(MCP_MAX_REQUEST_BODY_BYTES),
        ) },
      })
      expect(mocks.setResponseStatus).toHaveBeenCalledWith(event, 413)
    })

  it('rethrows a read failure that is not a size violation', async () => {
    const { guard } = await createGuard(
      TOOLS_CALL,
      undefined,
      async () => {
        throw new Error('stream closed')
      },
    )

    await expect(guard(createEvent('POST', '/mcp', {
      'content-length': '10',
    }))).rejects.toThrow('stream closed')
  })

  it('gates a private call behind a byte order mark', async () => {
    const body = `\uFEFF${toolsCall('list_memory')}`
    const { guard } = await createGuard(body)
    const event = createEvent('POST', '/mcp', {
      'content-length': String(body.length),
    })

    await guard(event)

    expect(mocks.setResponseStatus).toHaveBeenCalledWith(event, 401)
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
