import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('~~/server/utils/legal/consent', () => {
  return import('../../setup/mocks/legal-consent')
})

const mocks = vi.hoisted(() => ({
  written: [] as Array<Record<string, unknown>>,
  commandsFlagActive: true,
  historyMessages: [] as Array<Record<string, unknown>>,
  generatingKeys: [] as Array<{ name: string }>,
  getChatCost: vi.fn(),
  useChatProvider: vi.fn(),
  useOpenAI: vi.fn(),
  indexMessagesForSearch: vi.fn(),
  lastCreated: null as ReturnType<typeof createDb> | null,
}))

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()

  return {
    ...actual,
    createUIMessageStream: ({ execute }: { execute: Function }) => {
      const writer = {
        write: vi.fn((chunk: Record<string, unknown>) => {
          mocks.written.push(chunk)
        }),
        merge: vi.fn(),
      }
      const ready = execute({ writer })

      return { writer, ready }
    },
    createUIMessageStreamResponse: ({ stream }: { stream: unknown }) => stream,
  }
})

vi.mock('evlog', () => ({
  useLogger: () => ({
    set: vi.fn(),
    getContext: () => ({ requestId: 'test-request-id' }),
  }),
  createRequestLogger: () => ({
    set: vi.fn(),
    emit: vi.fn(() => null),
    getContext: () => ({}),
  }),
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  createError: (input: { message?: string }) => {
    const exception = new Error(input.message || 'Error')

    Object.assign(exception, input)

    return exception
  },
}))

vi.mock('~~/server/utils/features/context', () => ({
  evaluateFeatureForEvent: vi.fn(async (_event: unknown, flag: string) => ({
    active: flag === 'skills.commands' && mocks.commandsFlagActive,
  })),
}))

vi.mock('~~/server/utils/usage/chat-cost', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('~~/server/utils/usage/chat-cost')
  >()

  return { ...actual, getChatCost: mocks.getChatCost }
})

vi.mock('~~/server/utils/search/index-writer', () => ({
  indexMessagesForSearch: mocks.indexMessagesForSearch,
}))

vi.mock('~~/server/utils/projects/memory', () => ({
  markProjectsMemoryStale: vi.fn(async () => undefined),
}))

const CHAT_SLUG = '01ARZ3NDEKTSV4RRFFQ69G5FAV'
const COMMAND_PART = {
  type: 'data-command-invocation',
  data: { command: 'cost' },
}

function createDb() {
  const insertValues = vi.fn()
  const insertGet = vi.fn(async () => ({ id: 'row-id', publicId: 'p' }))
  const updateWhere = vi.fn(async () => undefined)
  const updateSet = vi.fn(() => ({ where: updateWhere }))

  insertValues.mockImplementation(() => ({
    returning: () => ({ get: insertGet }),
    onConflictDoNothing: () => ({ returning: () => ({ get: insertGet }) }),
  }))

  return {
    db: {
      query: {
        chats: {
          findFirst: vi.fn(async () => ({
            id: 'chat-1',
            projectId: null,
            project: null,
            messages: mocks.historyMessages,
          })),
        },
      },
      insert: vi.fn(() => ({ values: insertValues })),
      update: vi.fn(() => ({ set: updateSet })),
    },
    insertValues,
    updateSet,
  }
}

async function runSend(parts: Array<Record<string, unknown>>) {
  const module = await import('../../../server/api/v1/chats/[slug]/index.post')
  const created = createDb()

  mocks.lastCreated = created
  vi.stubGlobal('useDb', () => created.db)

  const result = await module.default({
    params: { slug: CHAT_SLUG },
    body: {
      model: 'claude-opus-4-1',
      tools: ['web_search'],
      reasoning: 'high',
      messages: [{ id: 'user-public-1', role: 'user', parts }],
    },
  } as any)

  await result.ready

  return { created, result }
}

describe('POST /api/v1/chats/[slug] with a built-in command', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.written = []
    mocks.commandsFlagActive = true
    mocks.historyMessages = []
    mocks.generatingKeys = []
    mocks.getChatCost.mockResolvedValue({
      slug: CHAT_SLUG,
      messages: 4,
      truncated: false,
      firstMessageAt: '2026-11-20T10:00:00.000Z',
      lastMessageAt: '2026-11-20T10:05:00.000Z',
      models: [],
      searches: [],
      total: { amount: 1.25, isEstimated: false },
    })
    mocks.useChatProvider.mockImplementation(() => {
      throw new Error('a command must not resolve a model')
    })
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('getRouterParams', (event: { params: unknown }) => {
      return event.params
    })
    vi.stubGlobal('readValidatedBody', async (
      event: { body: unknown },
      parser: (body: unknown) => unknown,
    ) => parser(event.body))
    vi.stubGlobal(
      'useUserSession',
      vi.fn().mockResolvedValue({ user: { id: '1' } }),
    )
    vi.stubGlobal('useChatProvider', mocks.useChatProvider)
    vi.stubGlobal('useOpenAI', mocks.useOpenAI)
    vi.stubGlobal('useKV', () => ({
      get: vi.fn(async () => null),
      put: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
      list: vi.fn(async () => ({ keys: mocks.generatingKeys })),
    }))
    vi.stubGlobal('attachCloudflareMeta', vi.fn())
    vi.stubGlobal('shipWideEventToAxiom', vi.fn(async () => undefined))
  })

  it('answers with the report and calls no model or provider', async () => {
    const { created } = await runSend([COMMAND_PART])
    const inserts = created.insertValues.mock.calls.map(([value]) => value)
    const assistant = inserts.find(value => value.role === 'assistant')

    expect(mocks.useChatProvider).not.toHaveBeenCalled()
    expect(mocks.useOpenAI).not.toHaveBeenCalled()
    expect(mocks.getChatCost).toHaveBeenCalledWith(
      expect.anything(),
      1,
      CHAT_SLUG,
    )
    expect(inserts.find(value => value.role === 'user')).toMatchObject({
      chatId: 'chat-1',
      parts: [COMMAND_PART],
      tools: [],
      reasoning: 'off',
    })
    expect(assistant.usage).toBeUndefined()
    expect(assistant.parts[0]).toEqual({
      type: 'data-command-report',
      data: { command: 'cost' },
    })
    expect(assistant.parts[1].text).toMatch(/^```text\nChat cost/)
    expect(mocks.written.map(chunk => chunk.type)).toEqual([
      'start',
      'data-command-report',
      'text-start',
      'text-delta',
      'text-end',
      'finish',
    ])
    expect(created.updateSet).toHaveBeenCalledWith({ title: 'Chat cost' })
  })

  it('refuses the command with the commands flag off', async () => {
    mocks.commandsFlagActive = false

    await expect(runSend([COMMAND_PART])).rejects.toMatchObject({
      status: 400,
      code: 'command_invocation_unavailable',
    })
    expect(mocks.getChatCost).not.toHaveBeenCalled()
  })

  it('refuses a command next to a file', async () => {
    await expect(runSend([
      COMMAND_PART,
      { type: 'file', mediaType: 'image/png', url: '/files/a.png' },
    ])).rejects.toMatchObject({ status: 400 })
  })

  it('waits while a reply is being written in the chat', async () => {
    mocks.generatingKeys = [{ name: 'chat-generating:chat-1:other' }]

    await expect(runSend([COMMAND_PART])).rejects.toMatchObject({
      status: 409,
    })
    expect(mocks.getChatCost).not.toHaveBeenCalled()
  })

  it('replays the stored report of a resent command', async () => {
    mocks.historyMessages = [
      {
        id: 'm1',
        publicId: 'user-public-1',
        role: 'user',
        parts: [COMMAND_PART],
        tools: [],
        reasoning: 'off',
        usage: null,
        createdAt: new Date('2026-11-20T10:00:00.000Z'),
      },
      {
        id: 'm2',
        publicId: 'reply-1',
        role: 'assistant',
        parts: [
          { type: 'data-command-report', data: { command: 'cost' } },
          { type: 'text', text: 'STORED' },
        ],
        tools: [],
        reasoning: 'off',
        usage: null,
        createdAt: new Date('2026-11-20T10:00:01.000Z'),
      },
    ]

    const { created } = await runSend([COMMAND_PART])

    expect(mocks.getChatCost).not.toHaveBeenCalled()
    expect(created.insertValues).not.toHaveBeenCalled()
    expect(mocks.written[0]).toEqual({ type: 'start', messageId: 'reply-1' })
    expect(mocks.written).toContainEqual({
      type: 'text-delta',
      id: 'command-text-1',
      delta: 'STORED',
    })
  })

  it('answers 409 and stores nothing while an approval waits', async () => {
    mocks.historyMessages = [{
      id: 'm1',
      publicId: 'older-assistant',
      role: 'assistant',
      parts: [{
        type: 'tool-besidka__get_chat_cost',
        toolCallId: 'call-1',
        state: 'approval-requested',
        input: {},
        approval: { id: 'approval-1' },
      }],
      tools: [],
      reasoning: 'off',
      usage: null,
      createdAt: new Date('2026-11-20T10:00:00.000Z'),
    }]

    await expect(runSend([COMMAND_PART])).rejects.toMatchObject({
      status: 409,
      code: 'approval_pending',
      message: 'Answer or dismiss the pending approval first.',
    })
    expect(mocks.getChatCost).not.toHaveBeenCalled()
  })

  it('stores the user message but no reply when the command fails', async () => {
    const { createError } = await import('evlog')

    mocks.getChatCost.mockRejectedValue(
      createError({ message: 'Chat not found.', status: 404 }),
    )

    const failure = await runSend([COMMAND_PART]).catch(exception => exception)

    const inserts = mocks.lastCreated!.insertValues.mock.calls
      .map(([value]) => value)

    expect(failure).toMatchObject({ status: 404, message: 'Chat not found.' })
    expect(mocks.written).toEqual([])
    expect(inserts.map(value => value.role)).toEqual(['user'])
    expect(mocks.lastCreated!.updateSet).not.toHaveBeenCalledWith({
      title: 'Chat cost',
    })
  })
})
