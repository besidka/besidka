import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('~~/server/utils/legal/consent', () => {
  return import('../../setup/mocks/legal-consent')
})

const mocks = vi.hoisted(() => ({
  isFeatureOn: true,
  requireFeature: vi.fn(),
  artifactRows: [] as Array<Record<string, unknown>>,
  loggerSet: vi.fn(),
}))

vi.mock('~~/server/utils/features/guards', () => ({
  FEATURE_UNAVAILABLE_WHY: 'feature_unavailable',
  requireFeature: mocks.requireFeature,
}))

vi.mock('~~/server/utils/files/file-governance', () => ({
  validateMessageFilePolicy: vi.fn(async () => undefined),
}))

vi.mock('~~/server/utils/projects/memory', () => ({
  markProjectsMemoryStale: vi.fn(async () => undefined),
}))

vi.mock('~~/server/utils/research/start', () => ({
  resolveResearchStartContext: vi.fn(async () => ({})),
  startResearchJobForChat: vi.fn(async () => ({})),
}))

vi.mock('evlog', () => ({
  useLogger: () => ({ set: mocks.loggerSet }),
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
    code?: string
  }) => {
    const exception = new Error(input.message || 'Error')

    Object.assign(exception, {
      status: input.status,
      statusCode: input.status,
      why: input.why,
      code: input.code,
    })

    return exception
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
  const chatsInsertValues = vi.fn(() => ({
    returning: vi.fn(() => ({
      get: vi.fn(() => ({ id: 'chat-1', slug: 'chat-1' })),
    })),
  }))
  const select = vi.fn(() => ({
    from: () => ({
      where: async () => mocks.artifactRows,
    }),
  }))
  const db = {
    select,
    insert: vi.fn()
      .mockReturnValueOnce({ values: chatsInsertValues })
      .mockReturnValueOnce({ values: messagesInsertValues }),
  }

  return { db, chatsInsertValues, messagesInsertValues, select }
}

describe('new chat API with attached artifacts', () => {
  let attachmentPart: Record<string, unknown>
  let artifactId: string

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    mocks.isFeatureOn = true
    mocks.requireFeature.mockImplementation(async () => {
      if (!mocks.isFeatureOn) {
        throw Object.assign(new Error('Not found'), {
          status: 404,
          why: 'feature_unavailable',
        })
      }
    })

    const { encodeArtifactId } = await import(
      '../../../server/utils/artifacts/store'
    )

    artifactId = encodeArtifactId(7)
    attachmentPart = {
      type: 'data-artifact-attachment',
      data: {
        artifactId,
        version: 1,
        kind: 'svg',
        title: 'Forged',
      },
    }
    mocks.artifactRows = [{
      id: 7,
      kind: 'html',
      title: 'Stored title',
      currentVersion: 2,
      takedownAt: null,
    }]

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
      parts: [{ type: 'text', text: 'Fix this' }, attachmentPart],
      tools: [],
      reasoning: 'off',
      ...extra,
    }
  }

  it('stores the attachment rewritten from the artifact row', async () => {
    const handler = await getHandler()
    const { db, messagesInsertValues } = createDb()

    vi.stubGlobal('useDb', () => db)

    await expect(handler({ body: body() } as any))
      .resolves.toEqual({ slug: 'chat-1' })

    expect(mocks.requireFeature).toHaveBeenCalledWith(
      expect.anything(),
      'artifacts',
    )
    expect(messagesInsertValues.mock.calls[0]![0]).toMatchObject({
      role: 'user',
      parts: [
        { type: 'text', text: 'Fix this' },
        {
          type: 'data-artifact-attachment',
          data: {
            artifactId,
            version: 1,
            kind: 'html',
            title: 'Stored title',
          },
        },
      ],
    })
  })

  it('creates nothing and answers 404 when the user has no access',
    async () => {
      mocks.isFeatureOn = false

      const handler = await getHandler()
      const { db, select } = createDb()

      vi.stubGlobal('useDb', () => db)

      await expect(handler({ body: body() } as any)).rejects.toMatchObject({
        status: 404,
        why: 'feature_unavailable',
      })
      expect(db.insert).not.toHaveBeenCalled()
      expect(select).not.toHaveBeenCalled()
    })

  it('does not evaluate the feature for a message without attachments',
    async () => {
      mocks.isFeatureOn = false

      const handler = await getHandler()
      const { db } = createDb()

      vi.stubGlobal('useDb', () => db)

      await expect(handler({
        body: {
          parts: [{ type: 'text', text: 'Hello' }],
          tools: [],
          reasoning: 'off',
        },
      } as any)).resolves.toEqual({ slug: 'chat-1' })
      expect(mocks.requireFeature).not.toHaveBeenCalled()
    })

  it('rejects an artifact that is not the user\'s own', async () => {
    mocks.artifactRows = []

    const handler = await getHandler()
    const { db } = createDb()

    vi.stubGlobal('useDb', () => db)

    await expect(handler({ body: body() } as any)).rejects.toMatchObject({
      status: 400,
      code: 'artifact_attachment_unavailable',
    })
    expect(db.insert).not.toHaveBeenCalled()
  })

  it('rejects a taken-down artifact', async () => {
    mocks.artifactRows = [{
      id: 7,
      kind: 'html',
      title: 'Removed',
      currentVersion: 2,
      takedownAt: new Date(),
    }]

    const handler = await getHandler()
    const { db } = createDb()

    vi.stubGlobal('useDb', () => db)

    await expect(handler({ body: body() } as any)).rejects.toMatchObject({
      status: 451,
    })
    expect(db.insert).not.toHaveBeenCalled()
  })

  it('rejects a fourth attachment before touching the database',
    async () => {
      const handler = await getHandler()
      const { db } = createDb()

      vi.stubGlobal('useDb', () => db)

      const { encodeArtifactId } = await import(
        '../../../server/utils/artifacts/store'
      )
      const extra = [8, 9, 10].map((id) => {
        return {
          type: 'data-artifact-attachment',
          data: {
            artifactId: encodeArtifactId(id),
            version: 1,
            kind: 'html',
            title: `Extra ${id}`,
          },
        }
      })

      await expect(handler({
        body: body({
          parts: [{ type: 'text', text: 'Hi' }, attachmentPart, ...extra],
        }),
      } as any)).rejects.toMatchObject({ message: 'Invalid request body' })
      expect(db.insert).not.toHaveBeenCalled()
    })

  it('leaves attachments out of a research request', async () => {
    const handler = await getHandler()
    const { db, messagesInsertValues } = createDb()

    vi.stubGlobal('useDb', () => db)

    await handler({
      body: body({ model: 'gpt-5.4-nano', research: {} }),
    } as any)

    expect(mocks.requireFeature).not.toHaveBeenCalled()
    expect(messagesInsertValues.mock.calls[0]![0]).toMatchObject({
      parts: [{ type: 'text', text: 'Fix this' }],
    })
  })
})
