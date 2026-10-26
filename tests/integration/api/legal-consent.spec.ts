import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { CURRENT_CONSENT_VERSION } from '~~/server/utils/legal/consent'
import {
  LEGAL_CONSENT_ERROR_CODE,
  TRANSFER_CONSENT_ERROR_CODE,
} from '#shared/utils/legal-consent'
import { buildFallbackChatTitle } from '~~/server/utils/chats/title'
import {
  createMemoryExtractionTestDb,
  seedMessage,
  seedProject,
  seedUser,
  textPart,
} from '../../setup/helpers/memory-extraction-db'
import { createFakeKnowledgeKv } from '../../setup/helpers/knowledge-api'
import type {
  MemoryExtractionTestDb,
} from '../../setup/helpers/memory-extraction-db'

const mocks = vi.hoisted(() => ({
  loggerSet: vi.fn(),
  assertNotCrossSiteRequest: vi.fn(),
  assertInputFilesSupported: vi.fn(),
  generateChatTitle: vi.fn(async () => 'Generated title'),
}))

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { publicIdMockFactory } = await import(
    '../../setup/helpers/public-id-mock'
  )

  return await publicIdMockFactory()
})

vi.mock('~~/server/utils/logging/request-logger', () => ({
  useRequestLogger: () => ({
    set: mocks.loggerSet,
    getContext: () => ({ requestId: 'request-1' }),
  }),
}))

vi.mock('~~/server/utils/files/file-governance', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('~~/server/utils/files/file-governance')
  >()

  return {
    ...original,
    validateMessageFilePolicy: vi.fn(async () => undefined),
  }
})

vi.mock('~~/server/utils/projects/memory', () => ({
  markProjectsMemoryStale: vi.fn(async () => undefined),
}))

vi.mock('~~/server/utils/landing/analytics-events', () => ({
  trackLandingEvent: vi.fn(),
}))

vi.mock('~~/server/utils/chats/input-file-support', () => ({
  assertInputFilesSupported: mocks.assertInputFilesSupported,
}))

const CHAT_SLUG = '01ARZ3NDEKTSV4RRFFQ69G5FAV'
const PROVIDER_REACHED = 'provider-reached'

type Handler = (event: unknown) => Promise<unknown>

async function loadHandler(path: string): Promise<Handler> {
  const module = await import(`../../../server/api/v1/${path}`)

  return module.default as Handler
}

describe('legal consent gate', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number

  beforeEach(async () => {
    vi.resetModules()
    mocks.loggerSet.mockReset()
    mocks.assertNotCrossSiteRequest.mockReset()
    mocks.assertInputFilesSupported.mockReset()
    mocks.assertInputFilesSupported.mockImplementation(() => {
      throw Object.assign(new Error(PROVIDER_REACHED), { status: 418 })
    })
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, null)

    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('assertNotCrossSiteRequest', mocks.assertNotCrossSiteRequest)
    vi.stubGlobal(
      'readValidatedBody',
      async (event: { body: unknown }, parser: (body: unknown) => unknown) => {
        return parser(event.body)
      },
    )
    vi.stubGlobal('getRouterParams', (event: { params: unknown }) => {
      return event.params
    })
    vi.stubGlobal('useUnauthorizedError', () => {
      throw Object.assign(new Error('Unauthorized'), { status: 401 })
    })
    vi.stubGlobal('useDb', () => testDb.db)
    const kv = createFakeKnowledgeKv()

    vi.stubGlobal('useKV', () => kv)
    vi.stubGlobal('useUserSession', vi.fn(async () => ({
      user: { id: String(userId) },
    })))
    mocks.generateChatTitle.mockReset()
    mocks.generateChatTitle.mockResolvedValue('Generated title')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    testDb.close()
  })

  async function call(path: string, body?: unknown, params?: unknown) {
    const handler = await loadHandler(path)

    return await handler({
      body,
      params,
      headers: {},
      res: { headers: new Headers() },
    })
  }

  async function giveConsent(version = CURRENT_CONSENT_VERSION) {
    return await call('profiles/consent/index.post', {
      version,
      acceptTerms: true,
      confirmAge: true,
      sensitiveContentConsent: true,
    })
  }

  async function createChat() {
    return await call('chats/new/index.put', {
      parts: [{ type: 'text', text: 'Hello' }],
      tools: [],
    })
  }

  async function countChats(): Promise<number> {
    const rows = await testDb.db.select({ id: schema.chats.id })
      .from(schema.chats)
      .where(eq(schema.chats.userId, userId))

    return rows.length
  }

  describe('consent API', () => {
    it('reports a missing consent for an OAuth user with no settings row',
      async () => {
        const state = await call('profiles/consent/index.get')

        expect(state).toMatchObject({
          currentVersion: CURRENT_CONSENT_VERSION,
          status: 'missing',
          termsAcceptedAt: null,
          sensitiveContentConsentAt: null,
        })
      })

    it('requires both boxes', async () => {
      await expect(call('profiles/consent/index.post', {
        version: CURRENT_CONSENT_VERSION,
        acceptTerms: true,
        confirmAge: true,
        sensitiveContentConsent: false,
      })).rejects.toMatchObject({ status: 400 })
      await expect(call('profiles/consent/index.post', {
        version: CURRENT_CONSENT_VERSION,
        sensitiveContentConsent: true,
      })).rejects.toMatchObject({ status: 400 })
    })

    it('refuses a consent given to an older text version', async () => {
      await expect(giveConsent('2026-10-a')).rejects.toMatchObject({
        status: 409,
      })
    })

    it('records the consent with its version and time', async () => {
      const state = await giveConsent()

      expect(state).toMatchObject({
        status: 'current',
        termsVersion: CURRENT_CONSENT_VERSION,
        sensitiveContentConsentVersion: CURRENT_CONSENT_VERSION,
        termsAcceptedAt: expect.any(String),
        ageConfirmedAt: expect.any(String),
      })
      expect(mocks.assertNotCrossSiteRequest).toHaveBeenCalled()
    })

    it('limits consent changes with the shared rate limiter', async () => {
      for (let count = 0; count < 20; count++) {
        await giveConsent()
      }

      await expect(giveConsent()).rejects.toMatchObject({ status: 429 })
    })

    it('marks a refusal with a stable code for the client', async () => {
      await expect(createChat()).rejects.toMatchObject({
        status: 403,
        code: LEGAL_CONSENT_ERROR_CODE,
      })
    })

    it('keeps both transfer consents when they are written together',
      async () => {
        await call('profiles/consent/transfers/index.post', {
          provider: 'qwen',
          transferConsent: true,
        })
        await Promise.all([
          call('profiles/consent/transfers/index.post', {
            provider: 'deepseek',
            transferConsent: true,
          }),
          call('profiles/consent/transfers/withdraw.post', {
            provider: 'qwen',
          }),
        ])

        const state = await call('profiles/consent/index.get') as {
          transfers: { providerId: string, isGranted: boolean }[]
        }
        const granted = state.transfers.filter((transfer) => {
          return transfer.isGranted
        }).map((transfer) => {
          return transfer.providerId
        })

        expect(granted).toEqual(['deepseek'])
      })

    it('rejects a signed-out request', async () => {
      vi.stubGlobal('useUserSession', vi.fn(async () => null))

      await expect(giveConsent()).rejects.toMatchObject({ status: 401 })
    })
  })

  describe('new chat route', () => {
    it('refuses to create a chat without consent and stores nothing',
      async () => {
        await expect(createChat()).rejects.toMatchObject({
          status: 403,
          why: expect.any(String),
          fix: expect.any(String),
        })
        expect(await countChats()).toBe(0)
      })

    it('creates the chat once consent is given', async () => {
      await giveConsent()

      const response = await createChat()

      expect(response).toMatchObject({ slug: expect.any(String) })
      expect(await countChats()).toBe(1)
    })

    it('refuses again after the consent is withdrawn', async () => {
      await giveConsent()
      await call('profiles/consent/withdraw.post')

      await expect(createChat()).rejects.toMatchObject({ status: 403 })
    })

    it('allows sending again after a re-consent', async () => {
      await giveConsent()
      await call('profiles/consent/withdraw.post')
      await testDb.db.update(schema.userSettings)
        .set({
          sensitiveContentConsentWithdrawnAt: new Date('2026-01-01T00:00:00Z'),
        })
        .where(eq(schema.userSettings.userId, userId))
      await giveConsent()

      expect(await createChat()).toMatchObject({ slug: expect.any(String) })
    })

    it('refuses a consent recorded for an older version', async () => {
      await giveConsent()
      await testDb.db.update(schema.userSettings)
        .set({
          sensitiveContentConsentVersion: '2026-10-a',
          termsVersion: '2026-10-a',
        })
        .where(eq(schema.userSettings.userId, userId))

      await expect(createChat()).rejects.toMatchObject({ status: 403 })
    })
  })

  describe('chat send route', () => {
    function stubProvider(providerId: string, modelId: string) {
      vi.stubGlobal('useChatProvider', vi.fn(() => ({
        provider: { id: providerId },
        model: {
          id: modelId,
          name: modelId,
          tools: [],
          modalities: { input: ['text'], output: ['text'] },
        },
      })))
    }

    async function seedOwnChat() {
      await testDb.db.insert(schema.chats).values({
        slug: CHAT_SLUG,
        userId,
        activityAt: new Date(),
      })
    }

    async function send(model: string) {
      return await call('chats/[slug]/index.post', {
        model,
        tools: [],
        messages: [{
          id: 'message-1',
          role: 'user',
          parts: [{ type: 'text', text: 'Hello' }],
        }],
      }, { slug: CHAT_SLUG })
    }

    it('refuses to send without consent before reading the chat', async () => {
      stubProvider('openai', 'gpt-5-mini')
      await seedOwnChat()

      await expect(send('gpt-5-mini')).rejects.toMatchObject({ status: 403 })
      expect(mocks.assertInputFilesSupported).not.toHaveBeenCalled()
    })

    it('lets a consented send reach the provider step', async () => {
      stubProvider('openai', 'gpt-5-mini')
      await seedOwnChat()
      await giveConsent()

      await expect(send('gpt-5-mini')).rejects.toThrow(PROVIDER_REACHED)
    })

    it('refuses again after withdrawal', async () => {
      stubProvider('openai', 'gpt-5-mini')
      await seedOwnChat()
      await giveConsent()
      await call('profiles/consent/withdraw.post')

      await expect(send('gpt-5-mini')).rejects.toMatchObject({ status: 403 })
    })

    it.each([
      ['deepseek', 'deepseek-flash', 'China'],
      ['moonshotai', 'kimi-k3', 'Singapore'],
      ['qwen', 'qwen3.8-flash', 'Singapore'],
    ])(
      'needs a transfer consent before sending to %s',
      async (providerId, modelId, country) => {
        stubProvider(providerId, modelId)
        await seedOwnChat()
        await giveConsent()

        await expect(send(modelId)).rejects.toMatchObject({
          status: 403,
          why: expect.stringContaining(country),
        })
        expect(mocks.assertInputFilesSupported).not.toHaveBeenCalled()

        await call('profiles/consent/transfers/index.post', {
          provider: providerId,
          transferConsent: true,
        })

        await expect(send(modelId)).rejects.toThrow(PROVIDER_REACHED)

        await call('profiles/consent/transfers/withdraw.post', {
          provider: providerId,
        })

        await expect(send(modelId)).rejects.toMatchObject({ status: 403 })
      },
    )

    it.each([
      ['openrouter', 'deepseek/deepseek-chat', 'deepseek'],
      ['vercel', 'moonshotai/kimi-k2', 'moonshotai'],
      ['vercel', 'alibaba/qwen3-max', 'qwen'],
      ['openrouter', 'qwen/qwen3-coder', 'qwen'],
    ])(
      'needs the transfer consent for a %s model %s',
      async (gatewayId, modelId, providerId) => {
        await seedOwnChat()
        await giveConsent()

        await expect(call('chats/[slug]/index.post', {
          model: modelId,
          gateway: gatewayId,
          tools: [],
          messages: [{
            id: 'message-1',
            role: 'user',
            parts: [{ type: 'text', text: 'Hello' }],
          }],
        }, { slug: CHAT_SLUG })).rejects.toMatchObject({
          status: 403,
          code: TRANSFER_CONSENT_ERROR_CODE,
          data: expect.objectContaining({ provider: providerId }),
        })
      },
    )

    it('needs no transfer consent for an EU-adequate route', async () => {
      stubProvider('anthropic', 'claude-haiku-5-5')
      await seedOwnChat()
      await giveConsent()

      await expect(send('claude-haiku-5-5')).rejects.toThrow(PROVIDER_REACHED)
    })
  })

  describe('chat title route', () => {
    const FIRST_MESSAGE = 'Plan a weekend trip to Krakow'

    async function seedUntitledChat() {
      const [chat] = await testDb.db.insert(schema.chats).values({
        slug: CHAT_SLUG,
        userId,
        activityAt: new Date(),
      }).returning({ id: schema.chats.id })

      await seedMessage(testDb.db, chat!.id, 'user', [textPart(FIRST_MESSAGE)])
    }

    function stubTitleProviders(providerId: string, modelId: string) {
      const titleClient = async () => ({
        generateChatTitle: mocks.generateChatTitle,
      })

      vi.stubGlobal('useChatProvider', () => ({
        provider: { id: providerId },
        model: { id: modelId },
      }))
      vi.stubGlobal('useOpenAI', vi.fn(titleClient))
      vi.stubGlobal('useDeepSeek', vi.fn(titleClient))
      vi.stubGlobal('useGateway', vi.fn(titleClient))
    }

    async function generateTitle(body: Record<string, unknown>) {
      return await call('chats/[slug]/title.patch', body, { slug: CHAT_SLUG })
    }

    it('saves a plain title without calling a model when consent is missing',
      async () => {
        stubTitleProviders('openai', 'gpt-5-mini')
        await seedUntitledChat()

        const title = await generateTitle({ model: 'gpt-5-mini' })

        expect(title).toBe(buildFallbackChatTitle(FIRST_MESSAGE))
        expect(mocks.generateChatTitle).not.toHaveBeenCalled()
      })

    it('generates the title once consent is given', async () => {
      stubTitleProviders('openai', 'gpt-5-mini')
      await seedUntitledChat()
      await giveConsent()

      expect(await generateTitle({ model: 'gpt-5-mini' }))
        .toBe('Generated title')
    })

    it('does not send the message to DeepSeek without transfer consent',
      async () => {
        stubTitleProviders('deepseek', 'deepseek-flash')
        await seedUntitledChat()
        await giveConsent()

        const title = await generateTitle({ model: 'deepseek-flash' })

        expect(title).toBe(buildFallbackChatTitle(FIRST_MESSAGE))
        expect(mocks.generateChatTitle).not.toHaveBeenCalled()
      })

    it('does not send it to a gateway DeepSeek model without the consent',
      async () => {
        stubTitleProviders('openai', 'gpt-5-mini')
        await seedUntitledChat()
        await giveConsent()

        const title = await generateTitle({
          model: 'deepseek/deepseek-chat',
          gateway: 'openrouter',
        })

        expect(title).toBe(buildFallbackChatTitle(FIRST_MESSAGE))
        expect(mocks.generateChatTitle).not.toHaveBeenCalled()
      })
  })

  describe('content writes', () => {
    it('refuses a memory entry without consent and saves it after',
      async () => {
        const entry = {
          category: 'preferences',
          title: 'Answer style',
          description: 'Prefers short answers',
          body: 'Prefers short answers with examples.',
        }

        await expect(call('memory/entries/index.post', entry))
          .rejects.toMatchObject({
            status: 403,
            code: LEGAL_CONSENT_ERROR_CODE,
          })

        await giveConsent()

        await expect(call('memory/entries/index.post', entry)).resolves
          .toBeDefined()
      })

    it('refuses project instructions without consent', async () => {
      const projectId = await seedProject(testDb.db, userId)

      await expect(call(
        'projects/[id]/instructions.patch',
        { instructions: 'Answer in Polish.' },
        { id: projectId },
      )).rejects.toMatchObject({ status: 403 })

      const project = await testDb.db.query.projects.findFirst({
        where: { id: projectId },
        columns: { instructions: true },
      })

      expect(project?.instructions ?? null).toBeNull()
    })

    it('refuses to branch a chat without consent', async () => {
      await testDb.db.insert(schema.chats).values({
        slug: CHAT_SLUG,
        userId,
        activityAt: new Date(),
      })

      await expect(call('chats/branch/index.post', { chatSlug: CHAT_SLUG }))
        .rejects.toMatchObject({ status: 403 })
      expect(await countChats()).toBe(1)
    })

    it('refuses a file upload before reading the body', async () => {
      vi.stubGlobal(
        'getRequestHeader',
        (_event: unknown, name: string) => {
          return {
            'content-type': 'text/plain',
            'x-filename': 'notes.txt',
          }[name.toLowerCase()]
        },
      )

      await expect(call('files/upload.put')).rejects.toMatchObject({
        status: 403,
        code: LEGAL_CONSENT_ERROR_CODE,
      })
    })
  })

  describe('memory routes', () => {
    it('refuses an instruct preview without consent', async () => {
      await expect(call('memory/instruct/preview.post', {
        text: 'Forget the coffee thing',
      })).rejects.toMatchObject({ status: 403 })
    })
  })
})
