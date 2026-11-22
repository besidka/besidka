import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  return {
    evaluateFeatureForEvent: vi.fn(),
    isChatGenerating: vi.fn(),
    persistUserMessage: vi.fn(),
    insertMessageWithPublicId: vi.fn(),
    costHandler: vi.fn(),
    statsHandler: vi.fn(),
    debugHandler: vi.fn(),
    update: vi.fn(),
    chatHasAwaitingApproval: vi.fn(),
    enforceBuiltinCommandRateLimit: vi.fn(),
  }
})

vi.mock('~~/server/utils/tool-approval/send', () => {
  return { chatHasAwaitingApproval: mocks.chatHasAwaitingApproval }
})

vi.mock('~~/server/utils/chats/builtin-command-rate-limit', () => {
  return {
    enforceBuiltinCommandRateLimit: mocks.enforceBuiltinCommandRateLimit,
  }
})

vi.mock('~~/server/utils/features/context', () => {
  return { evaluateFeatureForEvent: mocks.evaluateFeatureForEvent }
})

vi.mock('~~/server/utils/chats/generation-in-progress', () => {
  return { isChatGenerating: mocks.isChatGenerating }
})

vi.mock('~~/server/utils/chats/persist-user-message', () => {
  return {
    persistUserMessage: mocks.persistUserMessage,
    hasMeaningfulAssistantParts: (parts: unknown[]) => parts.length > 0,
  }
})

vi.mock('~~/server/utils/chats/insert-message', () => {
  return { insertMessageWithPublicId: mocks.insertMessageWithPublicId }
})

vi.mock('~~/server/utils/besidka-tools/registry', () => {
  return {
    BESIDKA_TOOLS: {
      get_chat_cost: { name: 'get_chat_cost', handler: mocks.costHandler },
      get_usage_stats: {
        name: 'get_usage_stats',
        handler: mocks.statsHandler,
      },
      get_debug_info: { name: 'get_debug_info', handler: mocks.debugHandler },
    },
  }
})

vi.mock('~~/server/db/schema', () => {
  return {
    chats: { id: 'chats.id', title: 'chats.title' },
  }
})

vi.mock('drizzle-orm', () => {
  return {
    and: (...conditions: unknown[]) => ({ and: conditions }),
    eq: (left: unknown, right: unknown) => ({ eq: [left, right] }),
    isNull: (value: unknown) => ({ isNull: value }),
    or: (...conditions: unknown[]) => ({ or: conditions }),
  }
})

const {
  BUILTIN_COMMAND_CLIENT_ID,
  BUILTIN_COMMAND_FAILURE_TEXT,
  resolveBuiltinCommandPart,
  respondWithBuiltinCommand,
  runBuiltinCommand,
} = await import('~~/server/utils/chats/builtin-commands')

const SLUG = '01JABCDEFGHJKMNPQRSTVWXYZ0'
const COMMAND_PART = {
  type: 'data-command-invocation',
  data: { command: 'cost' },
}

function createLogger() {
  return { set: vi.fn() }
}

function createDb() {
  const where = vi.fn(async () => undefined)
  const set = vi.fn(() => ({ where }))

  mocks.update.mockImplementation(() => ({ set }))

  return { db: { update: mocks.update } as never, set, where }
}

async function readChunks(response: Response): Promise<unknown[]> {
  const text = await response.text()

  return text
    .split('\n')
    .filter(line => line.startsWith('data: ') && line !== 'data: [DONE]')
    .map(line => JSON.parse(line.slice('data: '.length)))
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.evaluateFeatureForEvent.mockResolvedValue({ active: true })
  mocks.isChatGenerating.mockResolvedValue(false)
  mocks.chatHasAwaitingApproval.mockReturnValue(false)
  mocks.enforceBuiltinCommandRateLimit.mockResolvedValue(undefined)
  mocks.costHandler.mockResolvedValue({ report: 'COST REPORT' })
  mocks.statsHandler.mockResolvedValue({ report: 'STATS REPORT' })
  mocks.debugHandler.mockResolvedValue({ report: 'DEBUG REPORT' })
})

describe('resolveBuiltinCommandPart', () => {
  it('returns a message without a command as is', async () => {
    const parts = [{ type: 'text', text: 'hi' }]

    expect(await resolveBuiltinCommandPart({
      event: { context: {} },
      parts,
      logger: createLogger(),
    })).toEqual(parts)
    expect(mocks.evaluateFeatureForEvent).not.toHaveBeenCalled()
  })

  it('keeps the command and its note with the commands flag on', async () => {
    const parts = [{ type: 'text', text: 'note' }, COMMAND_PART]

    expect(await resolveBuiltinCommandPart({
      event: { context: {} },
      parts,
      logger: createLogger(),
    })).toEqual(parts)
    expect(mocks.evaluateFeatureForEvent)
      .toHaveBeenCalledWith({ context: {} }, 'skills.commands')
  })

  it('refuses the command with the flag off', async () => {
    mocks.evaluateFeatureForEvent.mockResolvedValue({ active: false })

    await expect(resolveBuiltinCommandPart({
      event: { context: {} },
      parts: [COMMAND_PART],
      logger: createLogger(),
    })).rejects.toMatchObject({
      status: 400,
      code: 'command_invocation_unavailable',
      message: 'The /cost command is not available',
    })
  })

  it.each([
    ['a skill', {
      type: 'data-skill-invocation',
      data: { skillId: 's1', name: 'x', version: 1 },
    }],
    ['a file', { type: 'file', mediaType: 'image/png', url: '/f/1' }],
    ['a second command', {
      type: 'data-command-invocation',
      data: { command: 'stats' },
    }],
  ])('refuses a command next to %s', async (_label, extraPart) => {
    await expect(resolveBuiltinCommandPart({
      event: { context: {} },
      parts: [COMMAND_PART, extraPart],
      logger: createLogger(),
    })).rejects.toMatchObject({ status: 400 })
  })

  it('drops the command of a stored message instead of failing', async () => {
    mocks.evaluateFeatureForEvent.mockResolvedValue({ active: false })

    expect(await resolveBuiltinCommandPart({
      event: { context: {} },
      parts: [{ type: 'text', text: 'note' }, COMMAND_PART],
      logger: createLogger(),
      onUnavailable: 'drop',
    })).toEqual([{ type: 'text', text: 'note' }])
  })
})

describe('runBuiltinCommand', () => {
  it('runs the Besidka tool for the current chat without scopes', async () => {
    const logger = createLogger()
    const result = await runBuiltinCommand({
      db: { marker: 'db' } as never,
      userId: 7,
      chatSlug: SLUG,
      command: 'cost',
      argumentsText: 'ignored note',
      logger,
    })

    expect(result).toEqual({ report: 'COST REPORT', outcome: 'ok' })
    expect(mocks.costHandler).toHaveBeenCalledWith({}, expect.objectContaining({
      userId: 7,
      clientId: BUILTIN_COMMAND_CLIENT_ID,
      scopes: [],
      currentChatSlug: SLUG,
    }))
  })

  it.each([
    ['', '30d', false],
    ['7d', '7d', false],
    ['ALL more words', 'all', false],
    ['week', '30d', true],
  ])('reads the /stats period from %j', async (text, period, hasNote) => {
    const result = await runBuiltinCommand({
      db: {} as never,
      userId: 7,
      chatSlug: SLUG,
      command: 'stats',
      argumentsText: text,
      logger: createLogger(),
    })

    expect(mocks.statsHandler.mock.calls[0]?.[0]).toEqual({ period })
    expect(result.report.includes('Unknown period')).toBe(hasNote)
    expect(result.report).toContain('STATS REPORT')
  })

  it('shows a client error of the tool with its own message', async () => {
    const { createError } = await import('evlog')

    mocks.costHandler.mockRejectedValue(
      createError({ message: 'Chat not found.', status: 404 }),
    )

    expect(await runBuiltinCommand({
      db: {} as never,
      userId: 7,
      chatSlug: SLUG,
      command: 'cost',
      argumentsText: '',
      logger: createLogger(),
    })).toEqual({
      report: 'Chat not found.',
      outcome: 'error',
      status: 404,
    })
  })

  it('hides a server error behind one sentence', async () => {
    mocks.debugHandler.mockRejectedValue(new Error('D1 exploded'))

    expect(await runBuiltinCommand({
      db: {} as never,
      userId: 7,
      chatSlug: SLUG,
      command: 'debug',
      argumentsText: '',
      logger: createLogger(),
    })).toEqual({
      report: BUILTIN_COMMAND_FAILURE_TEXT,
      outcome: 'error',
      status: 500,
    })
  })
})

describe('respondWithBuiltinCommand', () => {
  const chat = {
    id: 'chat-1',
    slug: SLUG,
    projectId: null,
    messages: [],
  }

  it('stores the message and the report and streams the reply', async () => {
    const { db, set } = createDb()
    const response = await respondWithBuiltinCommand({
      event: {} as never,
      db,
      userId: 7,
      chat,
      newMessage: { id: 'user-1', parts: [COMMAND_PART] as never },
      logger: createLogger(),
    })
    const chunks = await readChunks(response)
    const stored = mocks.insertMessageWithPublicId.mock.calls[0]![0]

    expect(mocks.persistUserMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        newMessage: { id: 'user-1', parts: [COMMAND_PART] },
        tools: [],
        reasoning: 'off',
      }),
    )
    expect(stored.values).toMatchObject({
      chatId: 'chat-1',
      role: 'assistant',
      tools: [],
      reasoning: 'off',
      parts: [
        { type: 'data-command-report', data: { command: 'cost' } },
        { type: 'text', text: '```text\nCOST REPORT\n```' },
      ],
    })
    expect(stored.values).not.toHaveProperty('usage')
    expect(chunks).toEqual([
      { type: 'start', messageId: stored.publicId },
      { type: 'data-command-report', data: { command: 'cost' } },
      { type: 'text-start', id: 'command-text-1' },
      {
        type: 'text-delta',
        id: 'command-text-1',
        delta: '```text\nCOST REPORT\n```',
      },
      { type: 'text-end', id: 'command-text-1' },
      { type: 'finish', messageMetadata: { createdAt: expect.any(String) } },
    ])
    expect(set).toHaveBeenCalledWith({ title: 'Chat cost' })
  })

  it('does not rename a chat that already has messages', async () => {
    const { db, set } = createDb()

    await respondWithBuiltinCommand({
      event: {} as never,
      db,
      userId: 7,
      chat: {
        ...chat,
        messages: [{
          id: 'm1',
          publicId: 'old-user',
          role: 'user',
          parts: [{ type: 'text', text: 'hi' }],
          tools: [],
          reasoning: 'off',
        }] as never,
      },
      newMessage: { id: 'user-2', parts: [COMMAND_PART] as never },
      logger: createLogger(),
    })

    expect(set).not.toHaveBeenCalledWith({ title: 'Chat cost' })
  })

  it('replays a stored report for a resent message', async () => {
    const { db } = createDb()
    const reply = {
      id: 'm2',
      publicId: 'reply-1',
      role: 'assistant',
      parts: [
        { type: 'data-command-report', data: { command: 'cost' } },
        { type: 'text', text: 'stored' },
      ],
      tools: [],
      reasoning: 'off',
      createdAt: new Date('2026-11-20T10:00:00.000Z'),
    }
    const response = await respondWithBuiltinCommand({
      event: {} as never,
      db,
      userId: 7,
      chat: {
        ...chat,
        messages: [{
          id: 'm1',
          publicId: 'user-1',
          role: 'user',
          parts: [COMMAND_PART],
          tools: [],
          reasoning: 'off',
        }, reply] as never,
      },
      newMessage: { id: 'user-1', parts: [COMMAND_PART] as never },
      logger: createLogger(),
    })
    const chunks = await readChunks(response)

    expect(chunks[0]).toEqual({ type: 'start', messageId: 'reply-1' })
    expect(mocks.costHandler).not.toHaveBeenCalled()
    expect(mocks.persistUserMessage).not.toHaveBeenCalled()
    expect(mocks.insertMessageWithPublicId).not.toHaveBeenCalled()
  })

  it('answers 409 while a reply is being written', async () => {
    const { db } = createDb()

    mocks.isChatGenerating.mockResolvedValue(true)

    await expect(respondWithBuiltinCommand({
      event: {} as never,
      db,
      userId: 7,
      chat,
      newMessage: { id: 'user-1', parts: [COMMAND_PART] as never },
      logger: createLogger(),
    })).rejects.toMatchObject({ status: 409 })
    expect(mocks.persistUserMessage).not.toHaveBeenCalled()
  })

  it('answers 409 while a tool approval of the chat waits', async () => {
    const { db } = createDb()

    mocks.chatHasAwaitingApproval.mockReturnValue(true)

    await expect(respondWithBuiltinCommand({
      event: {} as never,
      db,
      userId: 7,
      chat,
      newMessage: { id: 'user-1', parts: [COMMAND_PART] as never },
      logger: createLogger(),
    })).rejects.toMatchObject({
      status: 409,
      code: 'approval_pending',
      message: 'Answer or dismiss the pending approval first.',
    })
    expect(mocks.persistUserMessage).not.toHaveBeenCalled()
    expect(mocks.costHandler).not.toHaveBeenCalled()
    expect(mocks.insertMessageWithPublicId).not.toHaveBeenCalled()
  })

  it('still replays a stored report while an approval waits', async () => {
    const { db } = createDb()
    const reply = {
      id: 'm2',
      publicId: 'reply-1',
      role: 'assistant',
      parts: [
        { type: 'data-command-report', data: { command: 'cost' } },
        { type: 'text', text: 'stored' },
      ],
      tools: [],
      reasoning: 'off',
      createdAt: new Date('2026-11-20T10:00:00.000Z'),
    }

    mocks.chatHasAwaitingApproval.mockReturnValue(true)

    const response = await respondWithBuiltinCommand({
      event: {} as never,
      db,
      userId: 7,
      chat: {
        ...chat,
        messages: [{
          id: 'm1',
          publicId: 'user-1',
          role: 'user',
          parts: [COMMAND_PART],
          tools: [],
          reasoning: 'off',
        }, reply] as never,
      },
      newMessage: { id: 'user-1', parts: [COMMAND_PART] as never },
      logger: createLogger(),
    })

    expect((await readChunks(response))[0])
      .toEqual({ type: 'start', messageId: 'reply-1' })
  })

  it('checks the per-user command limit before storing anything', async () => {
    const { db } = createDb()
    const event = {} as never
    const { createError } = await import('evlog')

    mocks.enforceBuiltinCommandRateLimit.mockRejectedValue(
      createError({ message: 'Too many commands', status: 429 }),
    )

    await expect(respondWithBuiltinCommand({
      event,
      db,
      userId: 7,
      chat,
      newMessage: { id: 'user-1', parts: [COMMAND_PART] as never },
      logger: createLogger(),
    })).rejects.toMatchObject({ status: 429 })
    expect(mocks.enforceBuiltinCommandRateLimit).toHaveBeenCalledWith(7, event)
    expect(mocks.persistUserMessage).not.toHaveBeenCalled()
    expect(mocks.costHandler).not.toHaveBeenCalled()
  })

  it('stores no reply for a command that failed, only the error', async () => {
    const { db, set } = createDb()
    const { createError } = await import('evlog')

    mocks.costHandler.mockRejectedValue(
      createError({ message: 'Chat not found.', status: 404 }),
    )

    await expect(respondWithBuiltinCommand({
      event: {} as never,
      db,
      userId: 7,
      chat,
      newMessage: { id: 'user-1', parts: [COMMAND_PART] as never },
      logger: createLogger(),
    })).rejects.toMatchObject({
      status: 404,
      message: 'Chat not found.',
    })
    expect(mocks.persistUserMessage).toHaveBeenCalledTimes(1)
    expect(mocks.insertMessageWithPublicId).not.toHaveBeenCalled()
    expect(set).not.toHaveBeenCalled()
  })

  it('hides a server error of a failed command behind one sentence', async () => {
    const { db } = createDb()

    mocks.debugHandler.mockRejectedValue(new Error('D1 exploded'))

    await expect(respondWithBuiltinCommand({
      event: {} as never,
      db,
      userId: 7,
      chat,
      newMessage: {
        id: 'user-1',
        parts: [{
          type: 'data-command-invocation',
          data: { command: 'debug' },
        }] as never,
      },
      logger: createLogger(),
    })).rejects.toMatchObject({
      status: 500,
      message: BUILTIN_COMMAND_FAILURE_TEXT,
    })
    expect(mocks.insertMessageWithPublicId).not.toHaveBeenCalled()
  })

  it('runs the command again when a failed message is resent', async () => {
    const { db } = createDb()
    const { createError } = await import('evlog')
    const storedUser = {
      id: 'm1',
      publicId: 'user-1',
      role: 'user',
      parts: [COMMAND_PART],
      tools: [],
      reasoning: 'off',
    }

    mocks.costHandler.mockRejectedValueOnce(
      createError({ message: 'Chat not found.', status: 404 }),
    )

    await expect(respondWithBuiltinCommand({
      event: {} as never,
      db,
      userId: 7,
      chat,
      newMessage: { id: 'user-1', parts: [COMMAND_PART] as never },
      logger: createLogger(),
    })).rejects.toMatchObject({ status: 404 })

    const response = await respondWithBuiltinCommand({
      event: {} as never,
      db,
      userId: 7,
      chat: { ...chat, messages: [storedUser] as never },
      newMessage: { id: 'user-1', parts: [COMMAND_PART] as never },
      logger: createLogger(),
    })

    expect(mocks.costHandler).toHaveBeenCalledTimes(2)
    expect(mocks.insertMessageWithPublicId).toHaveBeenCalledTimes(1)
    expect((await readChunks(response))[1])
      .toEqual({ type: 'data-command-report', data: { command: 'cost' } })
  })

  it('fences a report that contains backticks with a longer fence', async () => {
    const { db } = createDb()

    mocks.costHandler.mockResolvedValue({
      report: 'model\n```\nnot a fence\n```',
    })

    await respondWithBuiltinCommand({
      event: {} as never,
      db,
      userId: 7,
      chat,
      newMessage: { id: 'user-1', parts: [COMMAND_PART] as never },
      logger: createLogger(),
    })

    expect(mocks.insertMessageWithPublicId.mock.calls[0]![0].values.parts[1])
      .toEqual({
        type: 'text',
        text: '````text\nmodel\n```\nnot a fence\n```\n````',
      })
  })
})
