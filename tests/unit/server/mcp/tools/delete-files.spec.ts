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
    deleteMcpFiles: vi.fn(),
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

vi.mock('~~/server/utils/mcp/private/files', () => {
  return {
    MCP_FILE_DELETE_MAX_IDS: 100,
    deleteMcpFiles: mocks.deleteMcpFiles,
  }
})

const AUTH = { ...TEST_MCP_AUTH, scopes: ['data:delete'] }

function loadTool(context: Record<string, unknown>) {
  return loadMcpTool(
    () => import('~~/server/mcp/tools/delete-files'),
    context,
  )
}

describe('delete_files tool', () => {
  beforeEach(() => {
    mocks.logger.set.mockReset()
    mocks.enforceMcpToolRateLimit.mockReset()
    mocks.requireMcpLegalConsent.mockReset()
    mocks.deleteMcpFiles.mockReset()
    mocks.deleteMcpFiles.mockResolvedValue({
      deleted: ['file1'],
      skipped: [{ id: 'file2', reason: 'not_found' }],
    })
  })

  it('declares a destructive idempotent write with the scope', async () => {
    const tool = await loadTool({ mcpAuth: AUTH })

    expect(tool.name).toBe('delete_files')
    expect(tool.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    })
    expect(tool.description.endsWith('Requires signing in (data:delete).'))
      .toBe(true)
  })

  it('takes 1 to 100 file ids', async () => {
    const { inputSchema } = await loadTool({ mcpAuth: AUTH })
    const schema = z.object(inputSchema!)

    expect(schema.safeParse({ fileIds: ['file1'] }).success).toBe(true)
    expect(schema.safeParse({
      fileIds: Array.from({ length: 100 }, (_item, index) => `file${index}`),
    }).success).toBe(true)
    expect(schema.safeParse({
      fileIds: Array.from({ length: 101 }, (_item, index) => `file${index}`),
    }).success).toBe(false)
    expect(schema.safeParse({ fileIds: [] }).success).toBe(false)
    expect(schema.safeParse({}).success).toBe(false)
  })

  it('reports deleted and skipped ids and logs counts only', async () => {
    const tool = await loadTool({ mcpAuth: AUTH })
    const payload = parseToolPayload(
      await tool.handler({ fileIds: ['file1', 'file2'] }),
    )

    expect(mocks.deleteMcpFiles).toHaveBeenCalledWith(
      42,
      { fileIds: ['file1', 'file2'] },
      mocks.logger,
    )
    expect(payload).toEqual({
      deleted: ['file1'],
      skipped: [{ id: 'file2', reason: 'not_found' }],
    })
    expect(mocks.logger.set).toHaveBeenCalledWith({
      mcp: { deleted_count: 1, skipped_count: 1 },
    })
  })

  it('deletes nothing for a token without data:delete', async () => {
    const tool = await loadTool({
      mcpAuth: { ...AUTH, scopes: ['files:read'] },
    })

    await expect(
      tool.handler({ fileIds: ['file1'] }),
    ).rejects.toMatchObject({ status: 403 })
    expect(mocks.deleteMcpFiles).not.toHaveBeenCalled()
  })

  it('deletes nothing without a verified token', async () => {
    const tool = await loadTool({})

    await expect(
      tool.handler({ fileIds: ['file1'] }),
    ).rejects.toMatchObject({ status: 401 })
    expect(mocks.deleteMcpFiles).not.toHaveBeenCalled()
  })
})
