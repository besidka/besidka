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
    getChatCost: vi.fn(),
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

vi.mock('~~/server/utils/usage/chat-cost', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('~~/server/utils/usage/chat-cost')
  >()

  return { ...original, getChatCost: mocks.getChatCost }
})

const AUTH = { ...TEST_MCP_AUTH, scopes: ['chats:read'] }
const SLUG = '01JABCDEFGHJKMNPQRSTVWXYZ0'
const CURRENT_SLUG = '01JABCDEFGHJKMNPQRSTVWXYZ1'
const COST = {
  slug: SLUG,
  messages: 2,
  truncated: false,
  firstMessageAt: '2026-11-20T10:00:00.000Z',
  lastMessageAt: '2026-11-20T10:01:00.000Z',
  models: [],
  searches: [],
  total: { amount: 0.5, isEstimated: false },
}

function loadTool(context: Record<string, unknown>) {
  return loadMcpTool(
    () => import('~~/server/mcp/tools/get-chat-cost'),
    context,
  )
}

describe('get_chat_cost tool over MCP', () => {
  beforeEach(() => {
    mocks.getChatCost.mockReset().mockResolvedValue(COST)
  })

  it('declares a read-only tool under chats:read', async () => {
    const tool = await loadTool({ mcpAuth: AUTH })

    expect(tool.name).toBe('get_chat_cost')
    expect(tool.annotations).toEqual({
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    })
    expect(tool.description.endsWith('Requires signing in (chats:read).'))
      .toBe(true)
  })

  it('returns the structured cost and one report', async () => {
    const tool = await loadTool({ mcpAuth: AUTH })
    const payload = parseToolPayload(await tool.handler({ slug: SLUG }))

    expect(mocks.getChatCost).toHaveBeenCalledWith({ marker: 'db' }, 42, SLUG)
    expect(payload.report).toContain('Chat cost (estimated)')
    expect(payload.total).toEqual(COST.total)
  })

  it('asks for a slug over MCP, where there is no current chat', async () => {
    const tool = await loadTool({ mcpAuth: AUTH })

    await expect(tool.handler({})).rejects.toMatchObject({ status: 400 })
    expect(mocks.getChatCost).not.toHaveBeenCalled()
  })

  it('refuses a token without chats:read', async () => {
    const tool = await loadTool({
      mcpAuth: { ...AUTH, scopes: ['projects:read'] },
    })

    await expect(tool.handler({ slug: SLUG }))
      .rejects.toMatchObject({ status: 403 })
  })
})

describe('get_chat_cost tool in a chat', () => {
  beforeEach(() => {
    mocks.getChatCost.mockReset().mockResolvedValue(COST)
  })

  it('defaults to the current chat', async () => {
    const { getChatCostBesidkaTool } = await import(
      '~~/server/utils/besidka-tools/tools/get-chat-cost'
    )
    const log = vi.fn()

    await getChatCostBesidkaTool.handler({} as never, {
      userId: 42,
      clientId: 'besidka-chat',
      scopes: [],
      currentChatSlug: CURRENT_SLUG,
      db: { marker: 'db' } as never,
      logger: mocks.logger as never,
      log,
    })

    expect(mocks.getChatCost)
      .toHaveBeenCalledWith({ marker: 'db' }, 42, CURRENT_SLUG)
    expect(log).toHaveBeenCalledWith({
      chat_slug: CURRENT_SLUG,
      result_count: 0,
    })
  })
})
