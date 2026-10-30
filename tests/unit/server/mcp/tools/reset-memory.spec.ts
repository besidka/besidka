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
    resetMcpMemory: vi.fn(),
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
    resetMcpMemory: mocks.resetMcpMemory,
  }
})

const AUTH = { ...TEST_MCP_AUTH, scopes: ['data:delete'] }

function loadTool(context: Record<string, unknown>) {
  return loadMcpTool(
    () => import('~~/server/mcp/tools/reset-memory'),
    context,
  )
}

describe('reset_memory tool', () => {
  beforeEach(() => {
    mocks.logger.set.mockReset()
    mocks.enforceMcpToolRateLimit.mockReset()
    mocks.requireMcpLegalConsent.mockReset()
    mocks.resetMcpMemory.mockReset()
    mocks.resetMcpMemory.mockResolvedValue({ deleted: 4 })
  })

  it('declares a destructive idempotent write with the scope', async () => {
    const tool = await loadTool({ mcpAuth: AUTH })

    expect(tool.name).toBe('reset_memory')
    expect(tool.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    })
    expect(tool.description.endsWith('Requires signing in (data:delete).'))
      .toBe(true)
  })

  it('requires a scope and the literal confirm true', async () => {
    const { inputSchema } = await loadTool({ mcpAuth: AUTH })
    const schema = z.object(inputSchema!)

    expect(schema.safeParse({ scope: 'all', confirm: true }).success)
      .toBe(true)
    expect(schema.safeParse({ scope: 'all', confirm: false }).success)
      .toBe(false)
    expect(schema.safeParse({ scope: 'all' }).success).toBe(false)
    expect(schema.safeParse({ scope: 'all', confirm: 'true' }).success)
      .toBe(false)
    expect(schema.safeParse({ confirm: true }).success).toBe(false)
    expect(schema.safeParse({ scope: 'everything', confirm: true }).success)
      .toBe(false)
  })

  it('resets for the token user and logs scope and count only', async () => {
    const tool = await loadTool({ mcpAuth: AUTH })
    const payload = parseToolPayload(await tool.handler({
      scope: 'all',
      onlyGenerated: true,
      confirm: true,
    }))

    expect(mocks.resetMcpMemory).toHaveBeenCalledWith(
      { marker: 'db' },
      42,
      { scope: 'all', onlyGenerated: true, confirm: true },
    )
    expect(payload).toEqual({ deleted: 4 })
    expect(mocks.logger.set).toHaveBeenCalledWith({
      mcp: {
        memory_scope: 'all',
        memory_only_generated: true,
        deleted_count: 4,
      },
    })
  })

  it('deletes nothing for a token without data:delete', async () => {
    const tool = await loadTool({
      mcpAuth: { ...AUTH, scopes: ['memory:read'] },
    })

    await expect(
      tool.handler({ scope: 'account', confirm: true }),
    ).rejects.toMatchObject({ status: 403 })
    expect(mocks.resetMcpMemory).not.toHaveBeenCalled()
  })

  it('applies the MCP write limit before deleting', async () => {
    const tool = await loadTool({ mcpAuth: AUTH })

    mocks.enforceMcpToolRateLimit.mockRejectedValue(
      Object.assign(new Error('Too many calls'), { status: 429 }),
    )

    await expect(
      tool.handler({ scope: 'account', confirm: true }),
    ).rejects.toMatchObject({ status: 429 })
    expect(mocks.enforceMcpToolRateLimit)
      .toHaveBeenCalledWith(42, 'reset_memory')
    expect(mocks.resetMcpMemory).not.toHaveBeenCalled()
  })
})
