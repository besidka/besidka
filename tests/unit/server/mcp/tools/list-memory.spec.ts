import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  TEST_MCP_AUTH,
  loadMcpTool,
  parseToolPayload,
} from '../../../../setup/helpers/mcp-tool'

const mocks = vi.hoisted(() => {
  return {
    logger: { set: vi.fn(), error: vi.fn() },
    enforceMcpToolRateLimit: vi.fn(),
    requireMcpLegalConsent: vi.fn(),
    listMcpMemory: vi.fn(),
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

vi.mock('~~/server/utils/mcp/private/memory', () => {
  return {
    mcpMemoryScopes: ['account', 'project', 'all'],
    listMcpMemory: mocks.listMcpMemory,
  }
})

const AUTH = { ...TEST_MCP_AUTH, scopes: ['memory:read'] }

function loadTool(context: Record<string, unknown>) {
  return loadMcpTool(
    () => import('~~/server/mcp/tools/list-memory'),
    context,
  )
}

describe('list_memory tool', () => {
  beforeEach(() => {
    mocks.logger.set.mockReset()
    mocks.enforceMcpToolRateLimit.mockReset()
    mocks.requireMcpLegalConsent.mockReset()
    mocks.listMcpMemory.mockReset()
    mocks.listMcpMemory.mockResolvedValue({
      scope: 'all',
      projectId: null,
      entries: [{ id: 'mem1' }, { id: 'mem2' }],
    })
  })

  it('declares an idempotent read with the documented scope', async () => {
    const tool = await loadTool({ mcpAuth: AUTH })

    expect(tool.name).toBe('list_memory')
    expect(tool.annotations).toEqual({
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    })
    expect(tool.description.endsWith('Requires signing in (memory:read).'))
      .toBe(true)
  })

  it('keeps every argument optional and accepts the three scopes',
    async () => {
      const { inputSchema } = await loadTool({ mcpAuth: AUTH })
      const schema = z.object(inputSchema!)

      expect(schema.safeParse({}).success).toBe(true)
      expect(schema.safeParse({ projectId: 'proj1' }).success).toBe(true)
      expect(schema.safeParse({ scope: 'all' }).success).toBe(true)
      expect(schema.safeParse({ scope: 'project', projectId: 'p' }).success)
        .toBe(true)
      expect(schema.safeParse({ scope: 'workspace' }).success).toBe(false)
    })

  it('passes the scope through and logs the resolved scope', async () => {
    const tool = await loadTool({ mcpAuth: AUTH })
    const payload = parseToolPayload(await tool.handler({ scope: 'all' }))

    expect(mocks.listMcpMemory).toHaveBeenCalledWith(
      { marker: 'db' },
      42,
      { scope: 'all' },
    )
    expect(payload.entries).toHaveLength(2)
    expect(mocks.logger.set).toHaveBeenCalledWith({
      mcp: { memory_scope: 'all', result_count: 2 },
    })
  })

  it('refuses a token without memory:read', async () => {
    const tool = await loadTool({
      mcpAuth: { ...AUTH, scopes: ['memory:write'] },
    })

    await expect(tool.handler({})).rejects.toMatchObject({ status: 403 })
    expect(mocks.listMcpMemory).not.toHaveBeenCalled()
  })
})
