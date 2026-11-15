import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
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

vi.mock('~~/server/utils/mcp/private/connector-context', () => {
  return {
    buildMcpConnectorContext: () => ({ marker: 'connector-context' }),
  }
})

vi.mock('~~/server/utils/mcp/private/connectors', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('~~/server/utils/mcp/private/connectors')
  >()

  return { ...original, getMcpConnector: mocks.domain }
})

const SCOPE = 'connectors:read'
const AUTH = {
  userId: 42,
  clientId: 'client-abc',
  scopes: [SCOPE],
}
const VALID_INPUT = { id: 'abc123' }

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

  const module = await import('~~/server/mcp/tools/get-connector')

  return module.default as unknown as {
    name: string
    description: string
    inputSchema: z.ZodRawShape
    annotations: Record<string, boolean>
    handler: (input: Record<string, unknown>) => Promise<{
      content: Array<{ type: string, text: string }>
    }>
  }
}

describe('get_connector tool', () => {
  beforeEach(() => {
    mocks.logger.set.mockReset()
    mocks.enforceMcpToolRateLimit.mockReset()
    mocks.requireMcpLegalConsent.mockReset()
    mocks.domain.mockReset()
    mocks.domain.mockResolvedValue({ id: 'abc123', tools: [], usage: { callsLast30d: 0 } })
  })

  it('declares the documented annotations and description', async () => {
    const tool = await loadTool({ mcpAuth: AUTH })

    expect(tool.name).toBe('get_connector')
    expect(tool.annotations).toEqual({
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    })
    expect(tool.description)
      .toMatch(/Requires signing in \(connectors:read\)\.$/)
    expect(tool.description).not.toContain('data:delete')
    expect(tool.description).toContain('Tool descriptions are not included')
  })

  it('validates its input', async () => {
    const { inputSchema } = await loadTool({ mcpAuth: AUTH })
    const schema = z.object(inputSchema)

    expect(schema.safeParse(VALID_INPUT).success).toBe(true)
    expect(schema.safeParse({}).success).toBe(false)
    expect(schema.safeParse({ id: '../x' }).success).toBe(false)
    expect(schema.safeParse({ id: '' }).success).toBe(false)
  })

  it('runs the domain function for the token user and logs ids only',
    async () => {
      const tool = await loadTool({ mcpAuth: AUTH })
      const result = await tool.handler(VALID_INPUT)
      const payload = JSON.parse(result.content[0]!.text)

      expect(mocks.domain).toHaveBeenCalledWith(
        { marker: 'connector-context' },
        { id: 'abc123' },
      )
      expect(payload).toEqual({ id: 'abc123', tools: [], usage: { callsLast30d: 0 } })
      expect(mocks.logger.set).toHaveBeenCalledWith({
        mcp: {
          user_id: 42,
          client_id: 'client-abc',
          tool_kind: 'read',
        },
      })
      expect(mocks.logger.set).toHaveBeenCalledWith({
        mcp: { connector_id: 'abc123', tool_count: 0 },
      })
      expect(mocks.enforceMcpToolRateLimit)
        .toHaveBeenCalledWith(42, 'get_connector')
      expect(mocks.requireMcpLegalConsent)
        .toHaveBeenCalledWith(42, 'https://besidka.com', expect.anything())
    })

  it('does nothing for a token without connectors:read', async () => {
    const tool = await loadTool({
      mcpAuth: { ...AUTH, scopes: ['chats:read', 'connectors:write'] },
    })

    await expect(tool.handler(VALID_INPUT)).rejects.toMatchObject({
      status: 403,
    })
    expect(mocks.domain).not.toHaveBeenCalled()
  })

  it('does nothing without a verified token', async () => {
    const tool = await loadTool({})

    await expect(tool.handler(VALID_INPUT)).rejects.toMatchObject({
      status: 401,
    })
    expect(mocks.domain).not.toHaveBeenCalled()
  })

  it('does nothing without consent', async () => {
    const tool = await loadTool({ mcpAuth: AUTH })

    mocks.requireMcpLegalConsent.mockRejectedValue(createError({
      status: 403,
      message: 'Open https://besidka.com and accept the terms.',
    }))

    await expect(tool.handler(VALID_INPUT)).rejects.toMatchObject({
      status: 403,
    })
    expect(mocks.domain).not.toHaveBeenCalled()
  })

  it('does nothing when the call limit is exceeded', async () => {
    const tool = await loadTool({ mcpAuth: AUTH })

    mocks.enforceMcpToolRateLimit.mockRejectedValue(createError({
      status: 429,
      message: 'Too many Besidka tool calls.',
    }))

    await expect(tool.handler(VALID_INPUT)).rejects.toMatchObject({
      status: 429,
    })
    expect(mocks.domain).not.toHaveBeenCalled()
  })
})
