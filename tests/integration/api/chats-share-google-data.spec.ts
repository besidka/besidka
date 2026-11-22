import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loggerSet: vi.fn(),
  durationToExpiresAt: vi.fn(),
  syncChatShareFiles: vi.fn(),
  resolveJevRoleModel: vi.fn(),
}))

vi.mock('evlog', () => ({
  useLogger: () => ({ set: mocks.loggerSet }),
  createError: (input: { message?: string }) => {
    return Object.assign(new Error(input.message || 'Error'), input)
  },
}))

vi.mock('~~/server/utils/chats/share', () => ({
  durationToExpiresAt: mocks.durationToExpiresAt,
  syncChatShareFiles: mocks.syncChatShareFiles,
}))

vi.mock('~~/server/utils/jev/roles', () => ({
  resolveJevRoleModel: mocks.resolveJevRoleModel,
}))

const CHAT_SLUG = '01ARZ3NDEKTSV4RRFFQ69G5FB0'

function createDb(googleDataAt: Date | null) {
  const onConflictDoUpdate = vi.fn((_config: unknown) => ({
    returning: vi.fn(() => ({
      get: vi.fn(async () => ({ id: 'share-1', slug: 'share-slug' })),
    })),
  }))
  const insertValues = vi.fn((_values: unknown) => ({ onConflictDoUpdate }))

  return {
    db: {
      query: {
        chats: {
          findFirst: vi.fn(async () => ({ id: 'chat-1', googleDataAt })),
        },
      },
      insert: vi.fn(() => ({ values: insertValues })),
      update: vi.fn(() => ({
        set: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
      })),
    },
    insertValues,
    onConflictDoUpdate,
  }
}

function createBody(overrides: Record<string, unknown> = {}) {
  return {
    duration: 'week',
    indexable: false,
    showFiles: true,
    showMetadata: true,
    showAuthorAvatar: true,
    allowBranch: true,
    ...overrides,
  }
}

async function share(
  googleDataAt: Date | null,
  overrides: Record<string, unknown> = {},
) {
  const created = createDb(googleDataAt)

  vi.stubGlobal('useDb', () => created.db)

  const { default: handler } = await import(
    '../../../server/api/v1/chats/[slug]/share/index.post'
  )
  let error: unknown = null
  let response: unknown = null

  try {
    response = await handler({
      params: { slug: CHAT_SLUG },
      body: createBody(overrides),
    } as any)
  } catch (exception) {
    error = exception
  }

  return {
    error,
    response,
    insertValues: created.insertValues,
    onConflictDoUpdate: created.onConflictDoUpdate,
  }
}

describe('sharing a chat that holds Google data', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('getRouterParams', (event: { params: unknown }) => {
      return event.params
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
    vi.stubGlobal('useRuntimeConfig', () => ({
      public: { baseUrl: 'https://besidka.test' },
    }))
    mocks.durationToExpiresAt.mockReturnValue(null)
    mocks.syncChatShareFiles.mockResolvedValue(undefined)
  })

  it('refuses the share without the opt-in and writes nothing',
    async () => {
      const result = await share(new Date(1_700_000_000_000))

      expect(result.error).toMatchObject({
        status: 409,
        data: { reason: 'google-data-share-opt-in' },
      })
      expect(result.insertValues).not.toHaveBeenCalled()
      expect(mocks.syncChatShareFiles).not.toHaveBeenCalled()
    })

  it('refuses an opt-in that is not exactly true', async () => {
    const result = await share(new Date(1_700_000_000_000), {
      includeGoogleContent: false,
    })

    expect(result.error).toMatchObject({ status: 409 })
  })

  it('shares with the opt-in and records it with ids only', async () => {
    const result = await share(new Date(1_700_000_000_000), {
      includeGoogleContent: true,
    })

    expect(result.error).toBeNull()
    expect(result.insertValues).toHaveBeenCalled()
    expect(mocks.loggerSet).toHaveBeenCalledWith({
      chatId: 'chat-1',
      attributes: { googleDataGuard: { shareOptIn: true } },
    })
  })

  it('stores the opt-in and forces indexing off, on create and re-share',
    async () => {
      const result = await share(new Date(1_700_000_000_000), {
        includeGoogleContent: true,
        indexable: true,
      })
      const values = result.insertValues.mock.calls[0]?.[0] as unknown as
        Record<string, unknown>
      const onConflict = result.onConflictDoUpdate.mock.calls[0]?.[0] as
        unknown as { set: Record<string, unknown> }

      expect(values).toMatchObject({
        indexable: false,
        googleOptInAt: expect.any(Date),
      })
      expect(onConflict.set).toMatchObject({
        indexable: false,
        googleOptInAt: expect.any(Date),
      })
      expect(result.response).toMatchObject({ indexable: false })
    })

  it('needs no opt-in for a chat without Google data', async () => {
    const result = await share(null, { indexable: true })
    const values = result.insertValues.mock.calls[0]?.[0] as unknown as
      Record<string, unknown>

    expect(result.error).toBeNull()
    expect(values).toMatchObject({ indexable: true, googleOptInAt: null })
  })
})

describe('the share personal-data check of a chat that holds Google data',
  () => {
    beforeEach(() => {
      vi.resetModules()
      vi.clearAllMocks()
      mocks.resolveJevRoleModel.mockResolvedValue({ decide: vi.fn() })
    })

    async function check(holdsGoogleData: boolean) {
      const { checkSharedChatForPii } = await import(
        '~~/server/utils/chats/share-pii-check'
      )

      return await checkSharedChatForPii({
        db: {} as Parameters<typeof checkSharedChatForPii>[0]['db'],
        userId: 1,
        title: 'Plan',
        messages: [{
          role: 'assistant',
          parts: [{ type: 'text', text: 'Write to jane@example.com.' }],
        }],
        showFiles: false,
        holdsGoogleData,
      })
    }

    it('asks no TypeSafe AI role and reports the check as not done',
      async () => {
        const result = await check(true)

        expect(result.checked).toBe(false)
        expect(mocks.resolveJevRoleModel).not.toHaveBeenCalled()
      })

    it('asks the role for a chat without Google data', async () => {
      await check(false).catch(() => null)

      expect(mocks.resolveJevRoleModel).toHaveBeenCalled()
    })
  })
