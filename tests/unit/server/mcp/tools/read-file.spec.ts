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
    readMcpFile: vi.fn(),
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
    MCP_FILE_READ_MAX_CHARS: 100_000,
    readMcpFile: mocks.readMcpFile,
  }
})

const AUTH = { ...TEST_MCP_AUTH, scopes: ['files:read'] }

function loadTool(context: Record<string, unknown>) {
  return loadMcpTool(
    () => import('~~/server/mcp/tools/read-file'),
    context,
  )
}

describe('read_file tool', () => {
  beforeEach(() => {
    mocks.logger.set.mockReset()
    mocks.enforceMcpToolRateLimit.mockReset()
    mocks.requireMcpLegalConsent.mockReset()
    mocks.readMcpFile.mockReset()
    mocks.readMcpFile.mockResolvedValue({
      id: 'file1',
      name: 'notes.md',
      type: 'text/plain',
      text: 'hello',
      offset: 0,
      totalChars: 5,
      nextOffset: null,
    })
  })

  it('declares an idempotent read with the documented scope', async () => {
    const tool = await loadTool({ mcpAuth: AUTH })

    expect(tool.name).toBe('read_file')
    expect(tool.annotations).toEqual({
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    })
    expect(tool.description.endsWith('Requires signing in (files:read).'))
      .toBe(true)
  })

  it('requires a file id and bounds the paging arguments', async () => {
    const { inputSchema } = await loadTool({ mcpAuth: AUTH })
    const schema = z.object(inputSchema!)

    expect(schema.safeParse({ fileId: 'file1' }).success).toBe(true)
    expect(schema.safeParse({}).success).toBe(false)
    expect(schema.safeParse({ fileId: 'file1', maxChars: 100_001 }).success)
      .toBe(false)
    expect(schema.safeParse({ fileId: 'file1', maxChars: 0 }).success)
      .toBe(false)
    expect(schema.safeParse({ fileId: 'file1', offset: -1 }).success)
      .toBe(false)
  })

  it('reads for the token user and logs the id and size only', async () => {
    const tool = await loadTool({ mcpAuth: AUTH })
    const payload = parseToolPayload(
      await tool.handler({ fileId: 'file1', offset: 0 }),
    )

    expect(mocks.readMcpFile).toHaveBeenCalledWith(
      { marker: 'db' },
      42,
      { fileId: 'file1', offset: 0 },
    )
    expect(payload).toMatchObject({ text: 'hello', nextOffset: null })
    expect(mocks.logger.set).toHaveBeenCalledWith({
      mcp: { file_id: 'file1', result_chars: 5 },
    })
  })

  it('passes a 404 from the domain through', async () => {
    const tool = await loadTool({ mcpAuth: AUTH })

    mocks.readMcpFile.mockRejectedValue(
      Object.assign(new Error('No file'), { status: 404 }),
    )

    await expect(tool.handler({ fileId: 'nope' })).rejects.toMatchObject({
      status: 404,
    })
  })

  it('refuses a token without files:read', async () => {
    const tool = await loadTool({
      mcpAuth: { ...AUTH, scopes: ['files:write'] },
    })

    await expect(tool.handler({ fileId: 'file1' })).rejects.toMatchObject({
      status: 403,
    })
    expect(mocks.readMcpFile).not.toHaveBeenCalled()
  })
})
