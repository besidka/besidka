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
    createMcpFile: vi.fn(),
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
    MCP_FILE_TEXT_MAX_CHARS: 200_000,
    createMcpFile: mocks.createMcpFile,
  }
})

const AUTH = { ...TEST_MCP_AUTH, scopes: ['files:write'] }

function loadTool(context: Record<string, unknown>) {
  return loadMcpTool(
    () => import('~~/server/mcp/tools/create-file'),
    context,
  )
}

describe('create_file tool', () => {
  beforeEach(() => {
    mocks.logger.set.mockReset()
    mocks.enforceMcpToolRateLimit.mockReset()
    mocks.requireMcpLegalConsent.mockReset()
    mocks.createMcpFile.mockReset()
    mocks.createMcpFile.mockResolvedValue({
      id: 'file1',
      name: 'report.md',
      type: 'text/plain',
      size: 11,
      source: 'upload',
      createdAt: '2026-10-30T10:00:00.000Z',
      expiresAt: null,
    })
  })

  it('declares a non-destructive write with the documented scope',
    async () => {
      const tool = await loadTool({ mcpAuth: AUTH })

      expect(tool.name).toBe('create_file')
      expect(tool.annotations).toEqual({
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      })
      expect(tool.description.endsWith('Requires signing in (files:write).'))
        .toBe(true)
    })

  it('bounds the name to 255 and the text to 200000 characters', async () => {
    const { inputSchema } = await loadTool({ mcpAuth: AUTH })
    const schema = z.object(inputSchema!)

    expect(schema.parse({ name: '  report.md  ', text: 'hello' }))
      .toEqual({ name: 'report.md', text: 'hello' })
    expect(schema.safeParse({ name: 'x'.repeat(255), text: 'a' }).success)
      .toBe(true)
    expect(schema.safeParse({ name: 'x'.repeat(256), text: 'a' }).success)
      .toBe(false)
    expect(schema.safeParse({ name: '   ', text: 'a' }).success).toBe(false)
    expect(schema.safeParse({ name: 'a.md', text: '' }).success).toBe(false)
    expect(schema.safeParse({
      name: 'a.md',
      text: 'x'.repeat(200_001),
    }).success).toBe(false)
  })

  it('creates the file for the token user and logs ids only', async () => {
    const tool = await loadTool({ mcpAuth: AUTH })
    const payload = parseToolPayload(
      await tool.handler({ name: 'report.md', text: 'hello world' }),
    )

    expect(mocks.createMcpFile).toHaveBeenCalledWith(
      42,
      { name: 'report.md', text: 'hello world' },
      mocks.logger,
    )
    expect(payload).toMatchObject({ id: 'file1', name: 'report.md' })
    expect(mocks.logger.set).toHaveBeenCalledWith({
      mcp: { user_id: 42, client_id: 'client-abc', tool_kind: 'write' },
    })
    expect(mocks.logger.set).toHaveBeenCalledWith({
      mcp: { file_id: 'file1', file_size: 11 },
    })
  })

  it('passes the quota refusal through', async () => {
    const tool = await loadTool({ mcpAuth: AUTH })

    mocks.createMcpFile.mockRejectedValue(
      Object.assign(new Error('Not enough storage space.'), { status: 413 }),
    )

    await expect(
      tool.handler({ name: 'report.md', text: 'hello' }),
    ).rejects.toMatchObject({ status: 413 })
  })

  it('creates nothing for a token without files:write', async () => {
    const tool = await loadTool({
      mcpAuth: { ...AUTH, scopes: ['files:read'] },
    })

    await expect(
      tool.handler({ name: 'report.md', text: 'hello' }),
    ).rejects.toMatchObject({ status: 403 })
    expect(mocks.createMcpFile).not.toHaveBeenCalled()
  })

  it('applies the MCP write limit before creating', async () => {
    const tool = await loadTool({ mcpAuth: AUTH })

    mocks.enforceMcpToolRateLimit.mockRejectedValue(
      Object.assign(new Error('Too many calls'), { status: 429 }),
    )

    await expect(
      tool.handler({ name: 'report.md', text: 'hello' }),
    ).rejects.toMatchObject({ status: 429 })
    expect(mocks.enforceMcpToolRateLimit)
      .toHaveBeenCalledWith(42, 'create_file')
    expect(mocks.createMcpFile).not.toHaveBeenCalled()
  })
})
