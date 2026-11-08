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
    listMcpFeatureAccess: vi.fn(),
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

vi.mock('~~/server/utils/mcp/private/features', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('~~/server/utils/mcp/private/features')
  >()

  return { ...original, listMcpFeatureAccess: mocks.listMcpFeatureAccess }
})

const AUTH = { ...TEST_MCP_AUTH, scopes: ['admin:features'] }

function loadTool(context: Record<string, unknown>) {
  vi.stubGlobal('useKV', () => ({ marker: 'kv' }))

  return loadMcpTool(
    () => import('~~/server/mcp/tools/list-feature-access'),
    context,
  )
}

const RESULT = { grants: [{ id: 1, userId: 9 }], limit: 100 }

const INPUT = { flag: 'artifacts' }

describe('list_feature_access tool', () => {
  beforeEach(() => {
    mocks.logger.set.mockReset()
    mocks.enforceMcpToolRateLimit.mockReset()
    mocks.requireMcpLegalConsent.mockReset()
    mocks.listMcpFeatureAccess.mockReset().mockResolvedValue(RESULT)
  })

  it('declares the documented annotations and scope', async () => {
    const tool = await loadTool({ mcpAuth: AUTH })

    expect(tool.name).toBe('list_feature_access')
    expect(tool.annotations).toEqual({
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    })
    expect(tool.description.endsWith(
      'Admins only. Requires signing in (admin:features).',
    )).toBe(true)
  })

  it('runs for the token user and logs the tool kind', async () => {
    const tool = await loadTool({ mcpAuth: AUTH })
    const payload = parseToolPayload(await tool.handler(INPUT))

    expect(mocks.listMcpFeatureAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 42,
        clientId: 'client-abc',
      }),
      { flag: 'artifacts' },
    )
    expect(payload).toEqual(RESULT)
    expect(mocks.logger.set).toHaveBeenCalledWith({
      mcp: { user_id: 42, client_id: 'client-abc', tool_kind: 'read' },
    })
  })

  it('refuses a token without admin:features', async () => {
    const tool = await loadTool({
      mcpAuth: { ...AUTH, scopes: ['settings:read'] },
    })

    await expect(tool.handler(INPUT)).rejects.toMatchObject({ status: 403 })
    expect(mocks.listMcpFeatureAccess).not.toHaveBeenCalled()
  })

  it('refuses a request without a verified token', async () => {
    const tool = await loadTool({})

    await expect(tool.handler(INPUT)).rejects.toMatchObject({ status: 401 })
  })
})
