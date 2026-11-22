import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createError } from 'evlog'

const mocks = vi.hoisted(() => {
  return {
    logger: { set: vi.fn(), error: vi.fn() },
    enforceMcpToolRateLimit: vi.fn(),
    requireMcpLegalConsent: vi.fn(),
    domain: vi.fn(),
  }
})

vi.mock('nitropack/runtime', () => {
  return {
    defineCachedFunction: vi.fn(),
    useNitroApp: vi.fn(),
    useStorage: vi.fn(),
  }
})

vi.mock('~~/server/utils/logging/request-logger', () => {
  return { useRequestLogger: () => mocks.logger }
})

vi.mock('~~/server/utils/mcp/auth', () => {
  return { resolveMcpSiteUrl: () => 'https://besidka.com' }
})

vi.mock('~~/server/utils/mcp/private-access', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('~~/server/utils/mcp/private-access')
  >()

  return {
    ...original,
    enforceMcpToolRateLimit: mocks.enforceMcpToolRateLimit,
    requireMcpLegalConsent: mocks.requireMcpLegalConsent,
  }
})

vi.mock('~~/server/utils/mcp/private/google', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('~~/server/utils/mcp/private/google')
  >()

  return { ...original, listMcpGoogleConnections: mocks.domain }
})

const SCOPE = 'connectors:read'
const AUTH = {
  userId: 42,
  clientId: 'client-abc',
  scopes: [SCOPE],
}
const RESULT = {
  connections: [
    {
      clientMode: 'besidka',
      connected: true,
      status: 'active',
      capabilities: ['identity', 'drive-picked'],
      connectedAt: '2026-11-20T10:00:00.000Z',
    },
    {
      clientMode: 'byo',
      connected: false,
      status: null,
      capabilities: [],
      connectedAt: null,
    },
  ],
}

async function loadTool(context: Record<string, unknown>) {
  vi.resetModules()
  vi.stubGlobal('defineMcpTool', (definition: unknown) => {
    return definition
  })
  vi.stubGlobal('useEvent', () => {
    return { context }
  })
  vi.stubGlobal('useDb', () => {
    return { marker: 'db' }
  })

  const module = await import('~~/server/mcp/tools/list-google-connections')

  return module.default as unknown as {
    name: string
    description: string
    inputSchema?: unknown
    annotations: Record<string, boolean>
    handler: (input: Record<string, unknown>) => Promise<{
      content: Array<{ type: string, text: string }>
    }>
  }
}

describe('list_google_connections tool', () => {
  beforeEach(() => {
    mocks.logger.set.mockReset()
    mocks.enforceMcpToolRateLimit.mockReset()
    mocks.requireMcpLegalConsent.mockReset()
    mocks.domain.mockReset()
    mocks.domain.mockResolvedValue(RESULT)
  })

  it('declares the documented annotations and description', async () => {
    const tool = await loadTool({ mcpAuth: AUTH })

    expect(tool.name).toBe('list_google_connections')
    expect(tool.inputSchema).toBeUndefined()
    expect(tool.annotations).toEqual({
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    })
    expect(tool.description)
      .toMatch(/Requires signing in \(connectors:read\)\.$/)
    expect(tool.description).not.toContain('data:delete')
    expect(tool.description).toContain('Never returns')
    expect(tool.description).toContain('Connecting is only possible')
  })

  it('runs the domain function as the token user, returns its result and '
    + 'logs counts only', async () => {
    const tool = await loadTool({ mcpAuth: AUTH })
    const result = await tool.handler({})
    const payload = JSON.parse(result.content[0]!.text)

    expect(mocks.domain).toHaveBeenCalledWith({
      db: { marker: 'db' },
      userId: 42,
      logger: mocks.logger,
    })
    expect(payload).toEqual(RESULT)
    expect(mocks.logger.set).toHaveBeenCalledWith({
      mcp: { user_id: 42, client_id: 'client-abc', tool_kind: 'read' },
    })
    expect(mocks.logger.set).toHaveBeenCalledWith({
      mcp: { connection_count: 1 },
    })
    expect(mocks.enforceMcpToolRateLimit)
      .toHaveBeenCalledWith(42, 'list_google_connections')
    expect(mocks.requireMcpLegalConsent)
      .toHaveBeenCalledWith(42, 'https://besidka.com', expect.anything())
  })

  it('returns no email, subject or token in the serialized result',
    async () => {
      const tool = await loadTool({ mcpAuth: AUTH })
      const result = await tool.handler({})

      expect(result.content[0]!.text).not.toMatch(
        /email|subject|token|secret|clientId|googleapis/i,
      )
    })

  it('does nothing for a token without connectors:read', async () => {
    const tool = await loadTool({
      mcpAuth: { ...AUTH, scopes: ['connectors:write', 'chats:read'] },
    })

    await expect(tool.handler({})).rejects.toMatchObject({ status: 403 })
    expect(mocks.domain).not.toHaveBeenCalled()
  })

  it('does nothing without a verified token', async () => {
    const tool = await loadTool({})

    await expect(tool.handler({})).rejects.toMatchObject({ status: 401 })
    expect(mocks.domain).not.toHaveBeenCalled()
  })

  it('does nothing without consent', async () => {
    const tool = await loadTool({ mcpAuth: AUTH })

    mocks.requireMcpLegalConsent.mockRejectedValue(createError({
      status: 403,
      message: 'Open https://besidka.com and accept the terms.',
    }))

    await expect(tool.handler({})).rejects.toMatchObject({ status: 403 })
    expect(mocks.domain).not.toHaveBeenCalled()
  })

  it('does nothing when the call limit is exceeded', async () => {
    const tool = await loadTool({ mcpAuth: AUTH })

    mocks.enforceMcpToolRateLimit.mockRejectedValue(createError({
      status: 429,
      message: 'Too many Besidka tool calls.',
    }))

    await expect(tool.handler({})).rejects.toMatchObject({ status: 429 })
    expect(mocks.domain).not.toHaveBeenCalled()
  })
})
