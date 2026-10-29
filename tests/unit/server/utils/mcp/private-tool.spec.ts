import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createError } from 'evlog'

const mocks = vi.hoisted(() => {
  return {
    logger: { set: vi.fn(), error: vi.fn() },
    enforceMcpToolRateLimit: vi.fn(),
    requireMcpLegalConsent: vi.fn(),
    db: { marker: 'db' },
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

const AUTH = {
  userId: 42,
  clientId: 'client-abc',
  scopes: ['memory:read', 'memory:write'],
}

async function loadWrapper(context: Record<string, unknown>) {
  vi.resetModules()
  vi.stubGlobal('useEvent', () => {
    return { context }
  })
  vi.stubGlobal('useDb', () => {
    return mocks.db
  })

  return (await import('~~/server/utils/mcp/private-tool')).withMcpPrivateTool
}

describe('withMcpPrivateTool', () => {
  beforeEach(() => {
    mocks.logger.set.mockReset()
    mocks.enforceMcpToolRateLimit.mockReset()
    mocks.requireMcpLegalConsent.mockReset()
  })

  it('runs the handler after the limit and consent checks', async () => {
    const withMcpPrivateTool = await loadWrapper({ mcpAuth: AUTH })
    const handler = vi.fn(async () => {
      return { entries: [] }
    })
    const tool = withMcpPrivateTool('list_memory', handler)

    await expect(tool({ projectId: 'p1' })).resolves.toEqual({
      content: [{ type: 'text', text: '{"entries":[]}' }],
    })
    expect(mocks.enforceMcpToolRateLimit).toHaveBeenCalledWith(
      42,
      'list_memory',
    )
    expect(mocks.requireMcpLegalConsent).toHaveBeenCalledWith(
      42,
      'https://besidka.com',
      mocks.db,
    )
    expect(handler).toHaveBeenCalledWith(
      { projectId: 'p1' },
      expect.objectContaining({ userId: 42, clientId: 'client-abc' }),
    )
    expect(mocks.logger.set).toHaveBeenCalledWith({
      mcp: { user_id: 42, client_id: 'client-abc', tool_kind: 'read' },
    })
  })

  it('refuses a call without verified auth before any work', async () => {
    const withMcpPrivateTool = await loadWrapper({})
    const handler = vi.fn()
    const tool = withMcpPrivateTool('list_memory', handler)

    await expect(tool({})).rejects.toMatchObject({ status: 401 })
    expect(mocks.enforceMcpToolRateLimit).not.toHaveBeenCalled()
    expect(handler).not.toHaveBeenCalled()
  })

  it('stops at missing consent without running the handler', async () => {
    const withMcpPrivateTool = await loadWrapper({ mcpAuth: AUTH })
    const handler = vi.fn()

    mocks.requireMcpLegalConsent.mockRejectedValue(createError({
      status: 403,
      message: 'Open https://besidka.com and accept the terms.',
    }))

    const tool = withMcpPrivateTool('add_memory', handler)

    await expect(tool({})).rejects.toMatchObject({
      status: 403,
      message: expect.stringContaining('besidka.com'),
    })
    expect(handler).not.toHaveBeenCalled()
    expect(mocks.logger.set).toHaveBeenCalledWith({
      mcp: expect.objectContaining({ tool_kind: 'write' }),
    })
  })

  it('returns a rate limit as a tool error, not an HTTP failure',
    async () => {
      const withMcpPrivateTool = await loadWrapper({ mcpAuth: AUTH })

      mocks.enforceMcpToolRateLimit.mockRejectedValue(createError({
        status: 429,
        message: 'Too many Besidka tool calls.',
      }))

      const tool = withMcpPrivateTool('list_memory', vi.fn())

      await expect(tool({})).rejects.toMatchObject({ status: 429 })
      expect(mocks.requireMcpLegalConsent).not.toHaveBeenCalled()
    })

  it('hides unexpected failures behind the fixed message', async () => {
    const withMcpPrivateTool = await loadWrapper({ mcpAuth: AUTH })
    const tool = withMcpPrivateTool('list_memory', async () => {
      throw new Error('SQLITE_ERROR: secret detail')
    })

    await expect(tool({})).rejects.toMatchObject({
      status: 500,
      message: expect.not.stringContaining('SQLITE'),
    })
  })
})
