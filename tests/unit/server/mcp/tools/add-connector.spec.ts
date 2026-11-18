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

  return { ...original, addMcpConnector: mocks.domain }
})

const SCOPE = 'connectors:write'
const AUTH = {
  userId: 42,
  clientId: 'client-abc',
  scopes: [SCOPE],
}
const VALID_INPUT = { url: 'https://mcp.example.com/mcp', title: 'Example' }

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

  const module = await import('~~/server/mcp/tools/add-connector')

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

describe('add_connector tool', () => {
  beforeEach(() => {
    mocks.logger.set.mockReset()
    mocks.enforceMcpToolRateLimit.mockReset()
    mocks.requireMcpLegalConsent.mockReset()
    mocks.domain.mockReset()
    mocks.domain.mockResolvedValue({
      id: 'abc123',
      title: 'Example',
      host: 'mcp.example.com',
      status: 'needs-auth',
      enabled: false,
      manageUrl: 'https://besidka.com/chats/connectors',
    })
  })

  it('declares the documented annotations and description', async () => {
    const tool = await loadTool({ mcpAuth: AUTH })

    expect(tool.name).toBe('add_connector')
    expect(tool.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    })
    expect(tool.description)
      .toMatch(/Requires signing in \(connectors:write\)\.$/)
    expect(tool.description).not.toContain('data:delete')
    expect(tool.description).toContain('created switched off')
    expect(tool.description).toContain('manageUrl')
    expect(tool.description).toContain('takes no keys or headers')
  })

  it('validates its input', async () => {
    const { inputSchema } = await loadTool({ mcpAuth: AUTH })
    const schema = z.object(inputSchema)

    expect(schema.safeParse(VALID_INPUT).success).toBe(true)
    expect(schema.safeParse({ presetId: 'github' }).success).toBe(true)
    expect(schema.safeParse({ url: '' }).success).toBe(false)
    expect(schema.safeParse({ url: 'x'.repeat(2049) }).success).toBe(false)
    expect(schema.safeParse({ title: 'x'.repeat(81) }).success).toBe(false)
    expect(Object.keys(inputSchema).sort())
      .toEqual(['presetId', 'title', 'url'])
  })

  it('runs the domain function for the token user and logs ids only',
    async () => {
      const tool = await loadTool({ mcpAuth: AUTH })
      const result = await tool.handler(VALID_INPUT)
      const payload = JSON.parse(result.content[0]!.text)

      expect(mocks.domain).toHaveBeenCalledWith(
        { marker: 'connector-context' },
        { url: 'https://mcp.example.com/mcp', title: 'Example' },
      )
      expect(payload).toEqual({
        id: 'abc123',
        title: 'Example',
        host: 'mcp.example.com',
        status: 'needs-auth',
        enabled: false,
        manageUrl: 'https://besidka.com/chats/connectors',
      })
      expect(mocks.logger.set).toHaveBeenCalledWith({
        mcp: {
          user_id: 42,
          client_id: 'client-abc',
          tool_kind: 'write',
        },
      })
      expect(mocks.logger.set).toHaveBeenCalledWith({
        mcp: { connector_id: 'abc123' },
      })
      expect(mocks.enforceMcpToolRateLimit)
        .toHaveBeenCalledWith(42, 'add_connector')
      expect(mocks.requireMcpLegalConsent)
        .toHaveBeenCalledWith(42, 'https://besidka.com', expect.anything())
    })

  it('does nothing for a token without connectors:write', async () => {
    const tool = await loadTool({
      mcpAuth: { ...AUTH, scopes: ['connectors:read'] },
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
