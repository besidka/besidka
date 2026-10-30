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

  return { ...original, updateMcpKnowledgeItem: mocks.domain }
})

const AUTH = {
  userId: 42,
  clientId: 'client-abc',
  scopes: ['projects:write'],
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

  const module = await import('~~/server/mcp/tools/update-project-knowledge-item')

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

describe('update_project_knowledge_item tool', () => {
  beforeEach(() => {
    mocks.logger.set.mockReset()
    mocks.enforceMcpToolRateLimit.mockReset()
    mocks.requireMcpLegalConsent.mockReset()
    mocks.domain.mockReset()
    mocks.domain.mockResolvedValue({ id: 'item1', title: 'New' })
  })

  it('declares a destructive write with the documented description',
    async () => {
      const tool = await loadTool({ mcpAuth: AUTH })

      expect(tool.name).toBe('update_project_knowledge_item')
      expect(tool.annotations).toEqual({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      })
      expect(tool.description).toMatch(/Requires signing in \(projects:write\)\.$/)
      expect(tool.description).toContain('TypeSafe')
      expect(tool.description).toContain('Notes can change title')
    })

  it('validates the field shapes and never exposes allow flagged',
    async () => {
      const { inputSchema } = await loadTool({ mcpAuth: AUTH })
      const schema = z.object(inputSchema)
      const base = { projectId: 'p', itemId: 'i' }

      expect(schema.safeParse({ ...base, description: null }).success)
        .toBe(true)
      expect(schema.safeParse({
        ...base,
        description: 'x'.repeat(101),
      }).success).toBe(false)
      expect(schema.safeParse({ ...base, title: '' }).success).toBe(false)
      expect(schema.safeParse({ ...base, body: 'x'.repeat(100_001) }).success)
        .toBe(false)
      expect(schema.safeParse({ ...base, pinned: true }).success).toBe(true)
      expect(Object.keys(inputSchema)).not.toContain('allowFlagged')
    })

  it('runs the domain function for the token user and logs ids only',
    async () => {
      const tool = await loadTool({ mcpAuth: AUTH })
      const result = await tool.handler({ projectId: 'proj1', itemId: 'item1', title: 'New' })
      const payload = JSON.parse(result.content[0]!.text)

      expect(mocks.domain).toHaveBeenCalledWith(
        expect.anything(),
        42,
        { projectId: 'proj1', itemId: 'item1', title: 'New' },
        mocks.logger,
      )
      expect(payload).toEqual({ id: 'item1', title: 'New' })
      expect(mocks.logger.set).toHaveBeenCalledWith({
        mcp: { user_id: 42, client_id: 'client-abc', tool_kind: 'write' },
      })
      expect(mocks.logger.set).toHaveBeenCalledWith({
        mcp: { project_id: 'proj1', item_id: 'item1' },
      })
      expect(mocks.enforceMcpToolRateLimit)
        .toHaveBeenCalledWith(42, 'update_project_knowledge_item')
      expect(mocks.requireMcpLegalConsent)
        .toHaveBeenCalledWith(42, 'https://besidka.com', expect.anything())
    })

  it('does nothing for a token without projects:write', async () => {
    const tool = await loadTool({
      mcpAuth: { ...AUTH, scopes: ['projects:read'] },
    })

    await expect(tool.handler({ projectId: 'proj1', itemId: 'item1', title: 'New' })).rejects.toMatchObject({
      status: 403,
    })
    expect(mocks.domain).not.toHaveBeenCalled()
  })

  it('does nothing without a verified token', async () => {
    const tool = await loadTool({})

    await expect(tool.handler({ projectId: 'proj1', itemId: 'item1', title: 'New' })).rejects.toMatchObject({
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

    await expect(tool.handler({ projectId: 'proj1', itemId: 'item1', title: 'New' })).rejects.toMatchObject({
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

    await expect(tool.handler({ projectId: 'proj1', itemId: 'item1', title: 'New' })).rejects.toMatchObject({
      status: 429,
    })
    expect(mocks.domain).not.toHaveBeenCalled()
  })
})
