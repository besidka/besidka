import { APICallError } from 'ai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as schema from '~~/server/db/schema'
import type { MemoryExtractionOp } from '~~/server/utils/memory/extract-schema'
import type { MemoryInstructModelOp } from '~~/server/utils/memory/instruct-prompt'
import { createChatSearchBudget } from '~~/server/utils/memory/tools/chat-search-budget'
import {
  createMemoryExtractionTestDb,
  seedEntry,
  seedKey,
  seedUser,
} from '../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../setup/helpers/memory-extraction-db'

const mocks = vi.hoisted(() => ({
  decide: vi.fn(),
  generateText: vi.fn(),
  getModel: vi.fn(),
  getCachedGatewayCatalog: vi.fn(),
  resolveMemoryModel: vi.fn(),
  acquireMemoryLease: vi.fn(),
  loggerSet: vi.fn(),
  assertNotCrossSiteRequest: vi.fn(),
}))

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()

  return {
    ...actual,
    generateText: (...args: unknown[]) => mocks.generateText(...args),
    experimental_decide: (...args: unknown[]) => mocks.decide(...args),
  }
})

vi.mock('#shared/utils/model', async (importOriginal) => {
  const original = await importOriginal<typeof import('#shared/utils/model')>()

  return { ...original, getModel: mocks.getModel }
})

vi.mock('~~/server/utils/gateways/catalog', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('~~/server/utils/gateways/catalog')
  >()

  return {
    ...original,
    getCachedGatewayCatalog: mocks.getCachedGatewayCatalog,
  }
})

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { publicIdMockFactory } = await import(
    '../../setup/helpers/public-id-mock'
  )

  return await publicIdMockFactory()
})

vi.mock('~~/server/utils/encryption', () => ({
  useDecryptText: async (value: string) => `decrypted-${value}`,
}))

vi.mock('~~/server/utils/logging/request-logger', () => ({
  useRequestLogger: () => ({ set: mocks.loggerSet }),
}))

vi.mock('~~/server/utils/memory/resolve-model', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('~~/server/utils/memory/resolve-model')
  >()

  return { ...original, resolveMemoryModel: mocks.resolveMemoryModel }
})

vi.mock('~~/server/utils/projects/memory-lease', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('~~/server/utils/projects/memory-lease')
  >()

  return { ...original, acquireMemoryLease: mocks.acquireMemoryLease }
})

const CARD_NUMBER = '4111 1111 1111 1111'
const PASTED_TEXT = [
  'Career',
  '- Works as a backend engineer at Acme Corp since March 2019.',
  '- Writes Rust and TypeScript, deploys on Cloudflare Workers.',
].join('\n')
const INSTRUCTION = 'Remember that I am planning a trip to Lisbon in May.'
const TOOL_MESSAGE = 'Please remember that I cook pasta twice a week.'

type QuestionMap = Record<string, unknown>

interface DecideCall {
  questions: QuestionMap
}

function createSelection() {
  return {
    scope: 'profile',
    source: 'setting',
    providerId: 'openai',
    gatewayId: null,
    modelId: 'gpt-test',
    modelName: 'GPT Test',
    instantiate: vi.fn(async () => {
      return {
        model: { id: 'mock-model' },
        reasoning: undefined,
        providerOptions: {},
      }
    }),
  }
}

function createKvStub() {
  const store = new Map<string, string>()

  return {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => {
      store.set(key, value)
    }),
    delete: vi.fn(async (key: string) => {
      store.delete(key)
    }),
  }
}

function extractionOp(
  overrides: Partial<MemoryExtractionOp> = {},
): MemoryExtractionOp {
  return {
    op: 'create',
    category: 'topics',
    slug: null,
    title: 'Career',
    description: 'Backend engineer at Acme Corp',
    body: '- Backend engineer at Acme Corp since March 2019',
    neverStore: null,
    evidence: 'Works as a backend engineer at Acme Corp since March 2019.',
    ...overrides,
  }
}

function instructOp(
  overrides: Partial<MemoryInstructModelOp> = {},
): MemoryInstructModelOp {
  return {
    op: 'create',
    ref: null,
    category: 'topics',
    title: 'Travel',
    description: 'Trips the user plans',
    body: '- Plans a trip to Lisbon in May',
    reason: null,
    evidence: null,
    ...overrides,
  }
}

function mockGeneratedOps(ops: unknown[]) {
  mocks.generateText.mockResolvedValue({
    output: { ops },
    usage: { inputTokens: 10, outputTokens: 5 },
  })
}

function answerJev(probabilities: Record<string, number> = {}) {
  mocks.decide.mockImplementation(async ({ questions }: DecideCall) => {
    return {
      answers: Object.fromEntries(Object.keys(questions).map((id) => {
        const question = id.split('__')[1]!
        const fallback = question === 'grounded' ? 0.95 : 0.02

        return [id, {
          type: 'boolean',
          probability: probabilities[question] ?? fallback,
        }]
      })),
    }
  })
}

function sentToJev(): string {
  return JSON.stringify(mocks.decide.mock.calls)
}

function createEvent(body: unknown, params?: Record<string, string>) {
  return {
    body,
    context: params ? { params } : {},
    headers: {},
    res: { headers: new Headers() },
  }
}

describe('TypeSafe AI Jev on memory write paths', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number

  beforeEach(async () => {
    vi.resetModules()
    mocks.decide.mockReset()
    mocks.generateText.mockReset()
    mocks.loggerSet.mockReset()
    mocks.assertNotCrossSiteRequest.mockReset()
    mocks.getModel.mockReturnValue({
      modelName: 'Select Model',
      model: null,
      provider: null,
    })
    mocks.getCachedGatewayCatalog.mockResolvedValue([])
    mocks.acquireMemoryLease.mockResolvedValue({
      release: vi.fn(async () => undefined),
    })
    mocks.resolveMemoryModel.mockReset()
    mocks.resolveMemoryModel.mockImplementation(async () => createSelection())
    answerJev()

    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, { memoryEnabled: true })

    const kv = createKvStub()

    vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
    vi.stubGlobal('assertNotCrossSiteRequest', mocks.assertNotCrossSiteRequest)
    vi.stubGlobal(
      'readValidatedBody',
      async (event: { body: unknown }, parser: (body: unknown) => unknown) => {
        return parser(event.body)
      },
    )
    vi.stubGlobal('useUnauthorizedError', () => {
      throw Object.assign(new Error('Unauthorized'), { status: 401 })
    })
    vi.stubGlobal('useDb', () => testDb.db)
    vi.stubGlobal('useKV', () => kv)
    vi.stubGlobal('setResponseStatus', vi.fn())
    vi.stubGlobal('useUserSession', vi.fn(async () => {
      return { user: { id: String(userId) } }
    }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    testDb.close()
  })

  async function saveTypesafeKey() {
    await seedKey(testDb.db, userId, 'typesafe')
  }

  async function listEntries() {
    return await testDb.db.select().from(schema.memoryEntries)
  }

  async function loadRoute(path: string) {
    const module = await import(/* @vite-ignore */ path)

    return module.default as (event: unknown) => Promise<any>
  }

  async function importText(text = PASTED_TEXT) {
    const { extractMemoryFromText } = await import(
      '~~/server/utils/memory/extract'
    )

    return await extractMemoryFromText({
      userId,
      text,
      scope: 'profile',
      origin: 'import',
      db: testDb.db,
      logger: { set: mocks.loggerSet },
    })
  }

  describe('import and extraction', () => {
    it('saves as before and never calls Jev without a TypeSafe AI key',
      async () => {
        mockGeneratedOps([extractionOp()])

        const result = await importText()

        expect(result.applied.created).toBe(1)
        expect(mocks.decide).not.toHaveBeenCalled()
      })

    it('sends the candidate and a source excerpt and saves a clear entry',
      async () => {
        await saveTypesafeKey()
        mockGeneratedOps([extractionOp()])

        const result = await importText()
        const [call] = mocks.decide.mock.calls[0] as [DecideCall]

        expect(result.applied.created).toBe(1)
        expect(Object.keys(call.questions)).toContain('c0__grounded')
        expect(sentToJev()).toContain('backend engineer at acme corp')
      })

    it('drops an entry Jev flags as sensitive the gate let through',
      async () => {
        await saveTypesafeKey()
        answerJev({ 'racial-or-ethnic-origin': 0.9 })
        mockGeneratedOps([extractionOp()])

        const result = await importText()

        expect(result.applied.created).toBe(0)
        expect(result.dropped).toEqual({ 'extra-check-sensitive': 1 })
        expect(await listEntries()).toHaveLength(0)
      })

    it('drops an entry Jev scores as not supported by the source',
      async () => {
        await saveTypesafeKey()
        answerJev({ grounded: 0.1 })
        mockGeneratedOps([extractionOp()])

        const result = await importText()

        expect(result.dropped).toEqual({ 'extra-check-ungrounded': 1 })
        expect(await listEntries()).toHaveLength(0)
      })

    it('never sends an op the extractor flagged as never-store', async () => {
      await saveTypesafeKey()
      mockGeneratedOps([
        extractionOp({ neverStore: 'payment-card' }),
        extractionOp({
          title: 'Stack',
          description: 'Programming languages',
          body: '- Writes Rust and TypeScript',
          evidence: 'Writes Rust and TypeScript, deploys on Cloudflare '
            + 'Workers.',
        }),
      ])

      await importText()

      expect(mocks.decide).toHaveBeenCalledTimes(1)
      expect(sentToJev()).not.toContain('since March 2019')
    })

    it('saves on the gate alone when TypeSafe AI rejects the key',
      async () => {
        await saveTypesafeKey()
        mocks.decide.mockRejectedValue(new APICallError({
          message: 'Unauthorized',
          url: 'https://api.typesafe.ai/v1/systemone',
          requestBodyValues: {},
          statusCode: 401,
        }))
        mockGeneratedOps([extractionOp()])

        const result = await importText()

        expect(result.applied.created).toBe(1)
        expect(JSON.stringify(mocks.loggerSet.mock.calls))
          .toContain('"status":"unauthorized"')
      })
  })

  describe('entries API', () => {
    const createBody = {
      category: 'topics',
      title: 'Cooking',
      description: 'Likes to cook pasta',
      body: 'Cooks pasta twice a week.',
    }

    async function callCreate(body: unknown) {
      const handler = await loadRoute(
        '../../../server/api/v1/memory/entries/index.post',
      )

      return await handler(createEvent(body))
    }

    async function callPatch(id: string, body: unknown) {
      const handler = await loadRoute(
        '../../../server/api/v1/memory/entries/[id]/index.patch',
      )

      return await handler(createEvent(body, { id }))
    }

    it('creates a manual entry without a key and never calls Jev',
      async () => {
        await callCreate(createBody)

        expect(await listEntries()).toHaveLength(1)
        expect(mocks.decide).not.toHaveBeenCalled()
      })

    it('runs only the sensitivity questions for a manual entry', async () => {
      await saveTypesafeKey()
      await callCreate(createBody)

      const [call] = mocks.decide.mock.calls[0] as [DecideCall]

      expect(await listEntries()).toHaveLength(1)
      expect(Object.keys(call.questions)).toHaveLength(9)
      expect(Object.keys(call.questions)).not.toContain('c0__grounded')
    })

    it('refuses a manual entry Jev flags with a 422 marked extra-check',
      async () => {
        await saveTypesafeKey()
        answerJev({ health: 0.9 })

        await expect(callCreate(createBody)).rejects.toMatchObject({
          status: 422,
          data: { kind: 'extra-check', reason: 'sensitive-topic' },
        })
        expect(await listEntries()).toHaveLength(0)
      })

    it('keeps the gate refusal and never calls Jev for a card number',
      async () => {
        await saveTypesafeKey()

        await expect(callCreate({
          ...createBody,
          body: `Card ${CARD_NUMBER}`,
        })).rejects.toMatchObject({ status: 422 })
        expect(mocks.decide).not.toHaveBeenCalled()
      })

    it('refuses an edit Jev flags and keeps the stored entry', async () => {
      const entryId = await seedEntry(testDb.db, userId, {
        slug: 'cooking',
        title: 'Cooking',
        body: 'Cooks pasta twice a week.',
      })

      await saveTypesafeKey()
      answerJev({ 'never-store': 0.9 })

      await expect(callPatch(entryId, {
        body: 'Cooks pasta three times a week.',
      })).rejects.toMatchObject({
        status: 422,
        data: { kind: 'extra-check', reason: 'never-store' },
      })

      const [stored] = await listEntries()

      expect(stored?.body).toBe('Cooks pasta twice a week.')
    })
  })

  describe('instruct preview and apply', () => {
    async function callPreview() {
      const handler = await loadRoute(
        '../../../server/api/v1/memory/instruct/preview.post',
      )

      return await handler(createEvent({ text: INSTRUCTION }))
    }

    async function callApply() {
      const handler = await loadRoute(
        '../../../server/api/v1/memory/instruct/apply.post',
      )

      return await handler(createEvent({
        operations: [{
          kind: 'create',
          category: 'topics',
          title: 'Travel',
          description: 'Trips the user plans',
          body: '- Plans a trip to Lisbon in May',
        }],
      }))
    }

    it('previews ready rows without a key', async () => {
      mockGeneratedOps([instructOp()])

      const response = await callPreview()

      expect(response.operations[0]).toMatchObject({ status: 'ready' })
      expect(mocks.decide).not.toHaveBeenCalled()
    })

    it('grounds a preview row against the instruction and rejects it when '
      + 'Jev finds no support', async () => {
      await saveTypesafeKey()
      answerJev({ grounded: 0.1 })
      mockGeneratedOps([instructOp()])

      const response = await callPreview()

      expect(sentToJev()).toContain('Lisbon in May')
      expect(response.operations[0]).toMatchObject({
        status: 'rejected',
        rejection: { kind: 'extra-check' },
      })
    })

    it('applies a create without a key', async () => {
      const response = await callApply()

      expect(response.created).toBe(1)
      expect(mocks.decide).not.toHaveBeenCalled()
    })

    it('refuses to apply a create Jev flags, writing nothing', async () => {
      await saveTypesafeKey()
      answerJev({ 'political-opinion': 0.9 })

      await expect(callApply()).rejects.toMatchObject({
        status: 422,
        data: { kind: 'extra-check', reason: 'sensitive-topic' },
      })
      expect(await listEntries()).toHaveLength(0)
    })
  })

  describe('memory_write tool', () => {
    async function writeWithTool() {
      const { getMemoryTools } = await import(
        '~~/server/utils/memory/tools/memory-tools'
      )
      const { tools } = getMemoryTools({
        db: testDb.db,
        userId,
        chatId: 'chat-public-id',
        projectId: null,
        useAccountMemory: null,
        sourceMessageId: 'message-public-id',
        userMessageText: TOOL_MESSAGE,
        budget: createChatSearchBudget(),
        logger: { set: mocks.loggerSet },
      })
      const writeTool = tools.memory_write as {
        execute: (input: unknown, options: unknown) => Promise<unknown>
      }

      return await writeTool.execute({
        category: 'topics',
        title: 'Cooking',
        description: 'Likes to cook pasta',
        body: 'Cooks pasta twice a week.',
        userRequestQuote: 'remember that I cook pasta twice a week',
      }, { toolCallId: 'call-1', messages: [] })
    }

    it('writes without a key', async () => {
      await writeWithTool()

      expect(await listEntries()).toHaveLength(1)
      expect(mocks.decide).not.toHaveBeenCalled()
    })

    it('refuses a tool write Jev flags', async () => {
      await saveTypesafeKey()
      answerJev({ 'religion-or-belief': 0.9 })

      await expect(writeWithTool()).rejects.toThrow()
      expect(await listEntries()).toHaveLength(0)
    })
  })

  describe('paths outside the consent gate', () => {
    it('never calls Jev when no checker is passed, even with a saved key',
      async () => {
        await saveTypesafeKey()
        answerJev({ health: 0.9 })

        const { createMemoryEntry } = await import(
          '~~/server/utils/memory/entries'
        )

        await createMemoryEntry({ db: testDb.db, userId }, {
          input: {
            category: 'profile',
            title: 'About me',
            description: 'About the user',
            body: 'Backend engineer.',
          },
          origin: 'user',
          complianceOrigin: 'about-me-migration',
        })

        expect(mocks.decide).not.toHaveBeenCalled()
        expect(await listEntries()).toHaveLength(1)
      })
  })
})
