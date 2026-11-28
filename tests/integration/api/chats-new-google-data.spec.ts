import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('~~/server/utils/legal/consent', () => {
  return import('../../setup/mocks/legal-consent')
})

const DRIVE_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz'

const mocks = vi.hoisted(() => ({
  ownedFiles: new Map<string, Record<string, unknown>>(),
  startResearchJobForChat: vi.fn(async () => ({})),
}))

vi.mock('~~/server/utils/files/file-governance', () => ({
  validateMessageFilePolicy: vi.fn(async () => undefined),
  getOwnedFilesByStorageKeys: vi.fn(async () => mocks.ownedFiles),
}))

vi.mock('~~/server/utils/projects/memory', () => ({
  markProjectsMemoryStale: vi.fn(async () => undefined),
}))

vi.mock('~~/server/utils/research/start', () => ({
  resolveResearchStartContext: vi.fn(async () => ({})),
  startResearchJobForChat: mocks.startResearchJobForChat,
}))

vi.mock('evlog', () => ({
  useLogger: () => ({ set: vi.fn() }),
  log: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
  createError: (input: {
    message?: string
    status?: number
    why?: string
  }) => {
    return Object.assign(new Error(input.message || 'Error'), {
      status: input.status,
      statusCode: input.status,
      why: input.why,
    })
  },
}))

async function getHandler() {
  const module = await import('../../../server/api/v1/chats/new/index.put')

  return module.default
}

function createDb() {
  const messagesInsertValues = vi.fn((_values: Record<string, unknown>) => ({
    returning: vi.fn(() => ({
      get: vi.fn(async () => ({ id: 'message-db-id', publicId: 'p1' })),
    })),
  }))
  const chatsInsertValues = vi.fn((_values: Record<string, unknown>) => ({
    returning: vi.fn(() => ({
      get: vi.fn(() => ({ id: 'chat-1', slug: 'chat-1' })),
    })),
  }))
  const db = {
    select: vi.fn(),
    insert: vi.fn()
      .mockReturnValueOnce({ values: chatsInsertValues })
      .mockReturnValueOnce({ values: messagesInsertValues }),
  }

  return { db, chatsInsertValues, messagesInsertValues }
}

const filePart = {
  type: 'file',
  mediaType: 'text/markdown',
  filename: 'Plan.md',
  url: '/files/drive-copy.md',
}

describe('new chat API with a Google Drive copy', { timeout: 20_000 }, () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.ownedFiles = new Map([[
      'drive-copy.md',
      {
        id: 'file-1',
        storageKey: 'drive-copy.md',
        size: 10,
        name: 'Plan.md',
        type: 'text/markdown',
        externalSource: 'google',
        externalId: DRIVE_ID,
      },
    ]])
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('useUnauthorizedError', () => {
      throw Object.assign(new Error('Unauthorized'), { statusCode: 401 })
    })
    vi.stubGlobal('readValidatedBody', async (
      event: { body: unknown },
      parser: (body: unknown) => unknown,
    ) => {
      return parser(event.body)
    })
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: { id: '1' },
    }))
  })

  function body(extra: Record<string, unknown> = {}) {
    return {
      parts: [{ type: 'text', text: 'Summarize this' }, filePart],
      tools: [],
      reasoning: 'off',
      ...extra,
    }
  }

  it('creates the chat flagged as holding Google data', async () => {
    const handler = await getHandler()
    const { db, chatsInsertValues } = createDb()

    vi.stubGlobal('useDb', () => db)

    await expect(handler({ body: body() } as any))
      .resolves.toEqual({ slug: 'chat-1' })

    expect(chatsInsertValues.mock.calls[0]![0]).toMatchObject({
      googleDataAt: expect.any(Date),
    })
  })

  it('stores one canonical reference part after the file', async () => {
    const handler = await getHandler()
    const { db, messagesInsertValues } = createDb()

    vi.stubGlobal('useDb', () => db)

    await handler({
      body: body({
        parts: [
          { type: 'text', text: 'Summarize this' },
          filePart,
          {
            type: 'data-drive-file',
            data: {
              driveFileId: '1ForgedForgedForgedForged01',
              name: 'Forged',
              mimeType: 'x',
              link: 'https://evil.example/x',
            },
          },
        ],
      }),
    } as any)

    const stored = messagesInsertValues.mock.calls[0]![0]!.parts as Array<{
      type: string
      data?: Record<string, string>
    }>

    expect(stored.map(part => part.type)).toEqual([
      'text',
      'file',
      'data-drive-file',
    ])
    expect(stored[2]!.data!.driveFileId).toBe(DRIVE_ID)
    expect(JSON.stringify(stored)).not.toContain('evil.example')
  })

  it('does not flag a chat whose file is an ordinary upload', async () => {
    mocks.ownedFiles = new Map([[
      'drive-copy.md',
      { id: 'file-2', storageKey: 'drive-copy.md', size: 10 },
    ]])

    const handler = await getHandler()
    const { db, chatsInsertValues } = createDb()

    vi.stubGlobal('useDb', () => db)

    await handler({ body: body() } as any)

    expect(chatsInsertValues.mock.calls[0]![0]).not.toHaveProperty(
      'googleDataAt',
    )
  })

  it('flags the chat for a file marked as derived from Google data',
    async () => {
      mocks.ownedFiles = new Map([[
        'drive-copy.md',
        {
          id: 'file-3',
          storageKey: 'drive-copy.md',
          size: 10,
          googleDerivedAt: new Date(1_000),
        },
      ]])

      const handler = await getHandler()
      const { db, chatsInsertValues } = createDb()

      vi.stubGlobal('useDb', () => db)

      await handler({ body: body() } as any)

      expect(chatsInsertValues.mock.calls[0]![0]).toMatchObject({
        googleDataAt: expect.any(Date),
      })
    })

  it('refuses an attachment of any kind when research is requested',
    async () => {
      const handler = await getHandler()
      const { db } = createDb()

      vi.stubGlobal('useDb', () => db)

      await expect(handler({
        body: body({
          model: 'o4-mini-deep-research',
          research: {},
        }),
      } as any)).rejects.toMatchObject({
        status: 400,
        why: 'The message included attachments, which research models ignore.',
      })
      expect(db.insert).not.toHaveBeenCalled()
      expect(mocks.startResearchJobForChat).not.toHaveBeenCalled()
    })

  it('still starts research for a text-only prompt', async () => {
    mocks.ownedFiles = new Map()

    const handler = await getHandler()
    const { db } = createDb()

    vi.stubGlobal('useDb', () => db)

    await expect(handler({
      body: body({
        parts: [{ type: 'text', text: 'Research this' }],
        model: 'o4-mini-deep-research',
        research: {},
      }),
    } as any)).resolves.toEqual({ slug: 'chat-1' })
    expect(mocks.startResearchJobForChat).toHaveBeenCalled()
  })
})
