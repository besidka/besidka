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
    renameMcpFile: vi.fn(),
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
    MCP_FILE_NAME_MAX_CHARS: 255,
    renameMcpFile: mocks.renameMcpFile,
  }
})

const AUTH = { ...TEST_MCP_AUTH, scopes: ['files:write'] }

function loadTool(context: Record<string, unknown>) {
  return loadMcpTool(
    () => import('~~/server/mcp/tools/rename-file'),
    context,
  )
}

describe('rename_file tool', () => {
  beforeEach(() => {
    mocks.logger.set.mockReset()
    mocks.enforceMcpToolRateLimit.mockReset()
    mocks.requireMcpLegalConsent.mockReset()
    mocks.renameMcpFile.mockReset()
    mocks.renameMcpFile.mockResolvedValue({ id: 'file1', name: 'new.md' })
  })

  it('declares a destructive idempotent write with the scope', async () => {
    const tool = await loadTool({ mcpAuth: AUTH })

    expect(tool.name).toBe('rename_file')
    expect(tool.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    })
    expect(tool.description.endsWith('Requires signing in (files:write).'))
      .toBe(true)
  })

  it('trims the name and bounds it to 1 to 255 characters', async () => {
    const { inputSchema } = await loadTool({ mcpAuth: AUTH })
    const schema = z.object(inputSchema!)

    expect(schema.parse({ fileId: 'file1', name: '  new.md ' }))
      .toEqual({ fileId: 'file1', name: 'new.md' })
    expect(schema.safeParse({ fileId: 'file1', name: '' }).success)
      .toBe(false)
    expect(schema.safeParse({ fileId: 'file1', name: 'x'.repeat(256) })
      .success).toBe(false)
    expect(schema.safeParse({ name: 'new.md' }).success).toBe(false)
  })

  it('renames for the token user and logs the id only', async () => {
    const tool = await loadTool({ mcpAuth: AUTH })
    const payload = parseToolPayload(
      await tool.handler({ fileId: 'file1', name: 'new.md' }),
    )

    expect(mocks.renameMcpFile).toHaveBeenCalledWith(
      { marker: 'db' },
      42,
      { fileId: 'file1', name: 'new.md' },
    )
    expect(payload).toEqual({ id: 'file1', name: 'new.md' })
    expect(mocks.logger.set).toHaveBeenCalledWith({
      mcp: { file_id: 'file1' },
    })
  })

  it('refuses a token without files:write', async () => {
    const tool = await loadTool({
      mcpAuth: { ...AUTH, scopes: ['files:read'] },
    })

    await expect(
      tool.handler({ fileId: 'file1', name: 'new.md' }),
    ).rejects.toMatchObject({ status: 403 })
    expect(mocks.renameMcpFile).not.toHaveBeenCalled()
  })
})
