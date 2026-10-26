import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { CURRENT_CONSENT_VERSION } from '~~/server/utils/legal/consent'
import {
  createMemoryExtractionTestDb,
  seedUser,
} from '../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../setup/helpers/memory-extraction-db'

const mocks = vi.hoisted(() => ({
  loggerSet: vi.fn(),
  assertNotCrossSiteRequest: vi.fn(),
  assertInputFilesSupported: vi.fn(),
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
    vi.stubGlobal('useUserSession', vi.fn(async () => ({
      user: { id: String(userId) },
    })))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    testDb.close()
  })

  async function call(path: string, body?: unknown, params?: unknown) {
    const handler = await loadHandler(path)

    return await handler({ body, params })
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

    it('needs no transfer consent for an EU-adequate route', async () => {
      stubProvider('anthropic', 'claude-haiku-5-5')
      await seedOwnChat()
      await giveConsent()

      await expect(send('claude-haiku-5-5')).rejects.toThrow(PROVIDER_REACHED)
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
