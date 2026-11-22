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
    getUsageStats: vi.fn(),
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

vi.mock('~~/server/utils/usage/usage-stats', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('~~/server/utils/usage/usage-stats')
  >()

  return { ...original, getUsageStats: mocks.getUsageStats }
})

const AUTH = { ...TEST_MCP_AUTH, scopes: ['chats:read'] }
const STATS = {
  period: '30d',
  since: '2026-10-22T00:00:00.000Z',
  generatedAt: '2026-11-20T12:00:00.000Z',
  replies: 3,
  messages: 6,
  chats: 2,
  tokens: {
    uncachedInput: 10,
    cacheRead: 0,
    cacheWrite: 0,
    output: 5,
    reasoning: 0,
    unsplit: 0,
  },
  cost: { amount: 0.1, isEstimated: false },
  unpricedReplies: 0,
  models: [{ model: 'gpt-5.4', replies: 3, cost: 0.1 }],
  activeDays: 2,
  periodDays: 30,
  mostActiveDay: { date: '2026-11-19', messages: 4 },
  currentStreak: 2,
  longestStreak: 2,
  counts: { projects: 1, artifacts: 2, skills: 3, connectors: 4 },
}

function loadTool(context: Record<string, unknown>) {
  vi.stubGlobal('useKV', () => ({ marker: 'kv' }))

  return loadMcpTool(
    () => import('~~/server/mcp/tools/get-usage-stats'),
    context,
  )
}

describe('get_usage_stats tool over MCP', () => {
  beforeEach(() => {
    mocks.getUsageStats.mockReset()
      .mockResolvedValue({ stats: STATS, isCached: false })
  })

  it('declares a read-only tool under chats:read', async () => {
    const tool = await loadTool({ mcpAuth: AUTH })

    expect(tool.name).toBe('get_usage_stats')
    expect(tool.annotations).toEqual({
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
    })
  })

  it('defaults to 30 days and returns one report', async () => {
    const tool = await loadTool({ mcpAuth: AUTH })
    const payload = parseToolPayload(await tool.handler({}))

    expect(mocks.getUsageStats).toHaveBeenCalledWith(expect.objectContaining({
      db: { marker: 'db' },
      kv: { marker: 'kv' },
      userId: 42,
      period: '30d',
    }))
    expect(payload.report).toContain('Usage stats, last 30 days')
  })

  it('hides every count with chats:read alone', async () => {
    const tool = await loadTool({ mcpAuth: AUTH })
    const payload = parseToolPayload(await tool.handler({ period: '7d' }))

    expect(payload.counts).toEqual({
      projects: null,
      artifacts: null,
      skills: null,
      connectors: null,
    })
    expect(payload.report).not.toContain('Projects')
  })

  it('shows a count only with its read scope', async () => {
    const tool = await loadTool({
      mcpAuth: { ...AUTH, scopes: ['chats:read', 'skills:read'] },
    })
    const payload = parseToolPayload(await tool.handler({}))

    expect(payload.counts).toEqual({
      projects: null,
      artifacts: null,
      skills: 3,
      connectors: null,
    })
  })

  it('refuses a token without chats:read', async () => {
    const tool = await loadTool({
      mcpAuth: { ...AUTH, scopes: ['skills:read'] },
    })

    await expect(tool.handler({})).rejects.toMatchObject({ status: 403 })
  })
})

describe('get_usage_stats tool inside Besidka', () => {
  beforeEach(() => {
    mocks.getUsageStats.mockReset()
      .mockResolvedValue({ stats: STATS, isCached: true })
    vi.stubGlobal('useKV', () => ({ marker: 'kv' }))
  })

  it('shows every count to the user', async () => {
    const { getUsageStatsBesidkaTool } = await import(
      '~~/server/utils/besidka-tools/tools/get-usage-stats'
    )
    const result = await getUsageStatsBesidkaTool.handler({} as never, {
      userId: 42,
      clientId: 'besidka-command',
      scopes: [],
      currentChatSlug: '01JABCDEFGHJKMNPQRSTVWXYZ1',
      db: { marker: 'db' } as never,
      logger: mocks.logger as never,
      log: vi.fn(),
    }) as { counts: unknown, report: string }

    expect(result.counts).toEqual(STATS.counts)
    expect(result.report).toMatch(/Connectors\s+4/)
  })
})
