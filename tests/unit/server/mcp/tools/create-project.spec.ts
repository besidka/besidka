import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createError } from 'evlog'

const mocks = vi.hoisted(() => {
  return {
    logger: { set: vi.fn(), error: vi.fn() },
    enforceMcpToolRateLimit: vi.fn(),
    requireMcpLegalConsent: vi.fn(),
    insertValues: vi.fn(),
    insertedRow: undefined as Record<string, unknown> | undefined,
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

vi.mock('~~/server/utils/knowledge/access', () => {
  return { decodeKnowledgeEntityId: vi.fn() }
})

vi.mock('~~/server/utils/knowledge/ingest', () => {
  return {
    createKnowledgeNote: vi.fn(),
    hashKnowledgeText: vi.fn(),
    ingestKnowledgeItems: vi.fn(),
  }
})

vi.mock('~~/server/utils/knowledge/rate-limit', () => {
  return { enforceKnowledgeWriteRateLimit: vi.fn() }
})

vi.mock('~~/server/utils/knowledge/items', () => {
  return { listKnowledgeItems: vi.fn() }
})

vi.mock('~~/server/utils/knowledge/text-store', () => {
  return { getKnowledgeItemText: vi.fn() }
})

const AUTH = {
  userId: 42,
  clientId: 'client-abc',
  scopes: ['projects:write'],
}

const insertChain = {
  values: (value: unknown) => {
    mocks.insertValues(value)

    return insertChain
  },
  returning: () => insertChain,
  get: async () => mocks.insertedRow,
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
    return { insert: () => insertChain }
  })

  const module = await import('~~/server/mcp/tools/create-project')

  return module.default as unknown as {
    name: string
    description: string
    inputSchema: z.ZodRawShape
    annotations: Record<string, boolean>
    handler: (input: { name: string }) => Promise<{
      content: Array<{ type: string, text: string }>
    }>
  }
}

describe('create_project tool', () => {
  beforeEach(() => {
    mocks.logger.set.mockReset()
    mocks.enforceMcpToolRateLimit.mockReset()
    mocks.requireMcpLegalConsent.mockReset()
    mocks.insertValues.mockReset()
    mocks.insertedRow = {
      id: 'projPub1',
      name: 'Vaimo Creative Hours',
      instructions: null,
      knowledgeMode: null,
      pinnedAt: null,
      archivedAt: null,
      activityAt: new Date('2026-10-30T10:00:00.000Z'),
    }
  })

  it('declares a non-destructive write with the documented description',
    async () => {
      const tool = await loadTool({ mcpAuth: AUTH })

      expect(tool.name).toBe('create_project')
      expect(tool.annotations).toEqual({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      })
      expect(tool.description).toContain('list_projects')
      expect(tool.description).toContain('add_project_text')
      expect(tool.description).toContain('projects:write')
    })

  it('accepts names of 1 to 100 characters after trimming', async () => {
    const { inputSchema } = await loadTool({ mcpAuth: AUTH })
    const schema = z.object(inputSchema)

    expect(schema.parse({ name: '  Vaimo  ' })).toEqual({ name: 'Vaimo' })
    expect(schema.safeParse({ name: 'x'.repeat(100) }).success).toBe(true)
    expect(schema.safeParse({ name: 'x'.repeat(101) }).success).toBe(false)
    expect(schema.safeParse({ name: '   ' }).success).toBe(false)
    expect(schema.safeParse({ name: '' }).success).toBe(false)
    expect(schema.safeParse({}).success).toBe(false)
  })

  it('creates the project for the token user and returns the public id',
    async () => {
      const tool = await loadTool({ mcpAuth: AUTH })
      const result = await tool.handler({ name: 'Vaimo Creative Hours' })
      const payload = JSON.parse(result.content[0]!.text)

      expect(mocks.insertValues).toHaveBeenCalledWith({
        userId: 42,
        name: 'Vaimo Creative Hours',
      })
      expect(payload).toMatchObject({
        id: 'projPub1',
        name: 'Vaimo Creative Hours',
        hasInstructions: false,
        knowledgeMode: 'auto',
      })
      expect(mocks.logger.set).toHaveBeenCalledWith({
        mcp: { project_id: 'projPub1' },
      })
      expect(mocks.logger.set).toHaveBeenCalledWith({
        mcp: { user_id: 42, client_id: 'client-abc', tool_kind: 'write' },
      })
    })

  it('applies the MCP write limit and the consent gate in order',
    async () => {
      const tool = await loadTool({ mcpAuth: AUTH })

      await tool.handler({ name: 'Vaimo' })

      expect(mocks.enforceMcpToolRateLimit)
        .toHaveBeenCalledWith(42, 'create_project')
      expect(mocks.requireMcpLegalConsent)
        .toHaveBeenCalledWith(42, 'https://besidka.com', expect.anything())
    })

  it('creates nothing without consent', async () => {
    const tool = await loadTool({ mcpAuth: AUTH })

    mocks.requireMcpLegalConsent.mockRejectedValue(createError({
      status: 403,
      message: 'Open https://besidka.com and accept the terms.',
    }))

    await expect(tool.handler({ name: 'Vaimo' })).rejects.toMatchObject({
      status: 403,
    })
    expect(mocks.insertValues).not.toHaveBeenCalled()
  })

  it('creates nothing when the write limit is exceeded', async () => {
    const tool = await loadTool({ mcpAuth: AUTH })

    mocks.enforceMcpToolRateLimit.mockRejectedValue(createError({
      status: 429,
      message: 'Too many Besidka tool calls.',
    }))

    await expect(tool.handler({ name: 'Vaimo' })).rejects.toMatchObject({
      status: 429,
    })
    expect(mocks.insertValues).not.toHaveBeenCalled()
  })

  it('creates nothing for a token without projects:write', async () => {
    const tool = await loadTool({
      mcpAuth: { ...AUTH, scopes: ['projects:read'] },
    })

    await expect(tool.handler({ name: 'Vaimo' })).rejects.toMatchObject({
      status: 403,
    })
    expect(mocks.insertValues).not.toHaveBeenCalled()
  })

  it('creates nothing without a verified token', async () => {
    const tool = await loadTool({})

    await expect(tool.handler({ name: 'Vaimo' })).rejects.toMatchObject({
      status: 401,
    })
    expect(mocks.insertValues).not.toHaveBeenCalled()
  })
})
