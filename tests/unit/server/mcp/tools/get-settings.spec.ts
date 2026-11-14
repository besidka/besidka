import { beforeEach, describe, expect, it, vi } from 'vitest'
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
    getMcpSettings: vi.fn(),
    getMcpStorage: vi.fn(),
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

vi.mock('~~/server/utils/mcp/private/settings', () => {
  return {
    getMcpSettings: mocks.getMcpSettings,
    getMcpStorage: mocks.getMcpStorage,
  }
})

const AUTH = { ...TEST_MCP_AUTH, scopes: ['settings:read'] }

function loadTool(context: Record<string, unknown>) {
  return loadMcpTool(
    () => import('~~/server/mcp/tools/get-settings'),
    context,
  )
}

describe('get_settings tool', () => {
  beforeEach(() => {
    mocks.logger.set.mockReset()
    mocks.enforceMcpToolRateLimit.mockReset()
    mocks.requireMcpLegalConsent.mockReset()
    mocks.getMcpSettings.mockReset()
    mocks.getMcpStorage.mockReset()
    mocks.getMcpStorage.mockResolvedValue({
      usedBytes: 12,
      totalBytes: 20,
      categories: [{ id: 'artifacts', bytes: 12, count: 1 }],
    })
    mocks.getMcpSettings.mockResolvedValue({
      reasoningExpanded: false,
      memoryExtractionEnabled: false,
    })
  })

  it('declares an idempotent read with the documented scope', async () => {
    const tool = await loadTool({ mcpAuth: AUTH })

    expect(tool.name).toBe('get_settings')
    expect(tool.annotations).toEqual({
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    })
    expect(tool.inputSchema).toBeUndefined()
    expect(tool.description.endsWith('Requires signing in (settings:read).'))
      .toBe(true)
  })

  it('returns the settings of the token user', async () => {
    const tool = await loadTool({ mcpAuth: AUTH })
    const payload = parseToolPayload(await tool.handler())

    expect(mocks.getMcpSettings).toHaveBeenCalledWith({ marker: 'db' }, 42)
    expect(mocks.getMcpStorage).toHaveBeenCalledWith({ marker: 'db' }, 42)
    expect(payload).toEqual({
      reasoningExpanded: false,
      memoryExtractionEnabled: false,
      storage: {
        usedBytes: 12,
        totalBytes: 20,
        categories: [{ id: 'artifacts', bytes: 12, count: 1 }],
      },
    })
    expect(mocks.logger.set).toHaveBeenCalledWith({
      mcp: { user_id: 42, client_id: 'client-abc', tool_kind: 'read' },
    })
  })

  it('describes the storage block in the tool description', async () => {
    const tool = await loadTool({ mcpAuth: AUTH })

    expect(tool.description).toContain('storage')
    expect(tool.description).toContain('project knowledge')
  })

  it('refuses a token without settings:read', async () => {
    const tool = await loadTool({
      mcpAuth: { ...AUTH, scopes: ['settings:write'] },
    })

    await expect(tool.handler()).rejects.toMatchObject({ status: 403 })
    expect(mocks.getMcpSettings).not.toHaveBeenCalled()
    expect(mocks.getMcpStorage).not.toHaveBeenCalled()
  })

  it('refuses a request without a verified token', async () => {
    const tool = await loadTool({})

    await expect(tool.handler()).rejects.toMatchObject({ status: 401 })
  })
})
