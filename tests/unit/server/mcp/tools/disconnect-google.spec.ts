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

vi.mock('~~/server/utils/mcp/private/google', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('~~/server/utils/mcp/private/google')
  >()

  return { ...original, disconnectMcpGoogle: mocks.domain }
})

const SCOPE = 'connectors:write'
const AUTH = {
  userId: 42,
  clientId: 'client-abc',
  scopes: [SCOPE],
}
const VALID_INPUT = { clientMode: 'besidka', confirm: true }
const RESULT = {
  disconnected: true,
  revoked: true,
  filesDeleted: 2,
  filesPending: false,
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

  const module = await import('~~/server/mcp/tools/disconnect-google')

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

describe('disconnect_google tool', () => {
  beforeEach(() => {
    mocks.logger.set.mockReset()
    mocks.enforceMcpToolRateLimit.mockReset()
    mocks.requireMcpLegalConsent.mockReset()
    mocks.domain.mockReset()
    mocks.domain.mockResolvedValue(RESULT)
  })

  it('declares the documented annotations and description', async () => {
    const tool = await loadTool({ mcpAuth: AUTH })

    expect(tool.name).toBe('disconnect_google')
    expect(tool.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    })
    expect(tool.description)
      .toMatch(/Requires signing in \(connectors:write\)\.$/)
    expect(tool.description).not.toContain('data:delete')
    expect(tool.description).toContain('cannot be undone')
    expect(tool.description).toContain('confirm: true')
    expect(tool.description).toContain('copies of Google Drive files')
    expect(tool.description).toContain('connect again in the Besidka app')
    expect(tool.description).toContain('Cannot connect Google')
  })

  it('validates its input and requires an explicit mode and confirm',
    async () => {
      const { inputSchema } = await loadTool({ mcpAuth: AUTH })
      const schema = z.object(inputSchema)

      expect(schema.safeParse(VALID_INPUT).success).toBe(true)
      expect(schema.safeParse({ clientMode: 'byo', confirm: true }).success)
        .toBe(true)
      expect(schema.safeParse({ confirm: true }).success).toBe(false)
      expect(schema.safeParse({ clientMode: 'besidka' }).success)
        .toBe(false)
      expect(schema.safeParse({ clientMode: 'besidka', confirm: false })
        .success).toBe(false)
      expect(schema.safeParse({ clientMode: 'other', confirm: true }).success)
        .toBe(false)
    })

  it('runs the domain function for the token user and logs counts only',
    async () => {
      const tool = await loadTool({ mcpAuth: AUTH })
      const result = await tool.handler(VALID_INPUT)
      const payload = JSON.parse(result.content[0]!.text)

      expect(mocks.domain).toHaveBeenCalledTimes(1)
      expect(mocks.domain).toHaveBeenCalledWith(
        { db: { marker: 'db' }, userId: 42, logger: mocks.logger },
        { clientMode: 'besidka' },
      )
      expect(payload).toEqual(RESULT)
      expect(mocks.logger.set).toHaveBeenCalledWith({
        mcp: { user_id: 42, client_id: 'client-abc', tool_kind: 'write' },
      })
      expect(mocks.logger.set).toHaveBeenCalledWith({
        mcp: { files_deleted: 2, files_pending: false, revoked: true },
      })
      expect(mocks.enforceMcpToolRateLimit)
        .toHaveBeenCalledWith(42, 'disconnect_google')
      expect(mocks.requireMcpLegalConsent)
        .toHaveBeenCalledWith(42, 'https://besidka.com', expect.anything())
    })

  it('passes the owner mode through when asked for it', async () => {
    const tool = await loadTool({ mcpAuth: AUTH })

    await tool.handler({ clientMode: 'byo', confirm: true })

    expect(mocks.domain).toHaveBeenCalledWith(
      expect.anything(),
      { clientMode: 'byo' },
    )
  })

  it('passes a not-connected 404 on as a readable error', async () => {
    const tool = await loadTool({ mcpAuth: AUTH })

    mocks.domain.mockRejectedValue(createError({
      status: 404,
      message: 'Google is not connected for this client mode.',
    }))

    await expect(tool.handler(VALID_INPUT)).rejects.toMatchObject({
      status: 404,
    })
  })

  it('does nothing for a token without connectors:write', async () => {
    const tool = await loadTool({
      mcpAuth: { ...AUTH, scopes: ['connectors:read', 'data:delete'] },
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
