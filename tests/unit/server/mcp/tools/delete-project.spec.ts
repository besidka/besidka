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

vi.mock('~~/server/utils/mcp/private/projects', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('~~/server/utils/mcp/private/projects')
  >()

  return { ...original, deleteMcpProject: mocks.domain }
})

const AUTH = {
  userId: 42,
  clientId: 'client-abc',
  scopes: ['data:delete'],
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

  const module = await import('~~/server/mcp/tools/delete-project')

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

describe('delete_project tool', () => {
  beforeEach(() => {
    mocks.logger.set.mockReset()
    mocks.enforceMcpToolRateLimit.mockReset()
    mocks.requireMcpLegalConsent.mockReset()
    mocks.domain.mockReset()
    mocks.domain.mockResolvedValue({ id: 'proj1', deleted: true, chatsDetached: 3 })
  })

  it('declares a destructive write with the documented description',
    async () => {
      const tool = await loadTool({ mcpAuth: AUTH })

      expect(tool.name).toBe('delete_project')
      expect(tool.annotations).toEqual({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: false,
      })
      expect(tool.description).toMatch(/Requires signing in \(data:delete\)\.$/)
      expect(tool.description).toContain('confirmName')
      expect(tool.description).toContain('cannot be undone')
    })

  it('requires the project id and a confirmation name', async () => {
    const { inputSchema } = await loadTool({ mcpAuth: AUTH })
    const schema = z.object(inputSchema)

    expect(schema.safeParse({ projectId: 'p', confirmName: 'Vaimo' }).success)
      .toBe(true)
    expect(schema.safeParse({ projectId: 'p' }).success).toBe(false)
    expect(schema.safeParse({ projectId: 'p', confirmName: '' }).success)
      .toBe(false)
    expect(schema.safeParse({
      projectId: 'p',
      confirmName: 'x'.repeat(101),
    }).success).toBe(false)
  })

  it('runs the domain function for the token user and logs ids only',
    async () => {
      const tool = await loadTool({ mcpAuth: AUTH })
      const result = await tool.handler({ projectId: 'proj1', confirmName: 'Vaimo' })
      const payload = JSON.parse(result.content[0]!.text)

      expect(mocks.domain).toHaveBeenCalledWith(
        expect.anything(),
        42,
        { projectId: 'proj1', confirmName: 'Vaimo' },
        mocks.logger,
      )
      expect(payload).toEqual({ id: 'proj1', deleted: true, chatsDetached: 3 })
      expect(mocks.logger.set).toHaveBeenCalledWith({
        mcp: { user_id: 42, client_id: 'client-abc', tool_kind: 'write' },
      })
      expect(mocks.logger.set).toHaveBeenCalledWith({
        mcp: { project_id: 'proj1', chats_detached: 3 },
      })
      expect(mocks.enforceMcpToolRateLimit)
        .toHaveBeenCalledWith(42, 'delete_project')
      expect(mocks.requireMcpLegalConsent)
        .toHaveBeenCalledWith(42, 'https://besidka.com', expect.anything())
    })

  it('does nothing for a token without data:delete', async () => {
    const tool = await loadTool({
      mcpAuth: { ...AUTH, scopes: ['projects:read'] },
    })

    await expect(tool.handler({ projectId: 'proj1', confirmName: 'Vaimo' })).rejects.toMatchObject({
      status: 403,
    })
    expect(mocks.domain).not.toHaveBeenCalled()
  })

  it('does nothing without a verified token', async () => {
    const tool = await loadTool({})

    await expect(tool.handler({ projectId: 'proj1', confirmName: 'Vaimo' })).rejects.toMatchObject({
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

    await expect(tool.handler({ projectId: 'proj1', confirmName: 'Vaimo' })).rejects.toMatchObject({
      status: 403,
    })
    expect(mocks.domain).not.toHaveBeenCalled()
  })

  it('does nothing when the write limit is exceeded', async () => {
    const tool = await loadTool({ mcpAuth: AUTH })

    mocks.enforceMcpToolRateLimit.mockRejectedValue(createError({
      status: 429,
      message: 'Too many Besidka tool calls.',
    }))

    await expect(tool.handler({ projectId: 'proj1', confirmName: 'Vaimo' })).rejects.toMatchObject({
      status: 429,
    })
    expect(mocks.domain).not.toHaveBeenCalled()
  })
})
