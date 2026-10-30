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
    applyUserSettingsUpdate: vi.fn(),
    dedupeFavoriteGatewayModels: vi.fn((value: unknown) => value),
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

vi.mock('~~/server/utils/settings/apply-user-settings', () => {
  return {
    applyUserSettingsUpdate: mocks.applyUserSettingsUpdate,
    dedupeFavoriteGatewayModels: mocks.dedupeFavoriteGatewayModels,
  }
})

const AUTH = { ...TEST_MCP_AUTH, scopes: ['settings:write'] }

function loadTool(context: Record<string, unknown>) {
  return loadMcpTool(
    () => import('~~/server/mcp/tools/update-settings'),
    context,
  )
}

describe('update_settings tool', () => {
  beforeEach(() => {
    mocks.logger.set.mockReset()
    mocks.enforceMcpToolRateLimit.mockReset()
    mocks.requireMcpLegalConsent.mockReset()
    mocks.applyUserSettingsUpdate.mockReset()
  })

  it('declares a destructive idempotent write with the scope', async () => {
    const tool = await loadTool({ mcpAuth: AUTH })

    expect(tool.name).toBe('update_settings')
    expect(tool.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    })
    expect(tool.description.endsWith('Requires signing in (settings:write).'))
      .toBe(true)
  })

  it('exposes only the eight allowed settings', async () => {
    const { inputSchema } = await loadTool({ mcpAuth: AUTH })

    expect(Object.keys(inputSchema!).sort()).toEqual([
      'chatSearchEnabled',
      'defaultReasoningLevel',
      'favoriteGatewayModels',
      'favoriteModels',
      'memoryEnabled',
      'reasoningAutoHide',
      'reasoningExpanded',
      'sidebarPinned',
    ])
  })

  it('bounds the favorite models to 50 ids of 100 characters', async () => {
    const { inputSchema } = await loadTool({ mcpAuth: AUTH })
    const schema = z.object(inputSchema!)

    expect(schema.safeParse({
      favoriteModels: Array.from({ length: 50 }, (_item, index) => {
        return `model-${index}`
      }),
    }).success).toBe(true)
    expect(schema.safeParse({
      favoriteModels: Array.from({ length: 51 }, (_item, index) => {
        return `model-${index}`
      }),
    }).success).toBe(false)
    expect(schema.safeParse({ favoriteModels: ['x'.repeat(101)] }).success)
      .toBe(false)
    expect(schema.safeParse({ defaultReasoningLevel: null }).success)
      .toBe(true)
    expect(schema.safeParse({ defaultReasoningLevel: 'extreme' }).success)
      .toBe(false)
  })

  it('writes through the shared settings update for the token user',
    async () => {
      const tool = await loadTool({ mcpAuth: AUTH })
      const payload = parseToolPayload(
        await tool.handler({ sidebarPinned: true }),
      )

      expect(mocks.applyUserSettingsUpdate).toHaveBeenCalledWith({
        db: { marker: 'db' },
        userId: 42,
        fieldUpdates: { sidebarPinned: true },
      })
      expect(payload).toEqual({ sidebarPinned: true })
      expect(mocks.logger.set).toHaveBeenCalledWith({
        mcp: { settings_field_count: 1 },
      })
    })

  it('changes nothing for a token without settings:write', async () => {
    const tool = await loadTool({
      mcpAuth: { ...AUTH, scopes: ['settings:read'] },
    })

    await expect(
      tool.handler({ sidebarPinned: true }),
    ).rejects.toMatchObject({ status: 403 })
    expect(mocks.applyUserSettingsUpdate).not.toHaveBeenCalled()
  })

  it('applies the MCP write limit before changing anything', async () => {
    const tool = await loadTool({ mcpAuth: AUTH })

    mocks.enforceMcpToolRateLimit.mockRejectedValue(
      Object.assign(new Error('Too many calls'), { status: 429 }),
    )

    await expect(
      tool.handler({ sidebarPinned: true }),
    ).rejects.toMatchObject({ status: 429 })
    expect(mocks.applyUserSettingsUpdate).not.toHaveBeenCalled()
  })
})
