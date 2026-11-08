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
    listMyFeatures: vi.fn(),
    isFeatureAdminUserId: vi.fn(),
  }
})

vi.mock('~~/server/utils/mcp/admin-scopes', () => {
  return { isFeatureAdminUserId: mocks.isFeatureAdminUserId }
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

vi.mock('~~/server/utils/mcp/private/features', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('~~/server/utils/mcp/private/features')
  >()

  return { ...original, listMyFeatures: mocks.listMyFeatures }
})

const AUTH = { ...TEST_MCP_AUTH, scopes: ['settings:read'] }

function loadTool(context: Record<string, unknown>) {
  vi.stubGlobal('useKV', () => ({ marker: 'kv' }))

  return loadMcpTool(
    () => import('~~/server/mcp/tools/list-my-features'),
    context,
  )
}

const RESULT = { features: [{ key: 'artifacts', enabled: true }] }

const INPUT = undefined

describe('list_my_features tool', () => {
  beforeEach(() => {
    mocks.logger.set.mockReset()
    mocks.enforceMcpToolRateLimit.mockReset()
    mocks.requireMcpLegalConsent.mockReset()
    mocks.listMyFeatures.mockReset().mockResolvedValue(RESULT)
    mocks.isFeatureAdminUserId.mockReset().mockResolvedValue(true)
  })

  it('declares the documented annotations and scope', async () => {
    const tool = await loadTool({ mcpAuth: AUTH })

    expect(tool.name).toBe('list_my_features')
    expect(tool.annotations).toEqual({
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    })
    expect(tool.description.endsWith(
      'Requires signing in (settings:read).',
    )).toBe(true)
  })

  it('runs for the token user and logs the tool kind', async () => {
    const tool = await loadTool({ mcpAuth: AUTH })
    const payload = parseToolPayload(await tool.handler(INPUT))

    expect(mocks.listMyFeatures).toHaveBeenCalledWith(
      { marker: 'db' }, { marker: 'kv' }, 42, mocks.logger,
    )
    expect(payload).toEqual(RESULT)
    expect(mocks.logger.set).toHaveBeenCalledWith({
      mcp: { user_id: 42, client_id: 'client-abc', tool_kind: 'read' },
    })
  })

  it('refuses a token without settings:read', async () => {
    const tool = await loadTool({
      mcpAuth: { ...AUTH, scopes: ['settings:write'] },
    })

    await expect(tool.handler(INPUT)).rejects.toMatchObject({ status: 403 })
    expect(mocks.listMyFeatures).not.toHaveBeenCalled()
  })

  it('needs no admin role', async () => {
    mocks.isFeatureAdminUserId.mockResolvedValue(false)

    const tool = await loadTool({ mcpAuth: AUTH })

    await tool.handler(INPUT)

    expect(mocks.isFeatureAdminUserId).not.toHaveBeenCalled()
    expect(mocks.listMyFeatures).toHaveBeenCalled()
  })

  it('refuses a request without a verified token', async () => {
    const tool = await loadTool({})

    await expect(tool.handler(INPUT)).rejects.toMatchObject({ status: 401 })
  })
})
