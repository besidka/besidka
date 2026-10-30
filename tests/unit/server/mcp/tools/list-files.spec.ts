import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createError } from 'evlog'
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
    listMcpFiles: vi.fn(),
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
    MCP_FILE_LIST_MAX_LIMIT: 50,
    mcpFileListSources: ['all', 'upload', 'assistant', 'project'],
    listMcpFiles: mocks.listMcpFiles,
  }
})

const AUTH = { ...TEST_MCP_AUTH, scopes: ['files:read'] }

function loadTool(context: Record<string, unknown>) {
  return loadMcpTool(
    () => import('~~/server/mcp/tools/list-files'),
    context,
  )
}

describe('list_files tool', () => {
  beforeEach(() => {
    mocks.logger.set.mockReset()
    mocks.enforceMcpToolRateLimit.mockReset()
    mocks.requireMcpLegalConsent.mockReset()
    mocks.listMcpFiles.mockReset()
    mocks.listMcpFiles.mockResolvedValue({
      files: [{ id: 'file1' }],
      total: 1,
      offset: 0,
      nextOffset: null,
      storage: {
        usedBytes: 10,
        totalBytes: 100,
        retentionDays: 30,
        tier: 'free',
      },
    })
  })

  it('declares an idempotent read with the documented scope', async () => {
    const tool = await loadTool({ mcpAuth: AUTH })

    expect(tool.name).toBe('list_files')
    expect(tool.annotations).toEqual({
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    })
    expect(tool.description.endsWith('Requires signing in (files:read).'))
      .toBe(true)
  })

  it('accepts the four sources and limits of 1 to 50', async () => {
    const { inputSchema } = await loadTool({ mcpAuth: AUTH })
    const schema = z.object(inputSchema!)

    expect(schema.safeParse({}).success).toBe(true)
    expect(schema.safeParse({ source: 'project' }).success).toBe(true)
    expect(schema.safeParse({ source: 'library' }).success).toBe(false)
    expect(schema.safeParse({ limit: 51 }).success).toBe(false)
    expect(schema.safeParse({ limit: 0 }).success).toBe(false)
    expect(schema.safeParse({ offset: -1 }).success).toBe(false)
  })

  it('lists for the token user and logs counts only', async () => {
    const tool = await loadTool({ mcpAuth: AUTH })
    const payload = parseToolPayload(
      await tool.handler({ source: 'upload', search: 'report' }),
    )

    expect(mocks.listMcpFiles).toHaveBeenCalledWith(
      { marker: 'db' },
      42,
      { source: 'upload', search: 'report' },
    )
    expect(payload.files).toEqual([{ id: 'file1' }])
    expect(mocks.logger.set).toHaveBeenCalledWith({
      mcp: { user_id: 42, client_id: 'client-abc', tool_kind: 'read' },
    })
    expect(mocks.logger.set).toHaveBeenCalledWith({
      mcp: { file_source: 'upload', result_count: 1, result_total: 1 },
    })
  })

  it('refuses a token without files:read', async () => {
    const tool = await loadTool({
      mcpAuth: { ...AUTH, scopes: ['files:write'] },
    })

    await expect(tool.handler({})).rejects.toMatchObject({ status: 403 })
    expect(mocks.listMcpFiles).not.toHaveBeenCalled()
  })

  it('refuses a request without a verified token', async () => {
    const tool = await loadTool({})

    await expect(tool.handler({})).rejects.toMatchObject({ status: 401 })
  })

  it('passes the consent refusal through', async () => {
    const tool = await loadTool({ mcpAuth: AUTH })

    mocks.requireMcpLegalConsent.mockRejectedValue(createError({
      status: 403,
      message: 'Open https://besidka.com and accept the terms.',
    }))

    await expect(tool.handler({})).rejects.toMatchObject({ status: 403 })
    expect(mocks.listMcpFiles).not.toHaveBeenCalled()
  })
})
