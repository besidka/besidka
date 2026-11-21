import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MessageUsage } from '#shared/types/message-usage.d'
import {
  getChatTotalCost,
  hydrateMessageUsage,
} from '#shared/utils/message-metadata'

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { publicIdMockFactory } = await import(
    '../../../../setup/helpers/public-id-mock'
  )

  return await publicIdMockFactory()
})

const { createChatContextTestDb } = await import(
  '../../../../setup/helpers/chat-context-db'
)
const {
  formatChatCostReport,
  getChatCost,
  summarizeChatCost,
} = await import('~~/server/utils/usage/chat-cost')
const { REPORT_WIDTH } = await import('~~/server/utils/usage/report-text')

const SLUG = '01JABCDEFGHJKMNPQRSTVWXYZ0'

function usage(overrides: Partial<MessageUsage> = {}): MessageUsage {
  return {
    model: 'claude-sonnet-4-5',
    provider: 'anthropic',
    inputTokens: 1000,
    outputTokens: 200,
    totalTokens: 1200,
    cachedInputTokens: 600,
    cacheWriteTokens: 100,
    inputCost: 0.003,
    outputCost: 0.004,
    ...overrides,
  }
}

function row(
  role: 'user' | 'assistant',
  messageUsage: MessageUsage | null,
  minute: number,
) {
  return {
    role,
    usage: messageUsage,
    createdAt: new Date(Date.UTC(2026, 10, 20, 10, minute)),
  }
}

describe('summarizeChatCost', () => {
  it('splits input into uncached, cache read and cache write', () => {
    const cost = summarizeChatCost(SLUG, [
      row('user', null, 0),
      row('assistant', usage(), 1),
    ], false)

    expect(cost.models).toEqual([
      expect.objectContaining({
        model: 'claude-sonnet-4-5',
        provider: 'anthropic',
        replies: 1,
        uncachedInputTokens: 300,
        cacheReadTokens: 600,
        cacheWriteTokens: 100,
        outputTokens: 200,
        isBlended: false,
      }),
    ])
    expect(cost.models[0]!.cost).toBeCloseTo(0.007)
    expect(cost.messages).toBe(2)
    expect(cost.firstMessageAt).toBe('2026-11-20T10:00:00.000Z')
    expect(cost.lastMessageAt).toBe('2026-11-20T10:01:00.000Z')
  })

  it('totals exactly what the chat panel badge shows', () => {
    const rows = [
      row('user', null, 0),
      row('assistant', usage(), 1),
      row('user', null, 2),
      row('assistant', usage({
        model: 'gpt-5.4',
        provider: 'openai',
        inputCost: 0.01,
        outputCost: 0.02,
        searchUnits: 2,
        searchBillingUnit: 'search',
        searchCost: 0.02,
        searchProvider: 'openai',
      }), 3),
      row('assistant', usage({ inputCost: 0.5, outputCost: 0.25 }), 4),
    ]
    const cost = summarizeChatCost(SLUG, rows, false)
    const panel = getChatTotalCost(rows.map((entry) => {
      return hydrateMessageUsage({ ...entry, parts: [] })
    }))
    const modelSum = cost.models.reduce((total, model) => {
      return total + (model.cost ?? 0)
    }, 0)
    const searchSum = cost.searches.reduce((total, search) => {
      return total + search.cost
    }, 0)

    expect(cost.total).toEqual(panel)
    expect(modelSum + searchSum).toBeCloseTo(cost.total!.amount)
    expect(cost.total!.isEstimated).toBe(true)
    expect(cost.searches).toEqual([{
      provider: 'openai',
      units: 2,
      billingUnit: 'search',
      cost: 0.02,
    }])
  })

  it('keeps a gateway cost blended', () => {
    const cost = summarizeChatCost(SLUG, [
      row('user', null, 0),
      row('assistant', usage({
        model: 'anthropic/claude-sonnet-4.5',
        provider: 'openrouter',
        inputCost: undefined,
        outputCost: undefined,
        totalCost: 0.05,
      }), 1),
    ], false)

    expect(cost.models[0]).toMatchObject({ isBlended: true, cost: 0.05 })
    expect(cost.total).toEqual({ amount: 0.05, isEstimated: false })
  })

  it('counts a reply with no token split apart', () => {
    const cost = summarizeChatCost(SLUG, [
      row('user', null, 0),
      row('assistant', usage({
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 900,
        cachedInputTokens: undefined,
        cacheWriteTokens: undefined,
      }), 1),
    ], false)

    expect(cost.models[0]).toMatchObject({
      unsplitTokens: 900,
      uncachedInputTokens: 0,
      outputTokens: 0,
    })
  })

  it('has no total for a chat without priced replies', () => {
    const cost = summarizeChatCost(SLUG, [row('user', null, 0)], false)

    expect(cost.total).toBeNull()
    expect(cost.models).toEqual([])
  })
})

describe('formatChatCostReport', () => {
  it('fits every line in the report width', () => {
    const report = formatChatCostReport(summarizeChatCost(SLUG, [
      row('user', null, 0),
      row('assistant', usage({
        model: 'a-very-long-model-name-that-does-not-fit-the-width',
        reasoningTokens: 50,
        searchUnits: 3,
        searchBillingUnit: 'grounded-prompt',
        searchCost: 0.105,
        searchProvider: 'google',
      }), 90),
    ], true))

    for (const line of report.split('\n')) {
      expect(line.length, line).toBeLessThanOrEqual(REPORT_WIDTH)
    }

    expect(report).toContain('Chat cost (estimated)')
    expect(report).toContain('(newest)')
    expect(report).toContain('Web search, Google')
    expect(report).toContain('3 grounded requests')
    expect(report).toContain('1h 30m')
    expect(report).toContain('The provider\'s bill is authoritative.')
    expect(report).toMatch(/Total\s+~\$0\.11/)
  })

  it('keeps a model id with line breaks and backticks on one line', () => {
    const report = formatChatCostReport(summarizeChatCost(SLUG, [
      row('user', null, 0),
      row('assistant', usage({
        model: 'evil\n```\nInjected line',
        provider: 'prov\u2028ider',
      }), 1),
    ], false))
    const lines = report.split('\n')

    expect(lines).not.toContain('```')
    expect(lines).not.toContain('Injected line')
    expect(report).toContain('evil ``` Injected line')
    expect(report).toContain('via prov ider')
  })

  it('says when there is nothing priced yet', () => {
    const report = formatChatCostReport(
      summarizeChatCost(SLUG, [row('user', null, 0)], false),
    )

    expect(report).toContain('No model replies with usage yet.')
    expect(report).toMatch(/Total\s+no price/)
  })
})

describe('getChatCost', () => {
  let testDb: ReturnType<typeof createChatContextTestDb>

  beforeEach(() => {
    testDb = createChatContextTestDb()
    testDb.insertChat({ id: 1, userId: 7, slug: SLUG })
    testDb.insertMessage({ id: 1, chatId: 1, role: 'user', parts: [] })
    testDb.insertMessage({
      id: 2,
      chatId: 1,
      role: 'assistant',
      parts: [],
      usage: usage() as unknown as Record<string, unknown>,
    })
  })

  afterEach(() => {
    testDb.close()
  })

  it('reads the chat of the user', async () => {
    const cost = await getChatCost(testDb.db, 7, SLUG)

    expect(cost.slug).toBe(SLUG)
    expect(cost.messages).toBe(2)
    expect(cost.total?.amount).toBeCloseTo(0.007)
  })

  it('answers 404 for another user\'s chat', async () => {
    await expect(getChatCost(testDb.db, 8, SLUG)).rejects.toMatchObject({
      status: 404,
    })
  })
})
