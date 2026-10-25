import { getTableName } from 'drizzle-orm'
import { createError as createEvlogError } from 'evlog'
import { SQLiteDialect } from 'drizzle-orm/sqlite-core/dialect'
import { beforeEach, describe, expect, it, vi } from 'vitest'

interface SettingsRecord {
  id: number
  reasoningExpanded: boolean
  reasoningAutoHide: boolean
  allowExternalLinks: boolean | null
  notificationPromptState: boolean | null
  sidebarPinned: boolean
  favoriteModels: string[] | null
  favoriteGatewayModels: Record<string, string[]> | null
  memoryEnabled: boolean | null
  memoryExtractionEnabled: boolean | null
  chatSearchEnabled: boolean | null
  memoryIncludeSensitive: boolean | null
  aboutMe: string | null
  profileMemoryModel: string | null
  profileMemoryGateway: string | null
  projectMemoryModel: string | null
  projectMemoryGateway: string | null
}

type SettingsValues = Partial<Omit<SettingsRecord, 'id'>>

const columnDefaults: Omit<SettingsRecord, 'id'> = {
  reasoningExpanded: false,
  reasoningAutoHide: true,
  allowExternalLinks: null,
  notificationPromptState: null,
  sidebarPinned: false,
  favoriteModels: null,
  favoriteGatewayModels: null,
  memoryEnabled: null,
  memoryExtractionEnabled: null,
  chatSearchEnabled: null,
  memoryIncludeSensitive: null,
  aboutMe: null,
  profileMemoryModel: null,
  profileMemoryGateway: null,
  projectMemoryModel: null,
  projectMemoryGateway: null,
}

const memoryDefaults = {
  memoryEnabled: true,
  memoryExtractionEnabled: false,
  chatSearchEnabled: true,
  memoryIncludeSensitive: false,
  aboutMe: null,
  profileMemoryModel: null,
  profileMemoryGateway: null,
  projectMemoryModel: null,
  projectMemoryGateway: null,
}

interface FakeStatement {
  kind: string
  execute: () => Promise<unknown>
  then: (
    resolve: (value: unknown) => unknown,
    reject: (reason: unknown) => unknown,
  ) => Promise<unknown>
}

function createStatement(
  kind: string,
  run: () => Promise<unknown> | unknown,
): FakeStatement {
  const execute = async () => {
    mocks.callOrder.push(kind)

    return await run()
  }

  return {
    kind,
    execute,
    then: (resolve, reject) => {
      return execute().then(resolve, reject)
    },
  }
}

const mocks = vi.hoisted(() => ({
  callOrder: [] as string[],
  batchError: null as Error | null,
  loggerSet: vi.fn(),
  getCachedGatewayCatalog: vi.fn(),
  getCachedCloudflareGatewayCatalog: vi.fn(),
  getCloudflareGatewayCredentials: vi.fn(),
  enforceGatewayModelsRateLimit: vi.fn(),
  classifySensitiveCategories: vi.fn(),
}))

vi.mock('~~/server/utils/logging/request-logger', () => ({
  useRequestLogger: () => ({ set: mocks.loggerSet }),
}))

vi.mock('~~/server/utils/gateways/catalog', () => ({
  getCachedGatewayCatalog: mocks.getCachedGatewayCatalog,
  getCachedCloudflareGatewayCatalog: mocks.getCachedCloudflareGatewayCatalog,
}))

vi.mock('~~/server/utils/gateways/cloudflare', () => ({
  getCloudflareGatewayCredentials: mocks.getCloudflareGatewayCredentials,
}))

vi.mock('~~/server/utils/gateways/catalog-rate-limit', () => ({
  enforceGatewayModelsRateLimit: mocks.enforceGatewayModelsRateLimit,
}))

vi.mock('~~/server/utils/memory/sensitivity', () => ({
  classifySensitiveCategories: mocks.classifySensitiveCategories,
}))

function createDbMock() {
  let currentSettings: SettingsRecord | null = null

  const findFirst = vi.fn().mockImplementation(async () => {
    return currentSettings
  })
  const insertValues = vi.fn().mockImplementation((
    values: SettingsValues & { userId: number },
  ) => {
    return createStatement('insert', () => {
      const { userId: _userId, ...columns } = values

      currentSettings = {
        id: 1,
        ...columnDefaults,
        ...columns,
      }
    })
  })
  const insert = vi.fn(() => ({
    values: insertValues,
  }))
  const updateWhere = vi.fn()
  const updateSet = vi.fn().mockImplementation((values: SettingsValues) => {
    updateWhere.mockImplementation(() => {
      return createStatement('update', () => {
        currentSettings = {
          ...(currentSettings ?? { id: 1, ...columnDefaults }),
          ...values,
        }
      })
    })

    return {
      where: updateWhere,
    }
  })
  const chatStampWhere = vi.fn().mockImplementation(() => {
    return createStatement('chat-stamp', () => [])
  })
  const chatStampSet = vi.fn(() => ({
    where: chatStampWhere,
  }))
  const update = vi.fn((table: unknown) => {
    if (getTableName(table as never) === 'chats') {
      return { set: chatStampSet }
    }

    return { set: updateSet }
  })
  const batch = vi.fn(async (statements: FakeStatement[]) => {
    if (mocks.batchError) {
      throw mocks.batchError
    }

    const results: unknown[] = []

    for (const statement of statements) {
      results.push(await statement.execute())
    }

    return results
  })

  function seed(values: SettingsValues) {
    currentSettings = {
      id: 1,
      ...columnDefaults,
      ...values,
    }
  }

  function getSettings() {
    return currentSettings
  }

  const db = {
    query: {
      userSettings: {
        findFirst,
      },
    },
    insert,
    update,
    batch,
  }

  return {
    seed,
    getSettings,
    db,
    spies: {
      findFirst,
      insert,
      insertValues,
      update,
      updateSet,
      updateWhere,
      chatStampSet,
      chatStampWhere,
      batch,
    },
  }
}

async function getSettingsHandler() {
  const module = await import(
    '../../../server/api/v1/profiles/settings/index.get'
  )

  return module.default
}

async function patchSettingsHandler() {
  const module = await import(
    '../../../server/api/v1/profiles/settings/index.patch'
  )

  return module.default
}

describe('profile settings API', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()

    mocks.callOrder.length = 0
    mocks.batchError = null
    mocks.classifySensitiveCategories.mockReturnValue([])
    mocks.enforceGatewayModelsRateLimit.mockResolvedValue(undefined)
    mocks.getCachedGatewayCatalog.mockResolvedValue([])
    mocks.getCachedCloudflareGatewayCatalog.mockResolvedValue([])
    mocks.getCloudflareGatewayCredentials.mockResolvedValue(undefined)

    vi.stubGlobal('defineEventHandler', (handler: any) => handler)
    vi.stubGlobal('createError', (input: any) => {
      const exception = new Error(input.statusMessage || input.message)

      Object.assign(exception, input)

      return exception
    })
    vi.stubGlobal('useUnauthorizedError', () => {
      throw (globalThis as any).createError({
        statusCode: 401,
        statusMessage: 'Unauthorized',
      })
    })
    vi.stubGlobal(
      'readValidatedBody',
      async (event: any, parser: (body: unknown) => unknown) => {
        return parser(event.body)
      },
    )
  })

  it('returns 401 for unauthorized requests', async () => {
    const getHandler = await getSettingsHandler()
    const patchHandler = await patchSettingsHandler()
    const dbMock = createDbMock()

    vi.stubGlobal('useDb', () => dbMock.db)
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue(null))

    await expect(getHandler({} as any)).rejects.toMatchObject({
      statusCode: 401,
    })
    await expect(patchHandler({
      body: {
        reasoningExpanded: true,
      },
    } as any)).rejects.toMatchObject({
      statusCode: 401,
    })
  })

  it('returns default false when settings row does not exist', async () => {
    const handler = await getSettingsHandler()
    const dbMock = createDbMock()

    vi.stubGlobal('useDb', () => dbMock.db)
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: {
        id: '1',
      },
    }))

    const response = await handler({} as any)

    expect(response).toEqual({
      reasoningExpanded: false,
      reasoningAutoHide: true,
      allowExternalLinks: null,
      notificationPromptState: null,
      sidebarPinned: false,
      favoriteModels: [],
      favoriteGatewayModels: {},
      ...memoryDefaults,
    })
  })

  it('upserts settings and returns persisted value', async () => {
    const getHandler = await getSettingsHandler()
    const patchHandler = await patchSettingsHandler()
    const dbMock = createDbMock()

    vi.stubGlobal('useDb', () => dbMock.db)
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: {
        id: '1',
      },
    }))

    const firstPatchResponse = await patchHandler({
      body: {
        reasoningExpanded: true,
      },
    } as any)

    expect(firstPatchResponse).toEqual({
      reasoningExpanded: true,
    })
    expect(dbMock.spies.insert).toHaveBeenCalledTimes(1)

    const secondPatchResponse = await patchHandler({
      body: {
        reasoningExpanded: false,
      },
    } as any)

    expect(secondPatchResponse).toEqual({
      reasoningExpanded: false,
    })
    expect(dbMock.spies.update).toHaveBeenCalledTimes(1)

    const getResponse = await getHandler({} as any)

    expect(getResponse).toEqual({
      reasoningExpanded: false,
      reasoningAutoHide: true,
      allowExternalLinks: null,
      notificationPromptState: null,
      sidebarPinned: false,
      favoriteModels: [],
      favoriteGatewayModels: {},
      ...memoryDefaults,
    })
  })

  it('saves and returns reasoningAutoHide', async () => {
    const getHandler = await getSettingsHandler()
    const patchHandler = await patchSettingsHandler()
    const dbMock = createDbMock()

    vi.stubGlobal('useDb', () => dbMock.db)
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: {
        id: '1',
      },
    }))

    const patchResponse = await patchHandler({
      body: {
        reasoningAutoHide: false,
      },
    } as any)

    expect(patchResponse).toEqual({
      reasoningAutoHide: false,
    })

    const getResponse = await getHandler({} as any)

    expect(getResponse).toEqual({
      reasoningExpanded: false,
      reasoningAutoHide: false,
      allowExternalLinks: null,
      notificationPromptState: null,
      sidebarPinned: false,
      favoriteModels: [],
      favoriteGatewayModels: {},
      ...memoryDefaults,
    })
  })

  it('saves and returns allowExternalLinks', async () => {
    const getHandler = await getSettingsHandler()
    const patchHandler = await patchSettingsHandler()
    const dbMock = createDbMock()

    vi.stubGlobal('useDb', () => dbMock.db)
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: {
        id: '1',
      },
    }))

    const patchResponse = await patchHandler({
      body: {
        allowExternalLinks: true,
      },
    } as any)

    expect(patchResponse).toEqual({
      allowExternalLinks: true,
    })

    const getResponse = await getHandler({} as any)

    expect(getResponse).toEqual({
      reasoningExpanded: false,
      reasoningAutoHide: true,
      allowExternalLinks: true,
      notificationPromptState: null,
      sidebarPinned: false,
      favoriteModels: [],
      favoriteGatewayModels: {},
      ...memoryDefaults,
    })
  })

  it('saves and returns notificationPromptState', async () => {
    const getHandler = await getSettingsHandler()
    const patchHandler = await patchSettingsHandler()
    const dbMock = createDbMock()

    vi.stubGlobal('useDb', () => dbMock.db)
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: {
        id: '1',
      },
    }))

    const patchResponse = await patchHandler({
      body: {
        notificationPromptState: false,
      },
    } as any)

    expect(patchResponse).toEqual({
      notificationPromptState: false,
    })

    const getResponse = await getHandler({} as any)

    expect(getResponse).toEqual({
      reasoningExpanded: false,
      reasoningAutoHide: true,
      allowExternalLinks: null,
      notificationPromptState: false,
      sidebarPinned: false,
      favoriteModels: [],
      favoriteGatewayModels: {},
      ...memoryDefaults,
    })
  })

  it('saves and returns sidebarPinned', async () => {
    const getHandler = await getSettingsHandler()
    const patchHandler = await patchSettingsHandler()
    const dbMock = createDbMock()

    vi.stubGlobal('useDb', () => dbMock.db)
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: {
        id: '1',
      },
    }))

    const patchResponse = await patchHandler({
      body: {
        sidebarPinned: true,
      },
    } as any)

    expect(patchResponse).toEqual({
      sidebarPinned: true,
    })

    const getResponse = await getHandler({} as any)

    expect(getResponse).toEqual({
      reasoningExpanded: false,
      reasoningAutoHide: true,
      allowExternalLinks: null,
      notificationPromptState: null,
      sidebarPinned: true,
      favoriteModels: [],
      favoriteGatewayModels: {},
      ...memoryDefaults,
    })
  })

  it('saves deduped favoriteModels and returns them', async () => {
    const getHandler = await getSettingsHandler()
    const patchHandler = await patchSettingsHandler()
    const dbMock = createDbMock()

    vi.stubGlobal('useDb', () => dbMock.db)
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: {
        id: '1',
      },
    }))

    const patchResponse = await patchHandler({
      body: {
        favoriteModels: ['gpt-5.4', 'gemini-2.5-flash', 'gpt-5.4'],
      },
    } as any)

    expect(patchResponse).toEqual({
      favoriteModels: ['gpt-5.4', 'gemini-2.5-flash'],
    })

    const getResponse = await getHandler({} as any)

    expect(getResponse).toEqual({
      reasoningExpanded: false,
      reasoningAutoHide: true,
      allowExternalLinks: null,
      notificationPromptState: null,
      sidebarPinned: false,
      favoriteModels: ['gpt-5.4', 'gemini-2.5-flash'],
      favoriteGatewayModels: {},
      ...memoryDefaults,
    })
  })

  it('rejects a favoriteModels list over the cap', async () => {
    const patchHandler = await patchSettingsHandler()
    const dbMock = createDbMock()

    vi.stubGlobal('useDb', () => dbMock.db)
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: {
        id: '1',
      },
    }))

    await expect(patchHandler({
      body: {
        favoriteModels: Array.from({ length: 51 }, (_value, index) => {
          return `model-${index}`
        }),
      },
    } as any)).rejects.toMatchObject({
      statusCode: 400,
    })
  })

  it('rejects a favoriteModels entry over the per-string length cap',
    async () => {
      const patchHandler = await patchSettingsHandler()
      const dbMock = createDbMock()

      vi.stubGlobal('useDb', () => dbMock.db)
      vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
        user: {
          id: '1',
        },
      }))

      await expect(patchHandler({
        body: {
          favoriteModels: ['a'.repeat(101)],
        },
      } as any)).rejects.toMatchObject({
        statusCode: 400,
      })
    })

  it('returns 400 for invalid patch payload', async () => {
    const patchHandler = await patchSettingsHandler()
    const dbMock = createDbMock()

    vi.stubGlobal('useDb', () => dbMock.db)
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: {
        id: '1',
      },
    }))

    await expect(patchHandler({
      body: {
        reasoningExpanded: 'yes',
      },
    } as any)).rejects.toMatchObject({
      statusCode: 400,
      statusMessage: 'Invalid request body',
    })
  })

  describe('memory settings', () => {
    const textGatewayModel = {
      id: 'openai/gpt-5',
      name: 'GPT-5',
      toolCall: true,
      modalities: { input: ['text'], output: ['text'] },
    }
    const imageOnlyGatewayModel = {
      id: 'black-forest/flux',
      name: 'Flux',
      toolCall: false,
      modalities: { input: ['text'], output: ['image'] },
    }

    function setup() {
      const dbMock = createDbMock()

      vi.stubGlobal('useDb', () => dbMock.db)
      vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
        user: {
          id: '1',
        },
      }))

      return dbMock
    }

    function patchEvent(body: Record<string, unknown>) {
      return {
        body,
        context: {},
      } as any
    }

    it('returns persisted memory settings', async () => {
      const getHandler = await getSettingsHandler()
      const dbMock = setup()

      dbMock.seed({
        memoryEnabled: true,
        chatSearchEnabled: false,
        memoryIncludeSensitive: true,
        aboutMe: 'I like terse answers',
        profileMemoryModel: 'openai/gpt-5',
        profileMemoryGateway: 'vercel',
        projectMemoryModel: 'claude-sonnet-5-5',
        projectMemoryGateway: null,
      })

      const response = await getHandler({} as any)

      expect(response).toMatchObject({
        memoryEnabled: true,
        chatSearchEnabled: false,
        memoryIncludeSensitive: false,
        aboutMe: 'I like terse answers',
        profileMemoryModel: 'openai/gpt-5',
        profileMemoryGateway: 'vercel',
        projectMemoryModel: 'claude-sonnet-5-5',
        projectMemoryGateway: null,
      })
    })

    it('returns a constant false memoryIncludeSensitive even when the '
      + 'stored column is true', async () => {
      const getHandler = await getSettingsHandler()
      const dbMock = setup()

      dbMock.seed({ memoryIncludeSensitive: true })

      expect(await getHandler({} as any)).toMatchObject({
        memoryIncludeSensitive: false,
      })
    })

    it('persists booleans and aboutMe exactly as sent', async () => {
      const getHandler = await getSettingsHandler()
      const patchHandler = await patchSettingsHandler()

      setup()

      const response = await patchHandler(patchEvent({
        memoryEnabled: true,
        chatSearchEnabled: false,
        aboutMe: 'Backend engineer',
      }))

      expect(response).toEqual({
        memoryEnabled: true,
        chatSearchEnabled: false,
        aboutMe: 'Backend engineer',
      })
      expect(await getHandler({} as any)).toMatchObject({
        memoryEnabled: true,
        chatSearchEnabled: false,
        aboutMe: 'Backend engineer',
      })
    })

    it('trims aboutMe and turns an empty value into null', async () => {
      const patchHandler = await patchSettingsHandler()

      setup()

      expect(await patchHandler(patchEvent({
        aboutMe: '  padded  ',
      }))).toEqual({ aboutMe: 'padded' })
      expect(await patchHandler(patchEvent({
        aboutMe: '',
      }))).toEqual({ aboutMe: null })
      expect(await patchHandler(patchEvent({
        aboutMe: '   \n ',
      }))).toEqual({ aboutMe: null })
      expect(await patchHandler(patchEvent({
        aboutMe: null,
      }))).toEqual({ aboutMe: null })
    })

    it('rejects aboutMe over 4000 characters', async () => {
      const patchHandler = await patchSettingsHandler()
      const dbMock = setup()

      await expect(patchHandler(patchEvent({
        aboutMe: 'a'.repeat(4001),
      }))).rejects.toMatchObject({ statusCode: 400 })
      expect(await patchHandler(patchEvent({
        aboutMe: 'a'.repeat(4000),
      }))).toMatchObject({ aboutMe: 'a'.repeat(4000) })
      expect(dbMock.spies.insert).toHaveBeenCalledTimes(1)
    })

    it('accepts a direct catalog model without a key or catalog call',
      async () => {
        const patchHandler = await patchSettingsHandler()

        setup()

        const response = await patchHandler(patchEvent({
          profileMemoryModel: 'claude-sonnet-5-5',
        }))

        expect(response).toEqual({
          profileMemoryModel: 'claude-sonnet-5-5',
          profileMemoryGateway: null,
        })
        expect(mocks.getCachedGatewayCatalog).not.toHaveBeenCalled()
        expect(mocks.getCachedCloudflareGatewayCatalog)
          .not.toHaveBeenCalled()
      })

    it.each([
      ['an unknown model', 'not-a-real-model'],
      ['a deep research model', 'o3-deep-research'],
      ['an image generation model', 'gemini-3.1-flash-image'],
    ])('rejects %s as a direct memory model', async (_label, model) => {
      const patchHandler = await patchSettingsHandler()
      const dbMock = setup()

      await expect(patchHandler(patchEvent({
        projectMemoryModel: model,
      }))).rejects.toMatchObject({
        statusCode: 400,
        message: 'Unknown or unusable memory model',
      })
      expect(dbMock.spies.insert).not.toHaveBeenCalled()
      expect(dbMock.spies.update).not.toHaveBeenCalled()
    })

    it.each(['vercel', 'openrouter'] as const)(
      'accepts a %s gateway model present in the catalog',
      async (gateway) => {
        const patchHandler = await patchSettingsHandler()

        setup()
        mocks.getCachedGatewayCatalog.mockResolvedValue([textGatewayModel])

        const response = await patchHandler(patchEvent({
          profileMemoryModel: 'openai/gpt-5',
          profileMemoryGateway: gateway,
        }))

        expect(response).toEqual({
          profileMemoryModel: 'openai/gpt-5',
          profileMemoryGateway: gateway,
        })
        expect(mocks.getCachedGatewayCatalog).toHaveBeenCalledWith(
          gateway,
          expect.objectContaining({ logger: expect.anything() }),
        )
      },
    )

    it('rejects a gateway model missing from the catalog', async () => {
      const patchHandler = await patchSettingsHandler()
      const dbMock = setup()

      mocks.getCachedGatewayCatalog.mockResolvedValue([textGatewayModel])

      await expect(patchHandler(patchEvent({
        profileMemoryModel: 'openai/typo',
        profileMemoryGateway: 'vercel',
      }))).rejects.toMatchObject({ statusCode: 400 })
      expect(dbMock.spies.insert).not.toHaveBeenCalled()
    })

    it('rejects a gateway model that declares no text output', async () => {
      const patchHandler = await patchSettingsHandler()

      setup()
      mocks.getCachedGatewayCatalog.mockResolvedValue([imageOnlyGatewayModel])

      await expect(patchHandler(patchEvent({
        projectMemoryModel: 'black-forest/flux',
        projectMemoryGateway: 'openrouter',
      }))).rejects.toMatchObject({ statusCode: 400 })
    })

    it('answers 503 when the gateway catalog is unavailable', async () => {
      const patchHandler = await patchSettingsHandler()
      const dbMock = setup()

      mocks.getCachedGatewayCatalog.mockRejectedValue(new Error('boom'))

      await expect(patchHandler(patchEvent({
        profileMemoryModel: 'openai/gpt-5',
        profileMemoryGateway: 'vercel',
      }))).rejects.toMatchObject({
        statusCode: 503,
        why: expect.stringContaining('vercel'),
      })
      expect(mocks.loggerSet).toHaveBeenCalled()
      expect(dbMock.spies.insert).not.toHaveBeenCalled()
    })

    it('rejects a cloudflare model without gateway credentials', async () => {
      const patchHandler = await patchSettingsHandler()

      setup()

      await expect(patchHandler(patchEvent({
        profileMemoryModel: 'openai/gpt-5',
        profileMemoryGateway: 'cloudflare',
      }))).rejects.toMatchObject({
        statusCode: 400,
        fix: expect.stringContaining('Cloudflare AI Gateway credentials'),
      })
      expect(mocks.getCloudflareGatewayCredentials)
        .toHaveBeenCalledWith('1')
      expect(mocks.getCachedCloudflareGatewayCatalog)
        .not.toHaveBeenCalled()
    })

    it('validates a cloudflare model against the account catalog',
      async () => {
        const patchHandler = await patchSettingsHandler()
        const credentials = { accountId: 'account', apiKey: 'token' }

        setup()
        mocks.getCloudflareGatewayCredentials.mockResolvedValue(credentials)
        mocks.getCachedCloudflareGatewayCatalog.mockResolvedValue([
          textGatewayModel,
        ])

        const response = await patchHandler(patchEvent({
          profileMemoryModel: 'openai/gpt-5',
          profileMemoryGateway: 'cloudflare',
        }))

        expect(response).toEqual({
          profileMemoryModel: 'openai/gpt-5',
          profileMemoryGateway: 'cloudflare',
        })
        expect(mocks.getCachedCloudflareGatewayCatalog)
          .toHaveBeenCalledWith(
            credentials,
            expect.objectContaining({ logger: expect.anything() }),
          )
      })

    it('rejects a gateway sent without a model', async () => {
      const patchHandler = await patchSettingsHandler()

      setup()

      await expect(patchHandler(patchEvent({
        profileMemoryGateway: 'vercel',
      }))).rejects.toMatchObject({ statusCode: 400 })
      await expect(patchHandler(patchEvent({
        projectMemoryGateway: null,
      }))).rejects.toMatchObject({
        statusCode: 400,
        fix: expect.stringContaining('together with its gateway'),
      })
    })

    it('clears the gateway when a model is sent without one', async () => {
      const patchHandler = await patchSettingsHandler()
      const dbMock = setup()

      dbMock.seed({
        profileMemoryModel: 'openai/gpt-5',
        profileMemoryGateway: 'vercel',
      })

      const response = await patchHandler(patchEvent({
        profileMemoryModel: 'claude-sonnet-5-5',
      }))

      expect(response).toEqual({
        profileMemoryModel: 'claude-sonnet-5-5',
        profileMemoryGateway: null,
      })
      expect(dbMock.spies.updateSet).toHaveBeenCalledWith({
        profileMemoryModel: 'claude-sonnet-5-5',
        profileMemoryGateway: null,
      })
    })

    it('clears both columns when the model is set to null', async () => {
      const patchHandler = await patchSettingsHandler()
      const dbMock = setup()

      dbMock.seed({
        projectMemoryModel: 'openai/gpt-5',
        projectMemoryGateway: 'openrouter',
      })

      const response = await patchHandler(patchEvent({
        projectMemoryModel: null,
      }))

      expect(response).toEqual({
        projectMemoryModel: null,
        projectMemoryGateway: null,
      })
      expect(mocks.getCachedGatewayCatalog).not.toHaveBeenCalled()
    })

    it('keeps profile and project scopes independent', async () => {
      const getHandler = await getSettingsHandler()
      const patchHandler = await patchSettingsHandler()
      const dbMock = setup()

      dbMock.seed({
        profileMemoryModel: 'openai/gpt-5',
        profileMemoryGateway: 'vercel',
      })

      const response = await patchHandler(patchEvent({
        projectMemoryModel: 'claude-sonnet-5-5',
      }))

      expect(response).toEqual({
        projectMemoryModel: 'claude-sonnet-5-5',
        projectMemoryGateway: null,
      })
      expect(await getHandler({} as any)).toMatchObject({
        profileMemoryModel: 'openai/gpt-5',
        profileMemoryGateway: 'vercel',
        projectMemoryModel: 'claude-sonnet-5-5',
        projectMemoryGateway: null,
      })
    })

    it('strips memoryIncludeSensitive and never writes the column',
      async () => {
        const patchHandler = await patchSettingsHandler()
        const dbMock = setup()

        dbMock.seed({ memoryIncludeSensitive: true })

        const response = await patchHandler(patchEvent({
          memoryEnabled: false,
          memoryIncludeSensitive: false,
        }))

        expect(response).toEqual({ memoryEnabled: false })
        expect(dbMock.spies.updateSet).toHaveBeenCalledWith({
          memoryEnabled: false,
        })
        expect(dbMock.getSettings()?.memoryIncludeSensitive).toBe(true)
        expect(dbMock.spies.batch).not.toHaveBeenCalled()
      })

    it('never inserts memoryIncludeSensitive when no row exists yet',
      async () => {
        const patchHandler = await patchSettingsHandler()
        const dbMock = setup()

        const response = await patchHandler(patchEvent({
          memoryEnabled: true,
          memoryIncludeSensitive: true,
        }))

        expect(response).toEqual({ memoryEnabled: true })
        expect(dbMock.spies.insertValues).toHaveBeenCalledWith({
          userId: 1,
          memoryEnabled: true,
        })
        expect(dbMock.getSettings()?.memoryIncludeSensitive).toBeNull()
      })

    it.each([true, false])(
      'answers 400 when memoryIncludeSensitive %s is the only key',
      async (legacyValue) => {
        const patchHandler = await patchSettingsHandler()
        const dbMock = setup()

        await expect(patchHandler(patchEvent({
          memoryIncludeSensitive: legacyValue,
        }))).rejects.toMatchObject({
          statusCode: 400,
          message: 'No fields to update',
        })
        expect(dbMock.spies.insert).not.toHaveBeenCalled()
        expect(dbMock.spies.update).not.toHaveBeenCalled()
        expect(dbMock.spies.batch).not.toHaveBeenCalled()
      },
    )

    describe('memoryExtractionEnabled', () => {
      async function stampWhere(dbMock: ReturnType<typeof setup>) {
        const [whereClause] = dbMock.spies.chatStampWhere.mock.calls[0]! as [
          Parameters<SQLiteDialect['sqlToQuery']>[0],
        ]

        return new SQLiteDialect().sqlToQuery(whereClause)
      }

      it('returns the persisted flag and defaults a missing one to false',
        async () => {
          const getHandler = await getSettingsHandler()
          const dbMock = setup()

          dbMock.seed({ memoryExtractionEnabled: true })

          expect(await getHandler({} as any)).toMatchObject({
            memoryExtractionEnabled: true,
            memoryEnabled: true,
          })

          dbMock.seed({ memoryEnabled: false })

          expect(await getHandler({} as any)).toMatchObject({
            memoryExtractionEnabled: false,
            memoryEnabled: false,
          })
        })

      it('stamps the existing backlog in the same batch when turned on',
        async () => {
          const patchHandler = await patchSettingsHandler()
          const dbMock = setup()

          dbMock.seed({ memoryExtractionEnabled: false })

          const response = await patchHandler(patchEvent({
            memoryExtractionEnabled: true,
          }))

          const [statements] = dbMock.spies.batch.mock.calls[0]!
          const stampValues = dbMock.spies.chatStampSet.mock.calls[0]![0] as {
            memoryExtractedAt: Date
          }
          const { sql, params } = await stampWhere(dbMock)

          expect(response).toEqual({ memoryExtractionEnabled: true })
          expect(statements.map((statement: FakeStatement) => {
            return statement.kind
          })).toEqual(['update', 'chat-stamp'])
          expect(dbMock.getSettings()?.memoryExtractionEnabled).toBe(true)
          expect(stampValues.memoryExtractedAt).toBeInstanceOf(Date)
          expect(sql).toContain('"user_id" = ?')
          expect(sql).toContain('"memory_extracted_at" is null')
          expect(sql).toContain('"memory_extracted_at" < ?')
          expect(params).toHaveLength(2)
          expect(params[0]).toBe(1)
        })

      it('also stamps chats that went dirty while extraction was off',
        async () => {
          const patchHandler = await patchSettingsHandler()
          const dbMock = setup()

          dbMock.seed({ memoryExtractionEnabled: false })
          await patchHandler(patchEvent({ memoryExtractionEnabled: true }))

          const { sql } = await stampWhere(dbMock)

          expect(sql).toMatch(/is null\)+ or /)
          expect(sql).toContain('"memory_extracted_at" < ?')
        })

      it('stamps when memoryEnabled goes false to true with extraction on',
        async () => {
          const patchHandler = await patchSettingsHandler()
          const dbMock = setup()

          dbMock.seed({ memoryEnabled: false, memoryExtractionEnabled: true })

          const response = await patchHandler(patchEvent({
            memoryEnabled: true,
          }))

          const [statements] = dbMock.spies.batch.mock.calls[0]!

          expect(response).toEqual({ memoryEnabled: true })
          expect(statements.map((statement: FakeStatement) => {
            return statement.kind
          })).toEqual(['update', 'chat-stamp'])
        })

      it('stamps once when both flags are switched on together', async () => {
        const patchHandler = await patchSettingsHandler()
        const dbMock = setup()

        dbMock.seed({ memoryEnabled: false, memoryExtractionEnabled: false })
        await patchHandler(patchEvent({
          memoryEnabled: true,
          memoryExtractionEnabled: true,
        }))

        expect(dbMock.spies.chatStampSet).toHaveBeenCalledTimes(1)
      })

      it('does not stamp while memoryEnabled stays off', async () => {
        const patchHandler = await patchSettingsHandler()
        const dbMock = setup()

        dbMock.seed({ memoryEnabled: false, memoryExtractionEnabled: false })
        await patchHandler(patchEvent({ memoryExtractionEnabled: true }))

        expect(dbMock.spies.chatStampSet).not.toHaveBeenCalled()
        expect(dbMock.spies.batch).not.toHaveBeenCalled()
      })

      it('does not stamp when memoryEnabled is switched off', async () => {
        const patchHandler = await patchSettingsHandler()
        const dbMock = setup()

        dbMock.seed({ memoryEnabled: true, memoryExtractionEnabled: true })
        await patchHandler(patchEvent({ memoryEnabled: false }))

        expect(dbMock.spies.chatStampSet).not.toHaveBeenCalled()
      })

      it('does not stamp when an effective state is resent', async () => {
        const patchHandler = await patchSettingsHandler()
        const dbMock = setup()

        dbMock.seed({ memoryEnabled: null, memoryExtractionEnabled: true })
        await patchHandler(patchEvent({ memoryEnabled: true }))
        await patchHandler(patchEvent({
          memoryEnabled: true,
          memoryExtractionEnabled: true,
        }))

        expect(dbMock.spies.chatStampSet).not.toHaveBeenCalled()
      })

      it('stamps the backlog when the settings row does not exist yet',
        async () => {
          const patchHandler = await patchSettingsHandler()
          const dbMock = setup()

          await patchHandler(patchEvent({ memoryExtractionEnabled: true }))

          const [statements] = dbMock.spies.batch.mock.calls[0]!

          expect(statements.map((statement: FakeStatement) => {
            return statement.kind
          })).toEqual(['insert', 'chat-stamp'])
        })

      it('stamps the backlog when the stored flag is null', async () => {
        const patchHandler = await patchSettingsHandler()
        const dbMock = setup()

        dbMock.seed({ memoryExtractionEnabled: null })
        await patchHandler(patchEvent({ memoryExtractionEnabled: true }))

        expect(dbMock.spies.chatStampSet).toHaveBeenCalledTimes(1)
      })

      it('does not restamp when the flag was already on', async () => {
        const patchHandler = await patchSettingsHandler()
        const dbMock = setup()

        dbMock.seed({ memoryExtractionEnabled: true })

        const response = await patchHandler(patchEvent({
          memoryExtractionEnabled: true,
        }))

        expect(response).toEqual({ memoryExtractionEnabled: true })
        expect(dbMock.spies.chatStampSet).not.toHaveBeenCalled()
        expect(dbMock.spies.batch).not.toHaveBeenCalled()
        expect(mocks.callOrder).toEqual(['update'])
      })

      it('does not stamp when turning off or leaving the flag untouched',
        async () => {
          const patchHandler = await patchSettingsHandler()
          const dbMock = setup()

          dbMock.seed({ memoryExtractionEnabled: true })

          await patchHandler(patchEvent({ memoryExtractionEnabled: false }))
          await patchHandler(patchEvent({ memoryEnabled: true }))

          expect(dbMock.spies.chatStampSet).not.toHaveBeenCalled()
          expect(dbMock.getSettings()?.memoryExtractionEnabled).toBe(false)
        })

      it('changes nothing when the backlog batch rejects', async () => {
        const patchHandler = await patchSettingsHandler()
        const dbMock = setup()

        dbMock.seed({ memoryExtractionEnabled: false })
        mocks.batchError = new Error('d1')

        await expect(patchHandler(patchEvent({
          memoryExtractionEnabled: true,
        }))).rejects.toThrow('d1')
        expect(dbMock.getSettings()?.memoryExtractionEnabled).toBe(false)
      })
    })

    describe('model validation failures', () => {
      function seedOtherSettings() {
        const dbMock = setup()

        dbMock.seed({ memoryEnabled: true, aboutMe: null })

        return dbMock
      }

      function expectNothingSaved(dbMock: ReturnType<typeof setup>) {
        expect(dbMock.spies.update).not.toHaveBeenCalled()
        expect(dbMock.spies.insert).not.toHaveBeenCalled()
        expect(dbMock.spies.batch).not.toHaveBeenCalled()
        expect(mocks.callOrder).toEqual([])
        expect(dbMock.getSettings()).toMatchObject({
          aboutMe: null,
          profileMemoryModel: null,
          projectMemoryModel: null,
        })
      }

      it('throws the 503 outage and saves nothing', async () => {
        const patchHandler = await patchSettingsHandler()
        const dbMock = seedOtherSettings()

        mocks.getCachedGatewayCatalog.mockRejectedValue(new Error('boom'))

        await expect(patchHandler(patchEvent({
          memoryIncludeSensitive: false,
          aboutMe: 'Backend engineer',
          profileMemoryModel: 'openai/gpt-5',
          profileMemoryGateway: 'vercel',
        }))).rejects.toMatchObject({
          statusCode: 503,
          message: 'Could not verify the memory model',
        })
        expectNothingSaved(dbMock)
      })

      it('saves neither scope when only one of them fails', async () => {
        const patchHandler = await patchSettingsHandler()
        const dbMock = seedOtherSettings()

        mocks.getCachedGatewayCatalog.mockRejectedValue(new Error('boom'))

        await expect(patchHandler(patchEvent({
          memoryIncludeSensitive: false,
          profileMemoryModel: 'openai/gpt-5',
          profileMemoryGateway: 'vercel',
          projectMemoryModel: 'claude-sonnet-5-5',
          projectMemoryGateway: null,
        }))).rejects.toMatchObject({ statusCode: 503 })
        expectNothingSaved(dbMock)
      })

      it('throws on an exhausted catalog rate limit and saves nothing',
        async () => {
          const patchHandler = await patchSettingsHandler()
          const dbMock = seedOtherSettings()

          mocks.enforceGatewayModelsRateLimit.mockRejectedValue(
            createEvlogError({
              message: 'Too many requests',
              status: 429,
              why: 'Gateway catalog rate limit exceeded',
              fix: 'Wait a moment before retrying',
            }),
          )

          await expect(patchHandler(patchEvent({
            memoryIncludeSensitive: false,
            profileMemoryModel: 'openai/gpt-5',
            profileMemoryGateway: 'vercel',
          }))).rejects.toMatchObject({ statusCode: 429 })
          expect(mocks.getCachedGatewayCatalog).not.toHaveBeenCalled()
          expectNothingSaved(dbMock)
        })

      it('throws a 400 for an unknown model and saves nothing', async () => {
        const patchHandler = await patchSettingsHandler()
        const dbMock = seedOtherSettings()

        await expect(patchHandler(patchEvent({
          memoryIncludeSensitive: false,
          profileMemoryModel: 'not-a-real-model',
        }))).rejects.toMatchObject({ statusCode: 400 })
        expectNothingSaved(dbMock)
      })

      it('throws the first failure when both scopes fail', async () => {
        const patchHandler = await patchSettingsHandler()
        const dbMock = seedOtherSettings()

        await expect(patchHandler(patchEvent({
          profileMemoryModel: 'not-a-real-model',
          projectMemoryModel: 'also-not-real',
        }))).rejects.toMatchObject({
          why: expect.stringContaining('not-a-real-model'),
        })
        expectNothingSaved(dbMock)
      })

      it('returns only the saved fields when every scope validates',
        async () => {
          const patchHandler = await patchSettingsHandler()

          seedOtherSettings()

          const response = await patchHandler(patchEvent({
            memoryIncludeSensitive: false,
            projectMemoryModel: 'claude-sonnet-5-5',
          }))

          expect(response).toEqual({
            projectMemoryModel: 'claude-sonnet-5-5',
            projectMemoryGateway: null,
          })
        })

      it('keeps structural 400s as whole-payload rejects', async () => {
        const patchHandler = await patchSettingsHandler()
        const dbMock = seedOtherSettings()

        await expect(patchHandler(patchEvent({
          memoryEnabled: false,
          profileMemoryGateway: 'vercel',
        }))).rejects.toMatchObject({ statusCode: 400 })
        expect(dbMock.spies.update).not.toHaveBeenCalled()
        expect(dbMock.spies.batch).not.toHaveBeenCalled()
      })
    })

    describe('aboutMe special categories', () => {
      const flaggedText = 'My private diagnosis is stage two'

      it('rejects a flagged aboutMe with 422, the categories, not the text',
        async () => {
          const patchHandler = await patchSettingsHandler()
          const dbMock = setup()

          mocks.classifySensitiveCategories.mockReturnValue([
            'health',
            'religion-or-belief',
          ])

          const exception = await patchHandler(patchEvent({
            aboutMe: flaggedText,
          })).catch((caught: unknown) => {
            return caught
          })

          expect(exception).toMatchObject({
            statusCode: 422,
            message: 'Sensitive topics (health, religion, politics…) are '
              + 'not saved to memory.',
            why: 'Your "About me" text looks like sensitive data '
              + '(health, religion-or-belief).',
            fix: 'Remove the sensitive details from "About me" and save '
              + 'again.',
          })
          expect(JSON.stringify(exception)).not.toContain(flaggedText)
          expect(JSON.stringify(mocks.loggerSet.mock.calls))
            .not.toContain(flaggedText)
          expect(mocks.loggerSet).toHaveBeenCalledWith({
            attributes: {
              memoryCompliance: {
                sensitive: {
                  origin: 'settings-about-me',
                  categories: ['health', 'religion-or-belief'],
                  categoryCount: 2,
                },
              },
            },
          })
          expect(dbMock.spies.insert).not.toHaveBeenCalled()
          expect(dbMock.spies.batch).not.toHaveBeenCalled()
        })

      it('rejects a flagged aboutMe even when the stored column is true',
        async () => {
          const patchHandler = await patchSettingsHandler()
          const dbMock = setup()

          dbMock.seed({ memoryIncludeSensitive: true })
          mocks.classifySensitiveCategories.mockReturnValue(['health'])

          await expect(patchHandler(patchEvent({
            aboutMe: flaggedText,
          }))).rejects.toMatchObject({ statusCode: 422 })
          expect(dbMock.spies.update).not.toHaveBeenCalled()
          expect(dbMock.getSettings()?.aboutMe).toBeNull()
        })

      it.each([true, false])(
        'rejects a flagged aboutMe sent with a legacy flag of %s',
        async (legacyValue) => {
          const patchHandler = await patchSettingsHandler()
          const dbMock = setup()

          mocks.classifySensitiveCategories.mockReturnValue(['drugs'])

          await expect(patchHandler(patchEvent({
            memoryIncludeSensitive: legacyValue,
            aboutMe: flaggedText,
          }))).rejects.toMatchObject({ statusCode: 422 })
          expect(dbMock.spies.insert).not.toHaveBeenCalled()
          expect(dbMock.spies.batch).not.toHaveBeenCalled()
        },
      )

      it('accepts an aboutMe that is not flagged and logs no detection',
        async () => {
          const patchHandler = await patchSettingsHandler()

          setup()

          expect(await patchHandler(patchEvent({
            aboutMe: 'Backend engineer',
          }))).toEqual({ aboutMe: 'Backend engineer' })
          expect(mocks.classifySensitiveCategories)
            .toHaveBeenCalledWith('Backend engineer')
          expect(mocks.loggerSet).not.toHaveBeenCalled()
        })

      it('does not classify a cleared aboutMe', async () => {
        const patchHandler = await patchSettingsHandler()

        setup()
        await patchHandler(patchEvent({ aboutMe: '  ' }))

        expect(mocks.classifySensitiveCategories).not.toHaveBeenCalled()
      })
    })

    describe('aboutMe never-store gate', () => {
      const apiKey = `sk-${'a1B2c3D4'.repeat(4)}`

      it('rejects an aboutMe holding a credential without echoing it',
        async () => {
          const patchHandler = await patchSettingsHandler()
          const dbMock = setup()
          const exception = await patchHandler(patchEvent({
            aboutMe: `Backend dev, my key is ${apiKey}`,
          })).catch((caught: unknown) => {
            return caught
          })

          expect(exception).toMatchObject({
            statusCode: 400,
            message: 'About me contains data that cannot be stored',
            why: expect.stringContaining('api-key'),
            fix: expect.stringContaining('Remove'),
          })
          expect(JSON.stringify(exception)).not.toContain(apiKey)
          expect(JSON.stringify(mocks.loggerSet.mock.calls))
            .not.toContain(apiKey)
          expect(mocks.loggerSet).toHaveBeenCalledWith({
            attributes: {
              memoryCompliance: {
                origin: 'settings-about-me',
                blocked: { 'api-key': 1 },
                blockedTotal: 1,
              },
            },
          })
          expect(dbMock.spies.insert).not.toHaveBeenCalled()
          expect(dbMock.spies.batch).not.toHaveBeenCalled()
        })

      it('blocks the whole request', async () => {
        const patchHandler = await patchSettingsHandler()
        const dbMock = setup()

        await expect(patchHandler(patchEvent({
          memoryEnabled: false,
          aboutMe: `token: ${apiKey}`,
        }))).rejects.toMatchObject({ statusCode: 400 })
        expect(dbMock.spies.insert).not.toHaveBeenCalled()
        expect(dbMock.spies.batch).not.toHaveBeenCalled()
      })

      it('accepts a clean aboutMe and a cleared one', async () => {
        const patchHandler = await patchSettingsHandler()

        setup()

        expect(await patchHandler(patchEvent({
          aboutMe: 'Backend engineer who likes terse answers',
        }))).toEqual({ aboutMe: 'Backend engineer who likes terse answers' })
        expect(await patchHandler(patchEvent({
          aboutMe: null,
        }))).toEqual({ aboutMe: null })
      })
    })

    describe('catalog rate limit', () => {
      it('is consumed once per gateway model choice before validation',
        async () => {
          const patchHandler = await patchSettingsHandler()

          setup()
          mocks.getCachedGatewayCatalog.mockResolvedValue([textGatewayModel])

          const event = patchEvent({
            profileMemoryModel: 'openai/gpt-5',
            profileMemoryGateway: 'vercel',
            projectMemoryModel: 'openai/gpt-5',
            projectMemoryGateway: 'openrouter',
          })

          await patchHandler(event)

          expect(mocks.enforceGatewayModelsRateLimit).toHaveBeenCalledTimes(2)
          expect(mocks.enforceGatewayModelsRateLimit)
            .toHaveBeenCalledWith(event, '1')
        })

      it('propagates a 429 and writes nothing', async () => {
        const patchHandler = await patchSettingsHandler()
        const dbMock = setup()

        mocks.enforceGatewayModelsRateLimit.mockRejectedValue(
          Object.assign(new Error('Too many requests'), { statusCode: 429 }),
        )

        await expect(patchHandler(patchEvent({
          profileMemoryModel: 'openai/gpt-5',
          profileMemoryGateway: 'vercel',
        }))).rejects.toMatchObject({ statusCode: 429 })
        expect(mocks.getCachedGatewayCatalog).not.toHaveBeenCalled()
        expect(dbMock.spies.insert).not.toHaveBeenCalled()
        expect(dbMock.spies.batch).not.toHaveBeenCalled()
      })

      it.each([
        ['a direct model', { profileMemoryModel: 'claude-sonnet-5-5' }],
        ['a cleared model', { projectMemoryModel: null }],
        ['booleans only', { memoryEnabled: true, chatSearchEnabled: false }],
        ['aboutMe only', { aboutMe: 'Hello' }],
      ])('is not consumed for %s', async (_label, body) => {
        const patchHandler = await patchSettingsHandler()

        setup()
        await patchHandler(patchEvent(body))

        expect(mocks.enforceGatewayModelsRateLimit).not.toHaveBeenCalled()
      })
    })

    describe('gateway catalog modalities', () => {
      it('rejects a model with no modalities that supports image generation',
        async () => {
          const patchHandler = await patchSettingsHandler()
          const dbMock = setup()

          mocks.getCachedGatewayCatalog.mockResolvedValue([{
            id: 'image/maker',
            name: 'Maker',
            toolCall: false,
            supportsImageGeneration: true,
          }])

          await expect(patchHandler(patchEvent({
            profileMemoryModel: 'image/maker',
            profileMemoryGateway: 'vercel',
          }))).rejects.toMatchObject({
            statusCode: 400,
            why: expect.stringContaining('text output'),
          })
          expect(dbMock.spies.insert).not.toHaveBeenCalled()
        })

      it('accepts a model with no modalities and no image generation flag',
        async () => {
          const patchHandler = await patchSettingsHandler()

          setup()
          mocks.getCachedGatewayCatalog.mockResolvedValue([{
            id: 'plain/model',
            name: 'Plain',
            toolCall: false,
          }])

          expect(await patchHandler(patchEvent({
            profileMemoryModel: 'plain/model',
            profileMemoryGateway: 'vercel',
          }))).toEqual({
            profileMemoryModel: 'plain/model',
            profileMemoryGateway: 'vercel',
          })
        })

      it('trusts declared text output over the image generation flag',
        async () => {
          const patchHandler = await patchSettingsHandler()

          setup()
          mocks.getCachedGatewayCatalog.mockResolvedValue([{
            ...textGatewayModel,
            supportsImageGeneration: true,
          }])

          expect(await patchHandler(patchEvent({
            profileMemoryModel: 'openai/gpt-5',
            profileMemoryGateway: 'vercel',
          }))).toMatchObject({ profileMemoryModel: 'openai/gpt-5' })
        })
    })
  })
})
