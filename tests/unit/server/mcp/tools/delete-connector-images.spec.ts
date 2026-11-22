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
    deleteAllConnectorImages: vi.fn(),
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

vi.mock('~~/server/utils/files/connector-images', () => {
  return { deleteAllConnectorImages: mocks.deleteAllConnectorImages }
})

const AUTH = { ...TEST_MCP_AUTH, scopes: ['data:delete'] }

function loadTool(context: Record<string, unknown>) {
  return loadMcpTool(
    () => import('~~/server/mcp/tools/delete-connector-images'),
    context,
  )
}

describe('delete_connector_images tool', () => {
  beforeEach(() => {
    mocks.logger.set.mockReset()
    mocks.enforceMcpToolRateLimit.mockReset()
    mocks.requireMcpLegalConsent.mockReset()
    mocks.deleteAllConnectorImages.mockReset()
    mocks.deleteAllConnectorImages.mockResolvedValue({
      deleted: 3,
      failed: 0,
      hasMore: false,
    })
  })

  it('declares a destructive idempotent delete under data:delete', async () => {
    const tool = await loadTool({ mcpAuth: AUTH })

    expect(tool.name).toBe('delete_connector_images')
    expect(tool.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    })
    expect(tool.description.endsWith('Requires signing in (data:delete).'))
      .toBe(true)
  })

  it('requires the literal confirm true', async () => {
    const { inputSchema } = await loadTool({ mcpAuth: AUTH })
    const schema = z.object(inputSchema!)

    expect(schema.safeParse({ confirm: true }).success).toBe(true)
    expect(schema.safeParse({ confirm: false }).success).toBe(false)
    expect(schema.safeParse({}).success).toBe(false)
    expect(schema.safeParse({ confirm: 'true' }).success).toBe(false)
  })

  it('deletes for the token user and logs counts only', async () => {
    const tool = await loadTool({ mcpAuth: AUTH })
    const payload = parseToolPayload(await tool.handler({ confirm: true }))

    expect(mocks.deleteAllConnectorImages).toHaveBeenCalledWith(
      { marker: 'db' },
      42,
      expect.anything(),
    )
    expect(payload).toEqual({ deleted: 3, failed: 0, hasMore: false })
    expect(mocks.logger.set).toHaveBeenCalledWith({
      mcp: { deleted_count: 3, failed_count: 0 },
    })
  })

  it('deletes nothing for a token without data:delete', async () => {
    const tool = await loadTool({
      mcpAuth: { ...AUTH, scopes: ['files:read'] },
    })

    await expect(tool.handler({ confirm: true }))
      .rejects.toMatchObject({ status: 403 })
    expect(mocks.deleteAllConnectorImages).not.toHaveBeenCalled()
  })
})
