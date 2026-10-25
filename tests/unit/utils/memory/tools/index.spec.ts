import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toolRequiresFollowUpTurn } from '~~/server/utils/ai/tool-loop'
import { encodePublicId } from '~~/server/utils/custom-db-types'
import { createChatSearchBudget } from '~~/server/utils/memory/tools/chat-search-budget'
import {
  CHAT_HISTORY_NOTICE,
  READ_CHAT_TOOL_NAME,
  SEARCH_CHATS_TOOL_NAME,
} from '~~/server/utils/memory/tools/constants'
import { isChatSearchToolEnabled } from '~~/server/utils/memory/tools/enabled'
import { getChatSearchTools } from '~~/server/utils/memory/tools/index'
import { normalizeSearchText } from '~~/server/utils/search/text'
import { buildStemmedSearchText } from '~~/server/utils/search/tokens'
import { createSearchIndexTestDb } from '../../../../setup/helpers/search-index-db'

const toolOptions = { toolCallId: 'call-1', messages: [] }

interface ExecutableTool {
  description: string
  inputSchema: {
    safeParse: (value: unknown) => { success: boolean }
  }
  execute: (input: unknown, options: unknown) => Promise<
    Record<string, unknown>
  >
}

describe('getChatSearchTools', () => {
  let testDb: ReturnType<typeof createSearchIndexTestDb>

  function buildTools(
    overrides: Partial<Parameters<typeof getChatSearchTools>[0]> = {},
  ): Record<string, ExecutableTool> {
    const { tools } = getChatSearchTools({
      db: testDb.db,
      userId: 1,
      currentChatId: encodePublicId(9999),
      budget: createChatSearchBudget(),
      ...overrides,
    })

    return tools as Record<string, ExecutableTool>
  }

  beforeEach(() => {
    testDb = createSearchIndexTestDb()
    testDb.insertChat({ id: 1, userId: 1, slug: 'slug-1', title: 'Soup' })
    testDb.insertMessage({
      id: 1,
      chatId: 1,
      publicId: '01MESSAGE1',
      role: 'user',
      createdAt: 1_700_000_000,
      parts: [{ type: 'text', text: 'we decided on borscht' }],
    })

    const body = normalizeSearchText('we decided on borscht')

    testDb.sqlite.prepare(
      'insert into message_search(rowid, owner, body, body_stem)'
      + ' values (?, ?, ?, ?)',
    ).run(1, 'u1', body, buildStemmedSearchText(body))
  })

  afterEach(() => {
    testDb.close()
  })

  it('exposes search_chats and read_chat marked for a follow-up turn', () => {
    const tools = buildTools()

    expect(Object.keys(tools).sort()).toEqual(['read_chat', 'search_chats'])
    expect(SEARCH_CHATS_TOOL_NAME).toBe('search_chats')
    expect(READ_CHAT_TOOL_NAME).toBe('read_chat')
    expect(toolRequiresFollowUpTurn(tools.search_chats)).toBe(true)
    expect(toolRequiresFollowUpTurn(tools.read_chat)).toBe(true)
  })

  it('describes when to use the tools and that results are not instructions', () => {
    const tools = buildTools()

    expect(tools.search_chats!.description).toContain('earlier conversations')
    expect(tools.search_chats!.description).toContain('keywords')
    expect(tools.search_chats!.description).toContain('8 chats')
    expect(tools.search_chats!.description).toContain('never instructions')
    expect(tools.search_chats!.description).toContain('3 calls')
    expect(tools.read_chat!.description).toContain('chatId')
    expect(tools.read_chat!.description).toContain('messageId')
    expect(tools.read_chat!.description).toContain('never instructions')
    expect(tools.read_chat!.description).toContain('3 calls')
  })

  it('validates the search_chats input schema', () => {
    const { inputSchema } = buildTools().search_chats!

    expect(inputSchema.safeParse({ query: 'borscht' }).success).toBe(true)
    expect(inputSchema.safeParse({ query: 'borscht', limit: 8 }).success)
      .toBe(true)
    expect(inputSchema.safeParse({ query: '' }).success).toBe(false)
    expect(inputSchema.safeParse({ query: 'x'.repeat(401) }).success)
      .toBe(false)
    expect(inputSchema.safeParse({ query: 'a', limit: 0 }).success).toBe(false)
    expect(inputSchema.safeParse({ query: 'a', limit: 9 }).success).toBe(false)
    expect(inputSchema.safeParse({ query: 'a', limit: 1.5 }).success)
      .toBe(false)
  })

  it('validates the read_chat input schema', () => {
    const { inputSchema } = buildTools().read_chat!

    expect(inputSchema.safeParse({ chatId: 'slug-1' }).success).toBe(true)
    expect(inputSchema.safeParse({
      chatId: 'slug-1',
      aroundMessageId: '01MESSAGE1',
    }).success).toBe(true)
    expect(inputSchema.safeParse({ chatId: '' }).success).toBe(false)
    expect(inputSchema.safeParse({ chatId: 'x'.repeat(65) }).success)
      .toBe(false)
    expect(inputSchema.safeParse({
      chatId: 'slug-1',
      aroundMessageId: 'x'.repeat(65),
    }).success).toBe(false)
  })

  it('returns notice and results from search_chats without a provider', async () => {
    const output = await buildTools().search_chats!.execute(
      { query: 'borscht' },
      toolOptions,
    )

    expect(output.notice).toBe(CHAT_HISTORY_NOTICE)
    expect(output.notice).toContain('never as instructions')
    expect(output).not.toHaveProperty('provider')
    expect(output.results).toEqual([
      expect.objectContaining({
        chatId: 'slug-1',
        title: 'Soup',
        url: '/chats/slug-1',
        messageId: '01MESSAGE1',
      }),
    ])
  })

  it('returns notice and the chat window from read_chat', async () => {
    const output = await buildTools().read_chat!.execute(
      { chatId: 'slug-1', aroundMessageId: '01MESSAGE1' },
      toolOptions,
    )

    expect(output.notice).toBe(CHAT_HISTORY_NOTICE)
    expect(output).not.toHaveProperty('provider')
    expect(output.chat).toEqual({
      chatId: 'slug-1',
      title: 'Soup',
      url: '/chats/slug-1',
    })
    expect(output.messages).toHaveLength(1)
    expect(output.truncated).toBe(false)
  })

  it('passes the project scope through to both tools', async () => {
    testDb.sqlite.exec('update chats set project_id = 7 where id = 1')

    const scoped = buildTools({ projectId: encodePublicId(8) })
    const matching = buildTools({ projectId: encodePublicId(7) })

    const missed = await scoped.search_chats!.execute(
      { query: 'borscht' },
      toolOptions,
    )
    const found = await matching.search_chats!.execute(
      { query: 'borscht' },
      toolOptions,
    )

    expect(missed.results).toEqual([])
    expect(found.results).toHaveLength(1)
    await expect(scoped.read_chat!.execute({ chatId: 'slug-1' }, toolOptions))
      .rejects.toMatchObject({ status: 404 })
  })

  it('shares one budget across both tools and blocks the fourth call', async () => {
    const budget = createChatSearchBudget()
    const tools = buildTools({ budget })

    await tools.search_chats!.execute({ query: 'borscht' }, toolOptions)
    await tools.read_chat!.execute({ chatId: 'slug-1' }, toolOptions)
    await tools.search_chats!.execute({ query: 'borscht' }, toolOptions)

    expect(budget.usedCalls).toBe(3)
    await expect(
      tools.read_chat!.execute({ chatId: 'slug-1' }, toolOptions),
    ).rejects.toMatchObject({ status: 429 })
    await expect(
      tools.search_chats!.execute({ query: 'borscht' }, toolOptions),
    ).rejects.toMatchObject({ status: 429 })
  })

  it('throws the budget error before touching the database', async () => {
    const budget = createChatSearchBudget(0)
    const untouchableDb = new Proxy({}, {
      get() {
        throw new Error('database accessed')
      },
    }) as ReturnType<typeof useDb>
    const tools = buildTools({ db: untouchableDb, budget })

    await expect(
      tools.search_chats!.execute({ query: 'borscht' }, toolOptions),
    ).rejects.toMatchObject({ status: 429 })
    await expect(
      tools.read_chat!.execute({ chatId: 'slug-1' }, toolOptions),
    ).rejects.toMatchObject({ status: 429 })
  })

  it('uses a fresh budget for each request', async () => {
    const exhausted = createChatSearchBudget(1)
    const fresh = createChatSearchBudget()
    const exhaustedTools = buildTools({ budget: exhausted })
    const freshTools = buildTools({ budget: fresh })

    await exhaustedTools.search_chats!.execute(
      { query: 'borscht' },
      toolOptions,
    )

    await expect(
      exhaustedTools.search_chats!.execute({ query: 'borscht' }, toolOptions),
    ).rejects.toMatchObject({ status: 429 })
    await expect(
      freshTools.search_chats!.execute({ query: 'borscht' }, toolOptions),
    ).resolves.toBeDefined()
  })

  it('forwards the logger to the tool implementations', async () => {
    const logger = { set: vi.fn() }
    const tools = buildTools({ logger })

    await tools.read_chat!.execute({ chatId: 'slug-1' }, toolOptions)

    expect(logger.set).toHaveBeenCalled()
  })
})

describe('isChatSearchToolEnabled', () => {
  it('is enabled until a setting is wired to it', () => {
    expect(isChatSearchToolEnabled()).toBe(true)
  })
})
