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
    getDebugInfo: vi.fn(),
    isMcpConnectorsAvailable: vi.fn(),
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

vi.mock('~~/server/utils/mcp/private/connectors', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('~~/server/utils/mcp/private/connectors')
  >()

  return {
    ...original,
    isMcpConnectorsAvailable: mocks.isMcpConnectorsAvailable,
  }
})

vi.mock('~~/server/utils/mcp/private/debug-info', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('~~/server/utils/mcp/private/debug-info')
  >()

  return { ...original, getDebugInfo: mocks.getDebugInfo }
})

const AUTH = { ...TEST_MCP_AUTH, scopes: ['chats:read'] }
const SLUG = '01JABCDEFGHJKMNPQRSTVWXYZ0'
const CURRENT_SLUG = '01JABCDEFGHJKMNPQRSTVWXYZ1'
const INFO = {
  generatedAt: '2026-11-20T10:00:00.000Z',
  app: { buildId: 'build-abc', mcpServerVersion: '5.3.0' },
  chat: null,
  connectors: null,
  connectorsNote: null,
  features: null,
  contact: 'Contact line.',
}

function loadTool(context: Record<string, unknown>) {
  vi.stubGlobal('useKV', () => ({ marker: 'kv' }))
  return loadMcpTool(
    () => import('~~/server/mcp/tools/get-debug-info'),
    context,
  )
}

describe('get_debug_info tool over MCP', () => {
  beforeEach(() => {
    mocks.logger.set.mockReset()
    mocks.enforceMcpToolRateLimit.mockReset()
    mocks.requireMcpLegalConsent.mockReset()
    mocks.getDebugInfo.mockReset().mockResolvedValue(INFO)
    mocks.isMcpConnectorsAvailable.mockReset().mockResolvedValue(true)
  })

  it('declares a read-only tool under chats:read', async () => {
    const tool = await loadTool({ mcpAuth: AUTH })

    expect(tool.name).toBe('get_debug_info')
    expect(tool.annotations).toEqual({
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    })
    expect(tool.description.endsWith('Requires signing in (chats:read).'))
      .toBe(true)
  })

  it('returns the structured data and one report block', async () => {
    const tool = await loadTool({ mcpAuth: AUTH })
    const payload = parseToolPayload(await tool.handler({ slug: SLUG }))

    expect(payload.report).toContain('Besidka debug info')
    expect(payload.report).toContain('App build: build-abc')
    expect(payload.app).toEqual(INFO.app)
  })

  it('reads the given chat with the default message count', async () => {
    const tool = await loadTool({ mcpAuth: AUTH })

    await tool.handler({ slug: SLUG })

    expect(mocks.getDebugInfo).toHaveBeenCalledWith(
      { marker: 'db' },
      { marker: 'kv' },
      42,
      expect.objectContaining({
        slug: SLUG,
        maxMessages: 10,
        siteUrl: 'https://besidka.com',
        buildId: expect.any(String),
        supportEmail: expect.any(String),
      }),
      mocks.logger,
    )
  })

  it('leaves connectors and features out without their scopes', async () => {
    const tool = await loadTool({ mcpAuth: AUTH })

    await tool.handler({ slug: SLUG })

    expect(mocks.getDebugInfo.mock.calls[0]?.[3]).toMatchObject({
      includeConnectors: false,
      includeFeatures: false,
    })
  })

  it('adds connectors and features with connectors:read and settings:read',
    async () => {
      const tool = await loadTool({
        mcpAuth: {
          ...AUTH,
          scopes: ['chats:read', 'connectors:read', 'settings:read'],
        },
      })

      await tool.handler({ slug: SLUG })

      expect(mocks.getDebugInfo.mock.calls[0]?.[3]).toMatchObject({
        includeConnectors: true,
        includeFeatures: true,
      })
    })

  it('leaves connectors out when the connectors feature is off', async () => {
    mocks.isMcpConnectorsAvailable.mockResolvedValue(false)

    const tool = await loadTool({
      mcpAuth: { ...AUTH, scopes: ['chats:read', 'connectors:read'] },
    })

    await tool.handler({ slug: SLUG })

    expect(mocks.getDebugInfo.mock.calls[0]?.[3]).toMatchObject({
      includeConnectors: false,
    })
  })

  it('does not check the connectors feature without connectors:read',
    async () => {
      const tool = await loadTool({ mcpAuth: AUTH })

      await tool.handler({ slug: SLUG })

      expect(mocks.isMcpConnectorsAvailable).not.toHaveBeenCalled()
    })

  it('adds the list_chats hint to a 404 over MCP', async () => {
    const { createError } = await import('evlog')

    mocks.getDebugInfo.mockRejectedValue(
      createError({ message: 'Chat not found.', status: 404 }),
    )

    const tool = await loadTool({ mcpAuth: AUTH })

    await expect(tool.handler({ slug: SLUG })).rejects.toMatchObject({
      status: 404,
      message: 'Chat not found. Call list_chats to find one.',
    })
  })

  it('answers account information when no slug is given over MCP',
    async () => {
      const tool = await loadTool({ mcpAuth: AUTH })

      await tool.handler({})

      expect(mocks.getDebugInfo.mock.calls[0]?.[3]).toMatchObject({
        slug: null,
      })
    })

  it('refuses a token without chats:read', async () => {
    const tool = await loadTool({
      mcpAuth: { ...AUTH, scopes: ['chats:write'] },
    })

    await expect(tool.handler({ slug: SLUG }))
      .rejects.toMatchObject({ status: 403 })
    expect(mocks.getDebugInfo).not.toHaveBeenCalled()
  })

  it('refuses a request without a verified token', async () => {
    const tool = await loadTool({})

    await expect(tool.handler({ slug: SLUG }))
      .rejects.toMatchObject({ status: 401 })
  })
})

describe('get_debug_info tool in a chat', () => {
  beforeEach(() => {
    mocks.getDebugInfo.mockReset().mockResolvedValue(INFO)
    mocks.isMcpConnectorsAvailable.mockReset().mockResolvedValue(true)
    vi.stubGlobal('useKV', () => ({ marker: 'kv' }))
  })

  async function runInChat(
    input: Record<string, unknown>,
    currentChatSlug: string | undefined,
  ) {
    vi.stubGlobal('useDb', () => ({ marker: 'db' }))

    const { getDebugInfoBesidkaTool } = await import(
      '~~/server/utils/besidka-tools/tools/get-debug-info'
    )

    return await getDebugInfoBesidkaTool.handler(input as never, {
      userId: 42,
      clientId: 'besidka-chat',
      scopes: [],
      currentChatSlug,
      db: { marker: 'db' } as never,
      logger: mocks.logger as never,
      log: vi.fn(),
    })
  }

  it('defaults to the current chat and leaves connectors out',
    async () => {
      await runInChat({}, CURRENT_SLUG)

      expect(mocks.getDebugInfo.mock.calls[0]?.[3]).toMatchObject({
        slug: CURRENT_SLUG,
        includeConnectors: false,
        includeFeatures: true,
      })
      expect(mocks.getDebugInfo.mock.calls[0]?.[3].connectorsNote)
        .toContain('Copy debug info')
      expect(mocks.isMcpConnectorsAvailable).not.toHaveBeenCalled()
    })

  it('keeps the neutral 404 in a chat', async () => {
    const { createError } = await import('evlog')

    mocks.getDebugInfo.mockRejectedValue(
      createError({ message: 'Chat not found.', status: 404 }),
    )

    await expect(runInChat({ slug: SLUG }, CURRENT_SLUG)).rejects
      .toMatchObject({ message: 'Chat not found.' })
  })

  it('lets the model name another chat of the user', async () => {
    await runInChat({ slug: SLUG }, CURRENT_SLUG)

    expect(mocks.getDebugInfo.mock.calls[0]?.[3]).toMatchObject({
      slug: SLUG,
    })
  })
})
