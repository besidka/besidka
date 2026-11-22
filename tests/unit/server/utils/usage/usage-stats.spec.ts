import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  USAGE_STATS_RUNS_MAX,
  computeStreaks,
  formatUsageStatsReport,
  getUsageStats,
  getUsageStatsSince,
  invalidateUsageStatsCache,
  parseUsageStatsPeriod,
  summarizeUsageStats,
} = await import('~~/server/utils/usage/usage-stats')
const { REPORT_WIDTH } = await import('~~/server/utils/usage/report-text')

const BASE_SECONDS = 1_790_000_000
const DAY_SECONDS = 24 * 60 * 60
const NOW = new Date((BASE_SECONDS + 10 * DAY_SECONDS) * 1000)
const USER_ID = 7

function createKv() {
  const store = new Map<string, string>()

  return {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value)
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key)
    }),
  }
}

function createLogger() {
  return { set: vi.fn() }
}

describe('parseUsageStatsPeriod', () => {
  it.each([
    ['', '30d'],
    [null, '30d'],
    ['7d', '7d'],
    [' ALL ', 'all'],
    ['30d', '30d'],
    ['week', null],
  ])('reads %j as %j', (value, expected) => {
    expect(parseUsageStatsPeriod(value)).toBe(expected)
  })
})

describe('getUsageStatsSince', () => {
  it('starts at the UTC midnight that makes the period whole days', () => {
    const now = new Date('2026-11-20T15:30:00.000Z')

    expect(getUsageStatsSince('7d', now)?.toISOString())
      .toBe('2026-11-14T00:00:00.000Z')
    expect(getUsageStatsSince('30d', now)?.toISOString())
      .toBe('2026-10-22T00:00:00.000Z')
    expect(getUsageStatsSince('all', now)).toBeNull()
  })
})

describe('computeStreaks', () => {
  it('counts the current streak through today', () => {
    expect(computeStreaks(
      ['2026-11-10', '2026-11-11', '2026-11-18', '2026-11-19', '2026-11-20'],
      '2026-11-20',
    )).toEqual({ current: 3, longest: 3 })
  })

  it('keeps yesterday\'s streak alive before today\'s first message', () => {
    expect(computeStreaks(['2026-11-18', '2026-11-19'], '2026-11-20'))
      .toEqual({ current: 2, longest: 2 })
  })

  it('breaks the current streak after a missed day', () => {
    expect(computeStreaks(
      ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-18'],
      '2026-11-20',
    )).toEqual({ current: 0, longest: 3 })
  })

  it('handles no activity', () => {
    expect(computeStreaks([], '2026-11-20')).toEqual({ current: 0, longest: 0 })
  })
})

describe('summarizeUsageStats', () => {
  it('ranks models by replies and totals tokens and cost', () => {
    const stats = summarizeUsageStats({
      period: '7d',
      now: new Date('2026-11-20T12:00:00.000Z'),
      since: new Date('2026-11-14T00:00:00.000Z'),
      rows: [
        {
          day: '2026-11-19',
          role: 'user',
          model: null,
          messages: 3,
          input: null,
          output: null,
          cacheRead: null,
          cacheWrite: null,
          reasoning: null,
          total: null,
          unsplit: null,
          cost: 0,
          searchCost: 0,
          estimated: 0,
          unpriced: 0,
        },
        {
          day: '2026-11-19',
          role: 'assistant',
          model: 'gpt-5.4',
          messages: 2,
          input: 1000,
          output: 300,
          cacheRead: 400,
          cacheWrite: 100,
          reasoning: 50,
          total: 1300,
          unsplit: 0,
          cost: 0.02,
          searchCost: 0.01,
          estimated: 1,
          unpriced: 0,
        },
        {
          day: '2026-11-20',
          role: 'assistant',
          model: 'claude-sonnet-4-5',
          messages: 1,
          input: 100,
          output: 10,
          cacheRead: 0,
          cacheWrite: 0,
          reasoning: 0,
          total: 110,
          unsplit: 0,
          cost: 0,
          searchCost: 0,
          estimated: 0,
          unpriced: 1,
        },
      ],
      counts: { chats: 2, projects: 1, artifacts: 4, skills: 0, connectors: 3 },
    })

    expect(stats.models[0]).toEqual({
      model: 'gpt-5.4',
      replies: 2,
      cost: 0.03,
    })
    expect(stats.replies).toBe(3)
    expect(stats.messages).toBe(6)
    expect(stats.tokens).toEqual({
      uncachedInput: 600,
      cacheRead: 400,
      cacheWrite: 100,
      output: 310,
      reasoning: 50,
      unsplit: 0,
    })
    expect(stats.cost).toEqual({ amount: 0.03, isEstimated: true })
    expect(stats.unpricedReplies).toBe(1)
    expect(stats.activeDays).toBe(2)
    expect(stats.periodDays).toBe(7)
    expect(stats.mostActiveDay).toEqual({ date: '2026-11-19', messages: 5 })
    expect(stats.currentStreak).toBe(2)
    expect(stats.counts).toEqual({
      projects: 1,
      artifacts: 4,
      skills: 0,
      connectors: 3,
    })
  })
})

describe('getUsageStats', () => {
  let testDb: ReturnType<typeof createChatContextTestDb>

  beforeEach(() => {
    testDb = createChatContextTestDb()
    testDb.sqlite.exec(`
      CREATE TABLE skills (id integer PRIMARY KEY, user_id integer NOT NULL);
      CREATE TABLE connectors (
        id integer PRIMARY KEY,
        user_id integer NOT NULL
      );
      INSERT INTO skills (id, user_id) VALUES (1, 7), (2, 7), (3, 8);
      INSERT INTO connectors (id, user_id) VALUES (1, 7);
    `)
    testDb.insertProject({ id: 1, userId: USER_ID, name: 'Project' })
    testDb.insertChat({ id: 1, userId: USER_ID, slug: 'chat-one' })
    testDb.insertChat({ id: 2, userId: 8, slug: 'chat-other' })
    testDb.insertChat({ id: 3, userId: USER_ID, slug: 'chat-branch' })

    const usage = {
      model: 'gpt-5.4',
      provider: 'openai',
      inputTokens: 1000,
      outputTokens: 100,
      totalTokens: 1100,
      cachedInputTokens: 200,
      inputCost: 0.01,
      outputCost: 0.002,
    }

    testDb.insertMessage({
      id: 1,
      chatId: 1,
      role: 'user',
      parts: [],
      createdAtSeconds: BASE_SECONDS + 9 * DAY_SECONDS,
    })
    testDb.insertMessage({
      id: 2,
      chatId: 1,
      role: 'assistant',
      parts: [],
      usage,
      createdAtSeconds: BASE_SECONDS + 9 * DAY_SECONDS + 5,
    })
    testDb.insertMessage({
      id: 3,
      chatId: 2,
      role: 'assistant',
      parts: [],
      usage,
      createdAtSeconds: BASE_SECONDS + 9 * DAY_SECONDS,
    })
    testDb.insertMessage({
      id: 4,
      chatId: 3,
      role: 'assistant',
      parts: [],
      usage,
      createdAtSeconds: BASE_SECONDS - 100,
    })
    setActivity(1, BASE_SECONDS + 9 * DAY_SECONDS + 5)
    setActivity(2, BASE_SECONDS + 9 * DAY_SECONDS)
  })

  afterEach(() => {
    testDb.close()
  })

  function setActivity(chatId: number, seconds: number) {
    testDb.sqlite.prepare('update chats set activity_at = ? where id = ?')
      .run(seconds, chatId)
  }

  it('reads only the user\'s own messages and skips branch copies', async () => {
    const kv = createKv()
    const result = await getUsageStats({
      db: testDb.db,
      kv: kv as never,
      userId: USER_ID,
      period: 'all',
      logger: createLogger(),
      now: NOW,
    })

    expect(result.isCached).toBe(false)
    expect(result.stats.replies).toBe(1)
    expect(result.stats.messages).toBe(2)
    expect(result.stats.chats).toBe(2)
    expect(result.stats.tokens.uncachedInput).toBe(800)
    expect(result.stats.cost?.amount).toBeCloseTo(0.012)
    expect(result.stats.counts).toEqual({
      projects: 1,
      artifacts: 0,
      skills: 2,
      connectors: 1,
    })
  })

  it('caches per user and period and logs the run', async () => {
    const kv = createKv()
    const logger = createLogger()
    const input = {
      db: testDb.db,
      kv: kv as never,
      userId: USER_ID,
      period: '7d' as const,
      logger,
      now: NOW,
    }

    await getUsageStats(input)

    const second = await getUsageStats(input)

    expect(second.isCached).toBe(true)
    expect(kv.put).toHaveBeenCalledWith(
      'usage-stats:7:7d',
      expect.any(String),
      { expirationTtl: 900 },
    )
    expect(logger.set).toHaveBeenCalledWith({
      attributes: {
        usageStats: expect.objectContaining({
          period: '7d',
          cached: false,
          durationMs: expect.any(Number),
          groupedRows: 2,
        }),
      },
    })
  })

  it('skips chats with no activity in the period', async () => {
    setActivity(1, BASE_SECONDS)

    const result = await getUsageStats({
      db: testDb.db,
      kv: createKv() as never,
      userId: USER_ID,
      period: '7d',
      logger: createLogger(),
      now: NOW,
    })

    expect(result.stats.messages).toBe(0)
    expect(result.stats.chats).toBe(0)
  })

  it('refuses too many uncached runs', async () => {
    const kv = createKv()
    const input = {
      db: testDb.db,
      kv: kv as never,
      userId: USER_ID,
      period: '30d' as const,
      logger: createLogger(),
      now: NOW,
    }

    for (let run = 0; run < USAGE_STATS_RUNS_MAX; run++) {
      kv.store.delete('usage-stats:7:30d')
      await getUsageStats(input)
    }

    kv.store.delete('usage-stats:7:30d')

    await expect(getUsageStats(input)).rejects.toMatchObject({ status: 429 })
  })
})

describe('formatUsageStatsReport', () => {
  it('fits every line in the report width and states its limits', () => {
    const report = formatUsageStatsReport(summarizeUsageStats({
      period: '30d',
      now: new Date('2026-11-20T12:00:00.000Z'),
      since: new Date('2026-10-22T00:00:00.000Z'),
      rows: [{
        day: '2026-11-20',
        role: 'assistant',
        model: 'a-very-long-model-identifier-for-the-test',
        messages: 1,
        input: 10,
        output: 5,
        cacheRead: 0,
        cacheWrite: 0,
        reasoning: 0,
        total: 15,
        unsplit: 0,
        cost: 0.001,
        searchCost: 0,
        estimated: 0,
        unpriced: 0,
      }],
      counts: { chats: 1, projects: 0, artifacts: 0, skills: 0, connectors: 0 },
    }), { note: 'Unknown period, showing 30d.' })

    for (const line of report.split('\n')) {
      expect(line.length, line).toBeLessThanOrEqual(REPORT_WIDTH)
    }

    expect(report).toContain('Usage stats, last 30 days')
    expect(report).toContain('Unknown period, showing 30d.')
    expect(report).toContain('Chat replies only, days in UTC.')
    expect(report).toContain('As of 2026-11-20 12:00 UTC.')
    expect(report).toMatch(/Active days\s+1 of 30/)
  })

  it('leaves out the counts a caller may not see', () => {
    const stats = summarizeUsageStats({
      period: '7d',
      now: NOW,
      since: null,
      rows: [],
      counts: { chats: 0, projects: 2, artifacts: 0, skills: 0, connectors: 0 },
    })
    const report = formatUsageStatsReport({
      ...stats,
      counts: { projects: 2, artifacts: null, skills: null, connectors: null },
    })

    expect(report).toMatch(/Projects\s+2/)
    expect(report).not.toContain('Artifacts')
  })
})

describe('invalidateUsageStatsCache', () => {
  it('deletes the cached stats of every period of one user', async () => {
    const kv = createKv()

    for (const period of ['7d', '30d', 'all']) {
      kv.store.set(`usage-stats:7:${period}`, '{}')
      kv.store.set(`usage-stats:8:${period}`, '{}')
    }

    await invalidateUsageStatsCache(kv as never, 7, createLogger())

    expect([...kv.store.keys()].sort()).toEqual([
      'usage-stats:8:30d',
      'usage-stats:8:7d',
      'usage-stats:8:all',
    ])
  })

  it('logs a failed delete and still tries the other periods', async () => {
    const kv = createKv()
    const logger = createLogger()

    kv.delete.mockRejectedValueOnce(new Error('kv unavailable'))

    await invalidateUsageStatsCache(kv as never, 7, logger)

    expect(kv.delete).toHaveBeenCalledTimes(3)
    expect(logger.set).toHaveBeenCalledWith({
      attributes: { usageStats: { cacheDeleteError: 'kv unavailable' } },
    })
  })
})
