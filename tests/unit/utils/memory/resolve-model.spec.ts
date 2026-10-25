import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Model } from '#shared/types/providers.d'
import { providers } from '../../../../providers'

const mocks = vi.hoisted(() => ({
  useGateway: vi.fn(),
  getCachedGatewayCatalog: vi.fn(),
  getCachedCloudflareGatewayCatalog: vi.fn(),
  getCloudflareGatewayCredentials: vi.fn(),
  unusableModelIds: new Set<string>(),
}))

vi.mock('~~/server/utils/gateways/catalog', () => {
  return {
    getCachedGatewayCatalog: mocks.getCachedGatewayCatalog,
    getCachedCloudflareGatewayCatalog: mocks.getCachedCloudflareGatewayCatalog,
  }
})

vi.mock('~~/server/utils/gateways/cloudflare', () => {
  return {
    getCloudflareGatewayCredentials: mocks.getCloudflareGatewayCredentials,
  }
})

vi.mock('~~/server/utils/gateways/index', async (importOriginal) => {
  const original
    = await importOriginal<typeof import('~~/server/utils/gateways/index')>()

  return {
    ...original,
    useGateway: mocks.useGateway,
  }
})

vi.mock('~~/server/utils/memory/catalog-usability', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('~~/server/utils/memory/catalog-usability')
  >()

  return {
    ...original,
    isUsableMemoryCatalogModel: (model: Model) => {
      if (mocks.unusableModelIds.has(model.id)) {
        return false
      }

      return original.isUsableMemoryCatalogModel(model)
    },
  }
})

const GATEWAY_MODEL_ID = 'anthropic/claude-haiku-5-5'
const SECRET_MESSAGE_TEXT = 'my secret diary entry'
const CLOUDFLARE_CREDENTIALS = {
  accountId: 'account-1',
  gatewayId: 'gateway-1',
  apiKey: 'token-1',
}

function gatewayCatalogModel(
  id: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id,
    name: id,
    toolCall: true,
    modalities: { input: ['text'], output: ['text'] },
    ...overrides,
  }
}

interface UsageFixture {
  model: string
  provider: string
}

interface MessageFixture {
  usage: UsageFixture | null
}

interface ChatFixture {
  userId: number
  projectId?: string
  messages: MessageFixture[]
}

interface SettingsFixture {
  profileMemoryModel?: string | null
  profileMemoryGateway?: string | null
  projectMemoryModel?: string | null
  projectMemoryGateway?: string | null
}

interface DbOptions {
  keys?: string[]
  settings?: SettingsFixture | null
  chats?: Record<string, ChatFixture>
}

function createDb(options: DbOptions = {}) {
  const chats = options.chats ?? {}
  const keys = options.keys ?? []

  return {
    query: {
      userSettings: {
        findFirst: vi.fn(async () => {
          return options.settings ?? undefined
        }),
      },
      keys: {
        findMany: vi.fn(async () => {
          return keys.map((provider) => {
            return { provider }
          })
        }),
      },
      chats: {
        findFirst: vi.fn(async (query: {
          where: { id: string, userId: number }
        }) => {
          const chat = chats[query.where.id]

          if (!chat || chat.userId !== query.where.userId) {
            return undefined
          }

          return { id: query.where.id }
        }),
        findMany: vi.fn(async (query: {
          where: { userId: number, projectId: string }
          limit: number
        }) => {
          return Object.entries(chats)
            .filter(([, chat]) => {
              return chat.userId === query.where.userId
                && chat.projectId === query.where.projectId
            })
            .slice(0, query.limit)
            .map(([id]) => {
              return { id }
            })
        }),
      },
      messages: {
        findMany: vi.fn(async (query: {
          where: { chatId: string, role: string }
          limit: number
        }) => {
          const chat = chats[query.where.chatId]

          return (chat?.messages ?? []).slice(0, query.limit).map((message) => {
            return {
              usage: message.usage,
              parts: [{ type: 'text', text: SECRET_MESSAGE_TEXT }],
            }
          })
        }),
      },
    },
  }
}

function findCatalogModel(providerId: string, modelId: string): Model {
  const model = providers
    .find((provider) => {
      return provider.id === providerId
    })
    ?.models.find((candidate) => {
      return candidate.id === modelId
    })

  if (!model) {
    throw new Error(`Catalog model ${providerId}/${modelId} not found`)
  }

  return model as Model
}

const openAiMemoryModel = findCatalogModel('openai', 'gpt-6-luna')
const anthropicMemoryModel = findCatalogModel('anthropic', 'claude-haiku-5-5')
const qwenMemoryModel = findCatalogModel('qwen', 'qwen3.8-flash')
const retiredModelId = 'o4-mini'
const deepResearchModelId = 'deep-research-preview-04-2026'
const imageOnlyModelId = 'gpt-image-2'
const deprecatedUnretiredModelId = 'qwen2-5-7b-instruct'

async function loadResolver() {
  return await import('../../../../server/utils/memory/resolve-model')
}

describe('resolveMemoryModel', () => {
  beforeEach(() => {
    mocks.unusableModelIds.clear()
    mocks.getCachedGatewayCatalog.mockReset()
    mocks.getCachedCloudflareGatewayCatalog.mockReset()
    mocks.getCloudflareGatewayCredentials.mockReset()
    mocks.getCachedGatewayCatalog.mockResolvedValue([
      gatewayCatalogModel(GATEWAY_MODEL_ID),
    ])
    mocks.getCachedCloudflareGatewayCatalog.mockResolvedValue([
      gatewayCatalogModel(GATEWAY_MODEL_ID),
    ])
    mocks.getCloudflareGatewayCredentials.mockResolvedValue(
      CLOUDFLARE_CREDENTIALS,
    )
    mocks.useGateway.mockResolvedValue({
      instance: { id: 'gateway-model' },
      reasoning: undefined,
      providerOptions: { openrouter: { transforms: [] } },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('setting step', () => {
    it('wins over the chat model', async () => {
      const db = createDb({
        keys: ['openai', 'anthropic'],
        settings: { profileMemoryModel: anthropicMemoryModel.id },
        chats: {
          chat1: {
            userId: 1,
            messages: [
              { usage: { model: openAiMemoryModel.id, provider: 'openai' } },
            ],
          },
        },
      })
      const { resolveMemoryModel } = await loadResolver()

      const resolved = await resolveMemoryModel({
        userId: 1,
        scope: 'profile',
        sourceChatId: 'chat1',
        db: db as never,
      })

      expect(resolved).toMatchObject({
        scope: 'profile',
        source: 'setting',
        providerId: 'anthropic',
        gatewayId: null,
        modelId: anthropicMemoryModel.id,
        modelName: anthropicMemoryModel.name,
      })
      expect(db.query.chats.findFirst).not.toHaveBeenCalled()
    })

    it('reads the profile columns for the profile scope', async () => {
      const db = createDb({
        keys: ['openai', 'anthropic'],
        settings: {
          profileMemoryModel: openAiMemoryModel.id,
          projectMemoryModel: anthropicMemoryModel.id,
        },
      })
      const { resolveMemoryModel } = await loadResolver()

      const resolved = await resolveMemoryModel({
        userId: 1,
        scope: 'profile',
        db: db as never,
      })

      expect(resolved?.modelId).toBe(openAiMemoryModel.id)
      expect(db.query.userSettings.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 1 } }),
      )
    })

    it('reads the project columns for the project scope', async () => {
      const db = createDb({
        keys: ['openai', 'anthropic'],
        settings: {
          profileMemoryModel: openAiMemoryModel.id,
          projectMemoryModel: anthropicMemoryModel.id,
        },
      })
      const { resolveMemoryModel } = await loadResolver()

      const resolved = await resolveMemoryModel({
        userId: 1,
        scope: 'project',
        db: db as never,
      })

      expect(resolved?.modelId).toBe(anthropicMemoryModel.id)
      expect(resolved?.source).toBe('setting')
    })

    it('falls to the chat model when the provider key is missing', async () => {
      const db = createDb({
        keys: ['openai'],
        settings: { profileMemoryModel: anthropicMemoryModel.id },
        chats: {
          chat1: {
            userId: 1,
            messages: [
              { usage: { model: openAiMemoryModel.id, provider: 'openai' } },
            ],
          },
        },
      })
      const logger = { set: vi.fn() }
      const { resolveMemoryModel } = await loadResolver()

      const resolved = await resolveMemoryModel({
        userId: 1,
        scope: 'profile',
        sourceChatId: 'chat1',
        db: db as never,
        logger,
      })

      expect(resolved).toMatchObject({
        source: 'chat',
        providerId: 'openai',
        modelId: openAiMemoryModel.id,
      })
      expect(logger.set).toHaveBeenCalledWith({
        attributes: {
          memoryModel: expect.objectContaining({
            skipped: ['setting:no-key'],
          }),
        },
      })
    })

    it.each([
      ['an uncataloged model', 'gpt-does-not-exist', 'setting:not-in-catalog'],
      ['a retired model', retiredModelId, 'setting:unusable-model'],
      [
        'a deep-research model',
        deepResearchModelId,
        'setting:unusable-model',
      ],
      ['an image-only model', imageOnlyModelId, 'setting:unusable-model'],
    ])('falls through for %s', async (_label, modelId, reason) => {
      const db = createDb({
        keys: ['openai', 'google'],
        settings: { profileMemoryModel: modelId },
      })
      const logger = { set: vi.fn() }
      const { resolveMemoryModel } = await loadResolver()

      const resolved = await resolveMemoryModel({
        userId: 1,
        scope: 'profile',
        db: db as never,
        logger,
      })

      expect(resolved?.source).toBe('fallback')
      expect(resolved?.modelId).toBe(openAiMemoryModel.id)
      expect(logger.set).toHaveBeenCalledWith({
        attributes: {
          memoryModel: expect.objectContaining({
            skipped: expect.arrayContaining([reason]),
          }),
        },
      })
    })

    it('still allows a deprecated model that is not retired', async () => {
      const db = createDb({
        keys: ['qwen'],
        settings: { profileMemoryModel: deprecatedUnretiredModelId },
      })
      const { resolveMemoryModel } = await loadResolver()

      const resolved = await resolveMemoryModel({
        userId: 1,
        scope: 'profile',
        db: db as never,
      })

      expect(resolved).toMatchObject({
        source: 'setting',
        providerId: 'qwen',
        modelId: deprecatedUnretiredModelId,
      })
    })

    it.each([
      ['vercel', 'vercel-gateway'],
      ['openrouter', 'openrouter'],
      ['cloudflare', 'cloudflare-gateway'],
    ])('resolves a %s gateway setting without a catalog call', async (
      gatewayId,
      keyProviderId,
    ) => {
      const db = createDb({
        keys: [keyProviderId],
        settings: {
          projectMemoryModel: GATEWAY_MODEL_ID,
          projectMemoryGateway: gatewayId,
        },
      })
      const { resolveMemoryModel } = await loadResolver()

      const resolved = await resolveMemoryModel({
        userId: 1,
        scope: 'project',
        db: db as never,
      })

      expect(resolved).toMatchObject({
        scope: 'project',
        source: 'setting',
        providerId: null,
        gatewayId,
        modelId: GATEWAY_MODEL_ID,
        modelName: GATEWAY_MODEL_ID,
      })
      expect(mocks.useGateway).not.toHaveBeenCalled()
    })

    it('falls through when the gateway key is missing', async () => {
      const db = createDb({
        keys: ['openai'],
        settings: {
          profileMemoryModel: GATEWAY_MODEL_ID,
          profileMemoryGateway: 'openrouter',
        },
      })
      const { resolveMemoryModel } = await loadResolver()

      const resolved = await resolveMemoryModel({
        userId: 1,
        scope: 'profile',
        db: db as never,
      })

      expect(resolved).toMatchObject({
        source: 'fallback',
        providerId: 'openai',
        gatewayId: null,
      })
    })

    it('falls through when the settings lookup throws', async () => {
      const db = createDb({ keys: ['openai'] })

      db.query.userSettings.findFirst.mockRejectedValueOnce(new Error('d1'))

      const logger = { set: vi.fn() }
      const { resolveMemoryModel } = await loadResolver()

      const resolved = await resolveMemoryModel({
        userId: 1,
        scope: 'profile',
        db: db as never,
        logger,
      })

      expect(resolved?.source).toBe('fallback')
      expect(logger.set).toHaveBeenCalledWith({
        attributes: {
          memoryModel: expect.objectContaining({
            skipped: expect.arrayContaining(['setting:error']),
            errors: [{ step: 'setting', error: 'Error' }],
          }),
        },
      })
    })
  })

  describe('chat step', () => {
    it('uses the latest assistant message that has usage', async () => {
      const db = createDb({
        keys: ['openai', 'anthropic'],
        chats: {
          chat1: {
            userId: 1,
            messages: [
              { usage: null },
              { usage: { model: '', provider: 'openai' } },
              {
                usage: {
                  model: anthropicMemoryModel.id,
                  provider: 'anthropic',
                },
              },
              { usage: { model: openAiMemoryModel.id, provider: 'openai' } },
            ],
          },
        },
      })
      const { resolveMemoryModel } = await loadResolver()

      const resolved = await resolveMemoryModel({
        userId: 1,
        scope: 'profile',
        sourceChatId: 'chat1',
        db: db as never,
      })

      expect(resolved).toMatchObject({
        source: 'chat',
        providerId: 'anthropic',
        modelId: anthropicMemoryModel.id,
        modelName: anthropicMemoryModel.name,
      })
      expect(db.query.messages.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { chatId: 'chat1', role: 'assistant' },
          orderBy: { createdAt: 'desc' },
        }),
      )
    })

    it.each([
      ['vercel', 'vercel-gateway'],
      ['openrouter', 'openrouter'],
      ['cloudflare', 'cloudflare-gateway'],
    ])('maps a %s gateway send to a gateway selection', async (
      gatewayId,
      keyProviderId,
    ) => {
      const db = createDb({
        keys: [keyProviderId],
        chats: {
          chat1: {
            userId: 1,
            messages: [
              { usage: { model: GATEWAY_MODEL_ID, provider: keyProviderId } },
            ],
          },
        },
      })
      const { resolveMemoryModel } = await loadResolver()

      const resolved = await resolveMemoryModel({
        userId: 1,
        scope: 'profile',
        sourceChatId: 'chat1',
        db: db as never,
      })

      expect(resolved).toMatchObject({
        source: 'chat',
        providerId: null,
        gatewayId,
        modelId: GATEWAY_MODEL_ID,
        modelName: GATEWAY_MODEL_ID,
      })
    })

    describe('gateway catalog check', () => {
      function createGatewayChatDb(keyProviderId: string) {
        return createDb({
          keys: [keyProviderId, 'openai'],
          chats: {
            chat1: {
              userId: 1,
              messages: [
                {
                  usage: { model: GATEWAY_MODEL_ID, provider: keyProviderId },
                },
              ],
            },
          },
        })
      }

      async function resolveGatewayChat(
        keyProviderId: string,
        logger = { set: vi.fn() },
      ) {
        const { resolveMemoryModel } = await loadResolver()
        const resolved = await resolveMemoryModel({
          userId: 1,
          scope: 'profile',
          sourceChatId: 'chat1',
          db: createGatewayChatDb(keyProviderId) as never,
          logger,
        })

        return { resolved, logger }
      }

      function expectSkipped(
        logger: { set: ReturnType<typeof vi.fn> },
        reason: string,
      ) {
        expect(logger.set).toHaveBeenCalledWith({
          attributes: {
            memoryModel: expect.objectContaining({
              skipped: expect.arrayContaining([reason]),
            }),
          },
        })
      }

      it.each([
        ['vercel', 'vercel-gateway'],
        ['openrouter', 'openrouter'],
      ])('accepts a %s model present in the catalog', async (
        gatewayId,
        keyProviderId,
      ) => {
        const { resolved } = await resolveGatewayChat(keyProviderId)

        expect(resolved).toMatchObject({ source: 'chat', gatewayId })
        expect(mocks.getCachedGatewayCatalog)
          .toHaveBeenCalledWith(gatewayId, expect.anything())
        expect(mocks.getCachedCloudflareGatewayCatalog).not.toHaveBeenCalled()
      })

      it('checks the cloudflare catalog with the user credentials', async () => {
        const { resolved } = await resolveGatewayChat('cloudflare-gateway')

        expect(resolved).toMatchObject({
          source: 'chat',
          gatewayId: 'cloudflare',
        })
        expect(mocks.getCloudflareGatewayCredentials).toHaveBeenCalledWith('1')
        expect(mocks.getCachedCloudflareGatewayCatalog).toHaveBeenCalledWith(
          CLOUDFLARE_CREDENTIALS,
          expect.anything(),
        )
        expect(mocks.getCachedGatewayCatalog).not.toHaveBeenCalled()
      })

      it('falls to the fallback when the model is not in the catalog', async () => {
        mocks.getCachedGatewayCatalog.mockResolvedValue([
          gatewayCatalogModel('some/other-model'),
        ])

        const { resolved, logger } = await resolveGatewayChat('openrouter')

        expect(resolved).toMatchObject({
          source: 'fallback',
          providerId: 'openai',
        })
        expectSkipped(logger, 'chat:not-in-catalog')
      })

      it('falls to the fallback when the model is not a text model', async () => {
        mocks.getCachedGatewayCatalog.mockResolvedValue([
          gatewayCatalogModel(GATEWAY_MODEL_ID, {
            modalities: { input: ['text'], output: ['image'] },
          }),
        ])

        const { resolved, logger } = await resolveGatewayChat('openrouter')

        expect(resolved?.source).toBe('fallback')
        expectSkipped(logger, 'chat:unusable-model')
      })

      it('treats an image-generation model without modalities as unusable', async () => {
        mocks.getCachedGatewayCatalog.mockResolvedValue([
          gatewayCatalogModel(GATEWAY_MODEL_ID, {
            modalities: undefined,
            supportsImageGeneration: true,
          }),
        ])

        const { resolved, logger } = await resolveGatewayChat('openrouter')

        expect(resolved?.source).toBe('fallback')
        expectSkipped(logger, 'chat:unusable-model')
      })

      it('falls to the fallback and records the error on a catalog outage', async () => {
        mocks.getCachedGatewayCatalog.mockRejectedValue(new Error('catalog down'))

        const { resolved, logger } = await resolveGatewayChat('openrouter')

        expect(resolved?.source).toBe('fallback')
        expect(logger.set).toHaveBeenCalledWith({
          attributes: {
            memoryModel: expect.objectContaining({
              skipped: expect.arrayContaining(['chat:catalog-unavailable']),
              errors: [{ step: 'chat', error: 'Error' }],
            }),
          },
        })
      })

      it('falls to the fallback on a cloudflare catalog outage', async () => {
        mocks.getCachedCloudflareGatewayCatalog
          .mockRejectedValue(new Error('cf down'))

        const { resolved, logger } = await resolveGatewayChat(
          'cloudflare-gateway',
        )

        expect(resolved?.source).toBe('fallback')
        expectSkipped(logger, 'chat:catalog-unavailable')
      })

      it('falls to the fallback when cloudflare credentials are absent', async () => {
        mocks.getCloudflareGatewayCredentials.mockResolvedValue(undefined)

        const { resolved, logger } = await resolveGatewayChat(
          'cloudflare-gateway',
        )

        expect(resolved?.source).toBe('fallback')
        expectSkipped(logger, 'chat:no-key')
        expect(mocks.getCachedCloudflareGatewayCatalog).not.toHaveBeenCalled()
      })

      it('does not read the catalog when the gateway key is missing', async () => {
        const db = createDb({
          keys: ['openai'],
          chats: {
            chat1: {
              userId: 1,
              messages: [
                { usage: { model: GATEWAY_MODEL_ID, provider: 'openrouter' } },
              ],
            },
          },
        })
        const logger = { set: vi.fn() }
        const { resolveMemoryModel } = await loadResolver()
        const resolved = await resolveMemoryModel({
          userId: 1,
          scope: 'profile',
          sourceChatId: 'chat1',
          db: db as never,
          logger,
        })

        expect(resolved?.source).toBe('fallback')
        expectSkipped(logger, 'chat:no-key')
        expect(mocks.getCachedGatewayCatalog).not.toHaveBeenCalled()
      })

      it('returns null when nothing else resolves after a catalog miss', async () => {
        mocks.getCachedGatewayCatalog.mockResolvedValue([])

        const db = createDb({
          keys: ['openrouter'],
          chats: {
            chat1: {
              userId: 1,
              messages: [
                { usage: { model: GATEWAY_MODEL_ID, provider: 'openrouter' } },
              ],
            },
          },
        })
        const { resolveMemoryModel } = await loadResolver()

        expect(await resolveMemoryModel({
          userId: 1,
          scope: 'profile',
          sourceChatId: 'chat1',
          db: db as never,
        })).toBeNull()
      })
    })

    it('yields nothing for another user\'s chat id', async () => {
      const db = createDb({
        keys: ['openai'],
        chats: {
          chat1: {
            userId: 2,
            messages: [
              {
                usage: {
                  model: anthropicMemoryModel.id,
                  provider: 'anthropic',
                },
              },
            ],
          },
        },
      })
      const { resolveMemoryModel } = await loadResolver()

      const resolved = await resolveMemoryModel({
        userId: 1,
        scope: 'profile',
        sourceChatId: 'chat1',
        db: db as never,
      })

      expect(db.query.chats.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'chat1', userId: 1 } }),
      )
      expect(db.query.messages.findMany).not.toHaveBeenCalled()
      expect(resolved?.source).toBe('fallback')
      expect(resolved?.modelId).toBe(openAiMemoryModel.id)
    })

    it('derives the chat from the project when no source chat is given', async () => {
      const db = createDb({
        keys: ['openai', 'qwen'],
        chats: {
          emptyChat: {
            userId: 1,
            projectId: 'project1',
            messages: [{ usage: null }],
          },
          usedChat: {
            userId: 1,
            projectId: 'project1',
            messages: [
              { usage: { model: qwenMemoryModel.id, provider: 'qwen' } },
            ],
          },
          otherProjectChat: {
            userId: 1,
            projectId: 'project2',
            messages: [
              { usage: { model: openAiMemoryModel.id, provider: 'openai' } },
            ],
          },
        },
      })
      const { resolveMemoryModel } = await loadResolver()

      const resolved = await resolveMemoryModel({
        userId: 1,
        scope: 'project',
        projectId: 'project1',
        db: db as never,
      })

      expect(resolved).toMatchObject({
        source: 'chat',
        providerId: 'qwen',
        modelId: qwenMemoryModel.id,
      })
      expect(db.query.chats.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 1, projectId: 'project1' },
          orderBy: { activityAt: 'desc' },
          limit: 5,
        }),
      )
    })

    it('skips the chat step for profile scope without a source chat', async () => {
      const db = createDb({
        keys: ['openai'],
        chats: {
          usedChat: {
            userId: 1,
            projectId: 'project1',
            messages: [
              {
                usage: {
                  model: anthropicMemoryModel.id,
                  provider: 'anthropic',
                },
              },
            ],
          },
        },
      })
      const { resolveMemoryModel } = await loadResolver()

      const resolved = await resolveMemoryModel({
        userId: 1,
        scope: 'profile',
        projectId: 'project1',
        db: db as never,
      })

      expect(resolved?.source).toBe('fallback')
      expect(db.query.chats.findFirst).not.toHaveBeenCalled()
      expect(db.query.chats.findMany).not.toHaveBeenCalled()
    })

    it('falls to the fallback when the chat model key was deleted', async () => {
      const db = createDb({
        keys: ['openai'],
        chats: {
          chat1: {
            userId: 1,
            messages: [
              {
                usage: {
                  model: anthropicMemoryModel.id,
                  provider: 'anthropic',
                },
              },
            ],
          },
        },
      })
      const { resolveMemoryModel } = await loadResolver()

      const resolved = await resolveMemoryModel({
        userId: 1,
        scope: 'profile',
        sourceChatId: 'chat1',
        db: db as never,
      })

      expect(resolved).toMatchObject({
        source: 'fallback',
        providerId: 'openai',
      })
    })

    it('falls through when the chat model is no longer cataloged', async () => {
      const db = createDb({
        keys: ['openai'],
        chats: {
          chat1: {
            userId: 1,
            messages: [
              { usage: { model: 'gpt-retired-from-catalog', provider: 'openai' } },
            ],
          },
        },
      })
      const logger = { set: vi.fn() }
      const { resolveMemoryModel } = await loadResolver()

      const resolved = await resolveMemoryModel({
        userId: 1,
        scope: 'profile',
        sourceChatId: 'chat1',
        db: db as never,
        logger,
      })

      expect(resolved?.source).toBe('fallback')
      expect(logger.set).toHaveBeenCalledWith({
        attributes: {
          memoryModel: expect.objectContaining({
            skipped: expect.arrayContaining(['chat:not-in-catalog']),
          }),
        },
      })
    })

    it('records the error when the chat step throws and falls through', async () => {
      const db = createDb({
        keys: ['openai'],
        chats: {
          chat1: {
            userId: 1,
            messages: [
              { usage: { model: openAiMemoryModel.id, provider: 'openai' } },
            ],
          },
        },
      })

      db.query.messages.findMany.mockRejectedValueOnce(new Error('d1 chat'))

      const logger = { set: vi.fn() }
      const { resolveMemoryModel } = await loadResolver()

      const resolved = await resolveMemoryModel({
        userId: 1,
        scope: 'profile',
        sourceChatId: 'chat1',
        db: db as never,
        logger,
      })

      expect(resolved?.source).toBe('fallback')
      expect(logger.set).toHaveBeenCalledWith({
        attributes: {
          memoryModel: expect.objectContaining({
            skipped: expect.arrayContaining(['chat:error']),
            errors: [{ step: 'chat', error: 'Error' }],
          }),
        },
      })
    })

    it('rejects a direct send whose provider does not own the model', async () => {
      const db = createDb({
        keys: ['openai', 'anthropic'],
        chats: {
          chat1: {
            userId: 1,
            messages: [
              { usage: { model: openAiMemoryModel.id, provider: 'anthropic' } },
            ],
          },
        },
      })
      const { resolveMemoryModel } = await loadResolver()

      const resolved = await resolveMemoryModel({
        userId: 1,
        scope: 'profile',
        sourceChatId: 'chat1',
        db: db as never,
      })

      expect(resolved?.source).toBe('fallback')
    })
  })

  describe('fallback step', () => {
    it('picks the cheapest provider the user has a key for', async () => {
      const db = createDb({ keys: ['xai', 'google', 'anthropic', 'deepseek'] })
      const { resolveMemoryModel, MEMORY_MODEL_PROVIDER_ORDER }
        = await loadResolver()

      const resolved = await resolveMemoryModel({
        userId: 1,
        scope: 'project',
        db: db as never,
      })

      expect(MEMORY_MODEL_PROVIDER_ORDER).toEqual([
        'openai',
        'anthropic',
        'qwen',
        'deepseek',
        'google',
        'moonshotai',
        'xai',
      ])
      expect(resolved).toMatchObject({
        scope: 'project',
        source: 'fallback',
        providerId: 'anthropic',
        gatewayId: null,
        modelId: anthropicMemoryModel.id,
        modelName: anthropicMemoryModel.name,
      })
    })

    it('skips a fallback model that is no longer usable', async () => {
      mocks.unusableModelIds.add(openAiMemoryModel.id)

      const db = createDb({ keys: ['openai', 'anthropic'] })
      const { resolveMemoryModel } = await loadResolver()

      const resolved = await resolveMemoryModel({
        userId: 1,
        scope: 'project',
        db: db as never,
      })

      expect(resolved).toMatchObject({
        source: 'fallback',
        providerId: 'anthropic',
        modelId: anthropicMemoryModel.id,
      })
    })

    it('returns null when the only fallback model is unusable', async () => {
      mocks.unusableModelIds.add(openAiMemoryModel.id)

      const db = createDb({ keys: ['openai'] })
      const logger = { set: vi.fn() }
      const { resolveMemoryModel } = await loadResolver()

      const resolved = await resolveMemoryModel({
        userId: 1,
        scope: 'project',
        db: db as never,
        logger,
      })

      expect(resolved).toBeNull()
      expect(logger.set).toHaveBeenCalledWith({
        attributes: {
          memoryModel: expect.objectContaining({
            skipped: expect.arrayContaining(['fallback:no-key']),
          }),
        },
      })
    })

    it('propagates a failing keys lookup instead of reporting no key', async () => {
      const db = createDb({ keys: ['openai'] })

      db.query.keys.findMany.mockRejectedValueOnce(new Error('keys d1'))

      const { resolveMemoryModel } = await loadResolver()

      await expect(resolveMemoryModel({
        userId: 1,
        scope: 'project',
        db: db as never,
      })).rejects.toThrow('keys d1')
      expect(db.query.userSettings.findFirst).not.toHaveBeenCalled()
    })

    it('returns null when the user has no keys', async () => {
      const db = createDb({ keys: [] })
      const logger = { set: vi.fn() }
      const { resolveMemoryModel } = await loadResolver()

      const resolved = await resolveMemoryModel({
        userId: 1,
        scope: 'profile',
        db: db as never,
        logger,
      })

      expect(resolved).toBeNull()
      expect(logger.set).toHaveBeenCalledWith({
        attributes: {
          memoryModel: expect.objectContaining({
            source: null,
            modelId: null,
          }),
        },
      })
    })

    it('ignores gateway and search keys when picking a fallback', async () => {
      const db = createDb({ keys: ['openrouter', 'brave'] })
      const { resolveMemoryModel } = await loadResolver()

      const resolved = await resolveMemoryModel({
        userId: 1,
        scope: 'profile',
        db: db as never,
      })

      expect(resolved).toBeNull()
    })

    it('queries the saved keys once per resolution', async () => {
      const db = createDb({
        keys: ['openai'],
        settings: { profileMemoryModel: 'gpt-does-not-exist' },
      })
      const { resolveMemoryModel } = await loadResolver()

      await resolveMemoryModel({
        userId: 1,
        scope: 'profile',
        sourceChatId: 'missing',
        db: db as never,
      })

      expect(db.query.keys.findMany).toHaveBeenCalledTimes(1)
    })
  })

  describe('logging', () => {
    it('records ids and skip reasons but never message text', async () => {
      const db = createDb({
        keys: ['openai'],
        settings: { profileMemoryModel: anthropicMemoryModel.id },
        chats: {
          chat1: {
            userId: 1,
            messages: [
              { usage: { model: openAiMemoryModel.id, provider: 'openai' } },
            ],
          },
        },
      })
      const logger = { set: vi.fn() }
      const { resolveMemoryModel } = await loadResolver()

      await resolveMemoryModel({
        userId: 1,
        scope: 'profile',
        sourceChatId: 'chat1',
        db: db as never,
        logger,
      })

      expect(logger.set).toHaveBeenCalledTimes(1)
      expect(logger.set).toHaveBeenCalledWith({
        attributes: {
          memoryModel: {
            scope: 'profile',
            source: 'chat',
            gatewayId: null,
            providerId: 'openai',
            modelId: openAiMemoryModel.id,
            skipped: ['setting:no-key'],
            errors: [],
          },
        },
      })
      expect(JSON.stringify(logger.set.mock.calls))
        .not.toContain(SECRET_MESSAGE_TEXT)
    })
  })

  describe('instantiate', () => {
    it('does not build the model during resolution', async () => {
      const useOpenAI = vi.fn()

      vi.stubGlobal('useOpenAI', useOpenAI)

      const db = createDb({ keys: ['openai'] })
      const { resolveMemoryModel } = await loadResolver()

      await resolveMemoryModel({
        userId: 1,
        scope: 'profile',
        db: db as never,
      })

      expect(useOpenAI).not.toHaveBeenCalled()
      expect(mocks.useGateway).not.toHaveBeenCalled()
    })

    it('builds an OpenAI model with low reasoning and wrapped options', async () => {
      const useOpenAI = vi.fn(async () => ({
        instance: { id: 'openai-model' },
        reasoning: 'low',
        providerOptions: { store: false },
      }))

      vi.stubGlobal('useOpenAI', useOpenAI)

      const db = createDb({ keys: ['openai'] })
      const { resolveMemoryModel } = await loadResolver()
      const resolved = await resolveMemoryModel({
        userId: 7,
        scope: 'profile',
        db: db as never,
      })
      const instance = await resolved!.instantiate()

      expect(useOpenAI).toHaveBeenCalledWith(
        '7',
        openAiMemoryModel.id,
        [],
        'low',
      )
      expect(instance).toEqual({
        model: { id: 'openai-model' },
        reasoning: 'low',
        providerOptions: { openai: { store: false } },
      })
    })

    it.each([
      ['google', 'useGoogle'],
      ['anthropic', 'useAnthropic'],
      ['xai', 'useXai'],
      ['deepseek', 'useDeepSeek'],
      ['moonshotai', 'useMoonshotAi'],
      ['qwen', 'useQwen'],
    ])('builds a %s model with reasoning off', async (
      providerId,
      factoryName,
    ) => {
      const factory = vi.fn(async () => ({
        instance: { id: `${providerId}-model` },
        reasoning: undefined,
        providerOptions: { flag: providerId },
      }))

      vi.stubGlobal(factoryName, factory)

      const { instantiateMemoryModel } = await loadResolver()
      const instance = await instantiateMemoryModel({
        scope: 'project',
        source: 'fallback',
        providerId: providerId as never,
        gatewayId: null,
        modelId: 'some-model',
        modelName: 'Some Model',
      }, 9)

      expect(factory).toHaveBeenCalledWith('9', 'some-model', [], 'off')
      expect(instance).toEqual({
        model: { id: `${providerId}-model` },
        reasoning: undefined,
        providerOptions: { [providerId]: { flag: providerId } },
      })
    })

    it.each([
      ['vercel', 'vercel-gateway'],
      ['openrouter', 'openrouter'],
      ['cloudflare', 'cloudflare-gateway'],
    ])('builds a %s gateway model without re-wrapping options', async (
      gatewayId,
      keyProviderId,
    ) => {
      const gatewayProviderOptions = { [gatewayId]: { order: ['a'] } }

      mocks.useGateway.mockResolvedValue({
        instance: { id: 'gateway-model' },
        reasoning: 'medium',
        providerOptions: gatewayProviderOptions,
      })

      const db = createDb({
        keys: [keyProviderId],
        settings: {
          profileMemoryModel: GATEWAY_MODEL_ID,
          profileMemoryGateway: gatewayId,
        },
      })
      const logger = { set: vi.fn() }
      const { resolveMemoryModel } = await loadResolver()
      const resolved = await resolveMemoryModel({
        userId: 3,
        scope: 'profile',
        db: db as never,
        logger,
      })
      const instance = await resolved!.instantiate()

      expect(mocks.useGateway).toHaveBeenCalledWith(
        gatewayId,
        '3',
        GATEWAY_MODEL_ID,
        [],
        'off',
        logger,
      )
      expect(instance).toEqual({
        model: { id: 'gateway-model' },
        reasoning: 'medium',
        providerOptions: gatewayProviderOptions,
      })
    })

    it('throws for an unsupported provider', async () => {
      const { instantiateMemoryModel } = await loadResolver()

      await expect(instantiateMemoryModel({
        scope: 'profile',
        source: 'setting',
        providerId: 'mystery' as never,
        gatewayId: null,
        modelId: 'm',
        modelName: 'm',
      }, 1)).rejects.toThrow('Unsupported memory provider')
    })
  })
})
