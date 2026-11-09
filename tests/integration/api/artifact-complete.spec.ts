import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ARTIFACT_BRIDGE_BODY_MAX_BYTES,
  ARTIFACT_BRIDGE_DAILY_LIMIT,
  ARTIFACT_BRIDGE_DEFAULT_OUTPUT_TOKENS,
  ARTIFACT_BRIDGE_HOURLY_LIMIT,
  ARTIFACT_BRIDGE_MAX_OUTPUT_TOKENS,
  ARTIFACT_BRIDGE_PROMPT_MAX,
  ARTIFACT_BRIDGE_SYSTEM_MAX,
  ARTIFACT_BRIDGE_SYSTEM_PREFIX,
  ARTIFACT_BRIDGE_TIMEOUT_MS,
} from '#shared/utils/artifacts'
import {
  createMemoryExtractionTestDb,
  seedKey,
  seedUser,
} from '../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../setup/helpers/memory-extraction-db'
import { createMemoryBlobStore } from '../../setup/helpers/artifacts-store'
import { createGrantedLegalConsentRecord } from '../../setup/fixtures/legal-consent'

const mocks = vi.hoisted(() => ({
  featureActive: true,
  requireFeature: vi.fn(),
  logger: { set: vi.fn() },
  sessionUserId: 0,
  generateText: vi.fn(),
  writeDataPoint: vi.fn(),
  findBridgeModelOverride: null as null | ((...args: any[]) => unknown),
}))

vi.mock('~~/server/utils/artifacts/bridge', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('~~/server/utils/artifacts/bridge')
  >()

  return {
    ...original,
    findArtifactBridgeModel: (...args: [ReadonlySet<string>, string]) => {
      return mocks.findBridgeModelOverride
        ? mocks.findBridgeModelOverride(...args)
        : original.findArtifactBridgeModel(...args)
    },
  }
})

vi.mock('ai', async (importOriginal) => {
  const original = await importOriginal<typeof import('ai')>()

  return {
    ...original,
    generateText: mocks.generateText,
  }
})

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { publicIdMockFactory } = await import(
    '../../setup/helpers/public-id-mock'
  )

  return await publicIdMockFactory()
})

vi.mock('~~/server/utils/features/guards', () => ({
  requireFeature: mocks.requireFeature,
}))

vi.mock('~~/server/utils/logging/request-logger', () => ({
  useRequestLogger: () => mocks.logger,
}))

const { createArtifact, decodeArtifactId } = await import(
  '~~/server/utils/artifacts/store'
)

const OPENAI_MODEL_ID = 'gpt-6-luna'
const ANTHROPIC_MODEL_ID = 'claude-haiku-5-5'
const DEEPSEEK_MODEL_ID = 'deepseek-flash'
const MOONSHOT_MODEL_ID = 'kimi-k2.6'
const QWEN_MODEL_ID = 'qwen3.8-flash'
const GATEWAY_MODEL_ID = 'anthropic/claude-haiku-5-5'
const SECRET_PROMPT = 'SECRET-PROMPT-TEXT-48151623'
const SECRET_SYSTEM = 'SECRET-SYSTEM-TEXT-42'
const SECRET_ANSWER = 'SECRET-ANSWER-TEXT-9000'
const BRIDGE_NO_KEY = 'bridge_no_key'

const PROVIDER_FACTORIES = [
  'useOpenAI',
  'useAnthropic',
  'useGoogle',
  'useXai',
  'useDeepSeek',
  'useMoonshotAi',
  'useQwen',
] as const

type Factory = ReturnType<typeof vi.fn>

async function importHandler(path: string) {
  const module = await import(path)

  return module.default as (event: unknown) => Promise<any>
}

function loadComplete() {
  return importHandler(
    '../../../server/api/v1/artifacts/[id]/complete.post',
  )
}

function createEvent(input: {
  params?: Record<string, string>
  body?: unknown
} = {}) {
  return {
    context: {},
    params: input.params ?? {},
    body: input.body,
    res: { headers: new Headers() },
  }
}

function createMemoryKv() {
  const entries = new Map<string, string>()

  return {
    entries,
    get: vi.fn(async (key: string) => {
      return entries.get(key) ?? null
    }),
    put: vi.fn(async (key: string, value: string) => {
      entries.set(key, value)
    }),
  }
}

function completionOf(text: string = 'Hello there') {
  return {
    text,
    usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    finishReason: 'stop',
  }
}

const GRANTED_TRANSFERS = createGrantedLegalConsentRecord()
  .providerTransferConsents

describe('artifact bridge completion API', () => {
  let testDb: MemoryExtractionTestDb
  let kv: ReturnType<typeof createMemoryKv>
  let ownerId: number
  let artifactId: string
  let internalId: number
  let factories: Record<string, Factory>

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    kv = createMemoryKv()
    ownerId = await seedUser(testDb.db)
    await seedKey(testDb.db, ownerId, 'openai')
    mocks.sessionUserId = ownerId
    mocks.featureActive = true
    mocks.requireFeature.mockReset()
    mocks.requireFeature.mockImplementation(async () => {
      if (!mocks.featureActive) {
        throw Object.assign(new Error('Not found'), { status: 404 })
      }

      return { active: true }
    })
    mocks.logger.set.mockReset()
    mocks.generateText.mockReset()
    mocks.generateText.mockResolvedValue(completionOf())
    mocks.writeDataPoint.mockReset()
    mocks.findBridgeModelOverride = null

    factories = {}

    for (const name of PROVIDER_FACTORIES) {
      factories[name] = vi.fn(async () => {
        return {
          instance: { id: `${name}-model` },
          reasoning: undefined,
          providerOptions: { flag: name },
        }
      })
      vi.stubGlobal(name, factories[name])
    }

    vi.stubGlobal('useDb', () => testDb.db)
    vi.stubGlobal('useKV', () => kv)
    vi.stubGlobal('useAnalytics', () => {
      return { writeDataPoint: mocks.writeDataPoint }
    })
    vi.stubGlobal('useUserSession', async () => {
      return mocks.sessionUserId
        ? { user: { id: String(mocks.sessionUserId) } }
        : null
    })
    vi.stubGlobal('useUnauthorizedError', () => {
      throw Object.assign(new Error('Unauthorized'), { status: 401 })
    })
    vi.stubGlobal('getRouterParams', (event: { params: unknown }) => {
      return event.params
    })
    vi.stubGlobal('getRequestHeader', () => undefined)
    vi.stubGlobal('readValidatedBody', async (
      event: { body: unknown },
      validate: (value: unknown) => unknown,
    ) => validate(event.body))

    const created = await createArtifact({
      db: testDb.db,
      storage: createMemoryBlobStore(),
      userId: ownerId,
      kind: 'html',
      title: 'Photosynthesis quiz',
      content: '<p>Question 1</p>',
      createdVia: 'chat',
      createdBy: 'model',
    })

    artifactId = created.artifactId
    internalId = decodeArtifactId(artifactId) as number
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  async function call(
    body: Record<string, unknown> = {},
    id: string = artifactId,
  ) {
    const handler = await loadComplete()
    const event = createEvent({
      params: { id },
      body: {
        prompt: 'Explain photosynthesis',
        modelId: OPENAI_MODEL_ID,
        ...body,
      },
    })
    const result = await handler(event)

    return { result, event }
  }

  async function createArtifactFor(userId: number) {
    const created = await createArtifact({
      db: testDb.db,
      storage: createMemoryBlobStore(),
      userId,
      kind: 'html',
      title: 'Mine',
      content: '<p>mine</p>',
      createdVia: 'chat',
      createdBy: 'model',
    })

    artifactId = created.artifactId
    internalId = decodeArtifactId(artifactId) as number
  }

  async function seedProviderKey(
    provider: Parameters<typeof seedKey>[2],
  ) {
    await seedKey(testDb.db, ownerId, provider)
  }

  async function switchToUser(
    settings: Parameters<typeof seedUser>[1] = {},
  ) {
    const userId = await seedUser(testDb.db, settings)

    mocks.sessionUserId = userId

    return userId
  }

  function seedKvCount(key: string, count: number, windowStart = Date.now()) {
    kv.entries.set(
      `artifact-bridge:${key}`,
      JSON.stringify({
        key,
        count,
        lastRequest: windowStart,
        windowStart,
      }),
    )
  }

  function readKvCount(key: string): number | null {
    const raw = kv.entries.get(`artifact-bridge:${key}`)

    return raw ? JSON.parse(raw).count : null
  }

  function hourKey(userId: number = ownerId, artifact: number = internalId) {
    return `hour:${userId}:${artifact}`
  }

  function dayKey(userId: number = ownerId) {
    return `day:${userId}`
  }

  function everyStoredRowText(): string {
    const tables = testDb.sqlite
      .prepare(
        'SELECT name FROM sqlite_master WHERE type = \'table\' '
        + 'AND name NOT LIKE \'sqlite_%\'',
      )
      .all() as Array<{ name: string }>

    return tables
      .map((table) => {
        const rows = testDb.sqlite
          .prepare(`SELECT * FROM "${table.name}"`)
          .all()

        return JSON.stringify(rows)
      })
      .join('\n')
  }

  describe('feature flag and access', () => {
    it('answers 404 when artifacts.llm-bridge is off', async () => {
      mocks.featureActive = false

      await expect(call()).rejects.toMatchObject({ status: 404 })
      expect(mocks.requireFeature).toHaveBeenCalledWith(
        expect.anything(),
        'artifacts.llm-bridge',
      )
      expect(mocks.generateText).not.toHaveBeenCalled()
    })

    it('checks the flag first, then answers 401 without a session',
      async () => {
        mocks.sessionUserId = 0

        await expect(call()).rejects.toMatchObject({ status: 401 })
        expect(mocks.requireFeature).toHaveBeenCalledWith(
          expect.anything(),
          'artifacts.llm-bridge',
        )
        expect(mocks.generateText).not.toHaveBeenCalled()
      })

    it('answers 404 for a viewer who does not own the artifact',
      async () => {
        const strangerId = await switchToUser()

        await seedKey(testDb.db, strangerId, 'openai')

        await expect(call()).rejects.toMatchObject({ status: 404 })
        expect(mocks.generateText).not.toHaveBeenCalled()
        expect(kv.entries.size).toBe(0)
      })

    it('answers 404 for an unknown artifact id', async () => {
      await expect(call({}, 'art_does_not_exist'))
        .rejects.toMatchObject({ status: 404 })
      expect(mocks.generateText).not.toHaveBeenCalled()
    })
  })

  describe('request body size', () => {
    function stubContentLength(value: string | undefined) {
      vi.stubGlobal('getRequestHeader', (_event: unknown, name: string) => {
        return name === 'content-length' ? value : undefined
      })
    }

    it('answers 413 for a body over 64 KB before reading it', async () => {
      const readBody = vi.fn()

      stubContentLength(String(ARTIFACT_BRIDGE_BODY_MAX_BYTES + 1))
      vi.stubGlobal('readValidatedBody', readBody)

      await expect(call()).rejects.toMatchObject({ status: 413 })
      expect(readBody).not.toHaveBeenCalled()
      expect(mocks.generateText).not.toHaveBeenCalled()
      expect(kv.entries.size).toBe(0)
    })

    it('accepts a body of exactly 64 KB', async () => {
      stubContentLength(String(ARTIFACT_BRIDGE_BODY_MAX_BYTES))

      await expect(call()).resolves.toBeDefined()
    })

    it('does not refuse a request without a usable Content-Length',
      async () => {
        stubContentLength(undefined)
        await expect(call()).resolves.toBeDefined()

        stubContentLength('not-a-number')
        await expect(call()).resolves.toBeDefined()
      })

    it('still refuses a signed-out request before the size check',
      async () => {
        mocks.sessionUserId = 0
        stubContentLength(String(ARTIFACT_BRIDGE_BODY_MAX_BYTES + 1))

        await expect(call()).rejects.toMatchObject({ status: 401 })
      })
  })

  describe('body validation', () => {
    it('refuses a prompt over the limit with 400', async () => {
      await expect(call({
        prompt: 'x'.repeat(ARTIFACT_BRIDGE_PROMPT_MAX + 1),
      })).rejects.toMatchObject({ status: 400 })
      expect(mocks.generateText).not.toHaveBeenCalled()
      expect(kv.entries.size).toBe(0)
    })

    it('accepts a prompt of exactly the limit', async () => {
      const { result } = await call({
        prompt: 'x'.repeat(ARTIFACT_BRIDGE_PROMPT_MAX),
      })

      expect(result.text).toBe('Hello there')
    })

    it('refuses an empty prompt with 400', async () => {
      await expect(call({ prompt: '' }))
        .rejects.toMatchObject({ status: 400 })
    })

    it('refuses a system text over the limit with 400', async () => {
      await expect(call({
        system: 'x'.repeat(ARTIFACT_BRIDGE_SYSTEM_MAX + 1),
      })).rejects.toMatchObject({ status: 400 })
      expect(mocks.generateText).not.toHaveBeenCalled()
    })

    it('accepts a system text of exactly the limit', async () => {
      await expect(call({
        system: 'x'.repeat(ARTIFACT_BRIDGE_SYSTEM_MAX),
      })).resolves.toBeDefined()
    })

    it('refuses maxOutputTokens over the limit with 400', async () => {
      await expect(call({
        maxOutputTokens: ARTIFACT_BRIDGE_MAX_OUTPUT_TOKENS + 1,
      })).rejects.toMatchObject({ status: 400 })
      expect(mocks.generateText).not.toHaveBeenCalled()
    })

    it.each([0, -5, 10.5])('refuses maxOutputTokens %s with 400',
      async (maxOutputTokens) => {
        await expect(call({ maxOutputTokens }))
          .rejects.toMatchObject({ status: 400 })
      })

    it('passes maxOutputTokens at the limit through', async () => {
      await call({ maxOutputTokens: ARTIFACT_BRIDGE_MAX_OUTPUT_TOKENS })

      expect(mocks.generateText).toHaveBeenCalledWith(
        expect.objectContaining({
          maxOutputTokens: ARTIFACT_BRIDGE_MAX_OUTPUT_TOKENS,
        }),
      )
    })

    it('refuses a missing model id with 400', async () => {
      await expect(call({ modelId: undefined }))
        .rejects.toMatchObject({ status: 400 })
    })

    it('answers 400 for a malformed body before any consent check',
      async () => {
        const unconsentedId = await switchToUser(null)

        await createArtifactFor(unconsentedId)

        await expect(call({ prompt: 'x'.repeat(9000) }))
          .rejects.toMatchObject({ status: 400 })
      })
  })

  describe('consent', () => {
    it('answers 403 without legal consent and never calls the model',
      async () => {
        const unconsentedId = await switchToUser(null)

        await createArtifactFor(unconsentedId)

        await expect(call()).rejects.toMatchObject({
          status: 403,
          data: { reason: 'legal-consent' },
        })
        expect(mocks.generateText).not.toHaveBeenCalled()
        expect(kv.entries.size).toBe(0)
      })

    it('answers 403 for a user whose settings row has no consent',
      async () => {
        const unconsentedId = await switchToUser({
          termsAcceptedAt: null,
          termsVersion: null,
          ageConfirmedAt: null,
          sensitiveContentConsentAt: null,
          sensitiveContentConsentVersion: null,
        })

        await createArtifactFor(unconsentedId)

        await expect(call()).rejects.toMatchObject({
          status: 403,
          data: { reason: 'legal-consent' },
        })
        expect(mocks.generateText).not.toHaveBeenCalled()
      })

    it.each([
      ['deepseek', DEEPSEEK_MODEL_ID],
      ['moonshotai', MOONSHOT_MODEL_ID],
      ['qwen', QWEN_MODEL_ID],
    ] as const)('answers 403 for %s without transfer consent',
      async (provider, modelId) => {
        await seedProviderKey(provider)

        await expect(call({ modelId })).rejects.toMatchObject({
          status: 403,
          data: { reason: 'transfer-consent', provider },
        })
        expect(mocks.generateText).not.toHaveBeenCalled()
        expect(kv.entries.size).toBe(0)
      })

    it('answers 403 after the transfer consent was withdrawn', async () => {
      await seedProviderKey('deepseek')
      testDb.sqlite
        .prepare('UPDATE user_settings SET provider_transfer_consents = ?')
        .run(JSON.stringify({
          deepseek: { consentedAt: 1000, withdrawnAt: 2000 },
        }))

      await expect(call({ modelId: DEEPSEEK_MODEL_ID }))
        .rejects.toMatchObject({
          status: 403,
          data: { reason: 'transfer-consent' },
        })
      expect(mocks.generateText).not.toHaveBeenCalled()
    })

    it('calls a transfer provider once its consent is recorded',
      async () => {
        const consentedId = await switchToUser({
          providerTransferConsents: GRANTED_TRANSFERS,
        })

        await seedKey(testDb.db, consentedId, 'deepseek')
        await createArtifactFor(consentedId)

        const { result } = await call({ modelId: DEEPSEEK_MODEL_ID })

        expect(result.modelId).toBe(DEEPSEEK_MODEL_ID)
        expect(factories.useDeepSeek).toHaveBeenCalledWith(
          String(consentedId),
          DEEPSEEK_MODEL_ID,
          [],
          'off',
        )
      })
  })

  describe('model and key resolution', () => {
    it('answers 400 bridge_no_key for a gateway model id', async () => {
      await seedProviderKey('vercel-gateway')

      await expect(call({ modelId: GATEWAY_MODEL_ID })).rejects.toMatchObject({
        status: 400,
        data: { reason: BRIDGE_NO_KEY },
      })
      expect(mocks.generateText).not.toHaveBeenCalled()
      expect(kv.entries.size).toBe(0)
    })

    it('answers 400 bridge_no_key for an unknown model id', async () => {
      await expect(call({ modelId: 'not-a-model' })).rejects.toMatchObject({
        status: 400,
        data: { reason: BRIDGE_NO_KEY },
      })
      expect(mocks.generateText).not.toHaveBeenCalled()
    })

    it('answers 400 bridge_no_key for a direct model without a saved key',
      async () => {
        await expect(call({ modelId: ANTHROPIC_MODEL_ID }))
          .rejects.toMatchObject({
            status: 400,
            data: { reason: BRIDGE_NO_KEY },
          })
        expect(mocks.generateText).not.toHaveBeenCalled()
        expect(kv.entries.size).toBe(0)
        expect(factories.useAnthropic).not.toHaveBeenCalled()
      })

    it('does not use a gateway key for a direct model', async () => {
      const gatewayOnlyId = await switchToUser()

      await seedKey(testDb.db, gatewayOnlyId, 'vercel-gateway')
      await createArtifactFor(gatewayOnlyId)

      await expect(call({ modelId: ANTHROPIC_MODEL_ID }))
        .rejects.toMatchObject({
          status: 400,
          data: { reason: BRIDGE_NO_KEY },
        })
      expect(mocks.generateText).not.toHaveBeenCalled()
    })

    it('answers 400 bridge_no_key when the catalog model belongs to '
      + 'another provider than the requested id', async () => {
      mocks.findBridgeModelOverride = (_keys, modelId) => ({
        id: modelId,
        name: 'Impostor',
        providerId: 'anthropic',
        providerName: 'Anthropic',
        inputPricePerMillion: 0.1,
        outputPricePerMillion: 0.5,
      })

      await expect(call()).rejects.toMatchObject({
        status: 400,
        data: { reason: BRIDGE_NO_KEY },
      })
      expect(mocks.generateText).not.toHaveBeenCalled()
      expect(factories.useAnthropic).not.toHaveBeenCalled()
      expect(factories.useOpenAI).not.toHaveBeenCalled()
      expect(kv.entries.size).toBe(0)
    })

    it('uses the catalog model when its provider matches', async () => {
      mocks.findBridgeModelOverride = (_keys, modelId) => ({
        id: modelId,
        name: 'Luna',
        providerId: 'openai',
        providerName: 'OpenAI',
        inputPricePerMillion: 0.1,
        outputPricePerMillion: 0.5,
      })

      await expect(call()).resolves.toBeDefined()
      expect(mocks.generateText).toHaveBeenCalledTimes(1)
    })

    it.each([
      ['an image generation model', 'gpt-image-2'],
      ['a retired model', 'o4-mini'],
      ['a deep research agent', 'deep-research-preview-04-2026'],
    ])('answers 400 bridge_no_key for %s', async (_label, modelId) => {
      await seedProviderKey('google')

      await expect(call({ modelId })).rejects.toMatchObject({
        status: 400,
        data: { reason: BRIDGE_NO_KEY },
      })
      expect(mocks.generateText).not.toHaveBeenCalled()
    })
  })

  describe('a successful completion', () => {
    it('sends the fixed prefix and the artifact system text', async () => {
      await call({ system: SECRET_SYSTEM })

      expect(mocks.generateText).toHaveBeenCalledTimes(1)

      const options = mocks.generateText.mock.calls[0]![0]

      expect(options.system).toBe(
        `${ARTIFACT_BRIDGE_SYSTEM_PREFIX}\n\n${SECRET_SYSTEM}`,
      )
      expect(options.system.startsWith(
        `${ARTIFACT_BRIDGE_SYSTEM_PREFIX}\n\n`,
      )).toBe(true)
      expect(options.prompt).toBe('Explain photosynthesis')
    })

    it('sends only the fixed prefix without an artifact system text',
      async () => {
        await call()

        const options = mocks.generateText.mock.calls[0]![0]

        expect(options.system).toBe(ARTIFACT_BRIDGE_SYSTEM_PREFIX)
      })

    it('sends no tools, no messages and a timeout signal', async () => {
      await call()

      const options = mocks.generateText.mock.calls[0]![0]

      expect(options).not.toHaveProperty('tools')
      expect(options).not.toHaveProperty('toolChoice')
      expect(options).not.toHaveProperty('messages')
      expect(options.abortSignal).toBeInstanceOf(AbortSignal)
      expect(ARTIFACT_BRIDGE_TIMEOUT_MS).toBe(30_000)
    })

    it('defaults maxOutputTokens to 1000', async () => {
      await call()

      expect(ARTIFACT_BRIDGE_DEFAULT_OUTPUT_TOKENS).toBe(1000)
      expect(mocks.generateText.mock.calls[0]![0].maxOutputTokens)
        .toBe(1000)
    })

    it('passes a requested maxOutputTokens through', async () => {
      await call({ maxOutputTokens: 250 })

      expect(mocks.generateText.mock.calls[0]![0].maxOutputTokens)
        .toBe(250)
    })

    it('builds the model with the viewer key and wrapped options',
      async () => {
        await call()

        expect(factories.useOpenAI).toHaveBeenCalledWith(
          String(ownerId),
          OPENAI_MODEL_ID,
          [],
          'low',
        )

        const options = mocks.generateText.mock.calls[0]![0]

        expect(options.model).toEqual({ id: 'useOpenAI-model' })
        expect(options.providerOptions).toEqual({
          openai: { flag: 'useOpenAI' },
        })
      })

    it('answers with text, model, usage, cost and remaining calls',
      async () => {
        mocks.generateText.mockResolvedValue(completionOf('Plants make sugar'))

        const { result } = await call()

        expect(result.text).toBe('Plants make sugar')
        expect(result.modelId).toBe(OPENAI_MODEL_ID)
        expect(result.usage).toEqual({ inputTokens: 100, outputTokens: 50 })
        expect(result.costUsd).toBeCloseTo((100 * 0.1 + 50 * 0.5) / 1_000_000)
        expect(result.remaining).toEqual({
          hour: ARTIFACT_BRIDGE_HOURLY_LIMIT.max - 1,
          day: ARTIFACT_BRIDGE_DAILY_LIMIT.max - 1,
        })
      })

    it('works for another direct provider with its own key', async () => {
      await seedProviderKey('anthropic')

      const { result } = await call({ modelId: ANTHROPIC_MODEL_ID })

      expect(result.modelId).toBe(ANTHROPIC_MODEL_ID)
      expect(factories.useAnthropic).toHaveBeenCalledWith(
        String(ownerId),
        ANTHROPIC_MODEL_ID,
        [],
        'off',
      )
    })

    it('reports null usage and cost when the provider sends no usage',
      async () => {
        mocks.generateText.mockResolvedValue({
          text: 'ok',
          usage: {},
          finishReason: 'stop',
        })

        const { result } = await call()

        expect(result.usage).toEqual({
          inputTokens: null,
          outputTokens: null,
        })
        expect(result.costUsd).toBeNull()
      })
  })

  describe('logging and analytics', () => {
    it('never logs prompt, system or answer text', async () => {
      mocks.generateText.mockResolvedValue(completionOf(SECRET_ANSWER))

      await call({ prompt: SECRET_PROMPT, system: SECRET_SYSTEM })

      const logged = JSON.stringify(
        mocks.logger.set.mock.calls.map(([fields]) => fields),
      )

      expect(mocks.logger.set).toHaveBeenCalled()
      expect(logged).not.toContain(SECRET_PROMPT)
      expect(logged).not.toContain(SECRET_SYSTEM)
      expect(logged).not.toContain(SECRET_ANSWER)
    })

    it('logs ids, tokens and cost under attributes.artifactBridge',
      async () => {
        await call()

        const lastFields = mocks.logger.set.mock.calls.at(-1)![0]

        expect(lastFields.attributes.artifactBridge).toMatchObject({
          origin: 'artifact-bridge',
          artifactId,
          modelId: OPENAI_MODEL_ID,
          providerId: 'openai',
          mode: 'owner',
          inputTokens: 100,
          outputTokens: 50,
          finishReason: 'stop',
        })
        expect(lastFields.attributes.artifactBridge.costUsd)
          .toBeCloseTo((100 * 0.1 + 50 * 0.5) / 1_000_000)
        expect(lastFields.attributes.artifactBridge.durationMs)
          .toEqual(expect.any(Number))
      })

    it('never logs the prompt when the body is refused', async () => {
      await expect(call({
        prompt: `${SECRET_PROMPT}${'x'.repeat(ARTIFACT_BRIDGE_PROMPT_MAX)}`,
      })).rejects.toMatchObject({ status: 400 })

      expect(JSON.stringify(mocks.logger.set.mock.calls))
        .not.toContain(SECRET_PROMPT)
    })

    it('writes one analytics point without the user id', async () => {
      await call({ prompt: SECRET_PROMPT })

      expect(mocks.writeDataPoint).toHaveBeenCalledTimes(1)

      const point = mocks.writeDataPoint.mock.calls[0]![0]

      expect(point.blobs[0]).toBe('artifact_bridge_call')
      expect(point).toEqual({
        blobs: ['artifact_bridge_call', 'openai', OPENAI_MODEL_ID, 'ok'],
        indexes: ['artifact_bridge_call'],
      })
      expect(JSON.stringify(point)).not.toContain(SECRET_PROMPT)
    })

    it('still answers when analytics is unavailable', async () => {
      vi.stubGlobal('useAnalytics', () => null)

      await expect(call()).resolves.toBeDefined()
    })

    it('still answers when analytics throws', async () => {
      mocks.writeDataPoint.mockImplementation(() => {
        throw new Error('analytics down')
      })

      await expect(call()).resolves.toBeDefined()
    })

    it('stores the prompt, system and answer in no D1 table', async () => {
      mocks.generateText.mockResolvedValue(completionOf(SECRET_ANSWER))

      await call({ prompt: SECRET_PROMPT, system: SECRET_SYSTEM })

      const stored = everyStoredRowText()

      expect(stored).not.toContain(SECRET_PROMPT)
      expect(stored).not.toContain(SECRET_SYSTEM)
      expect(stored).not.toContain(SECRET_ANSWER)

      const counts = testDb.sqlite
        .prepare(
          'SELECT (SELECT COUNT(*) FROM chats) AS chats, '
          + '(SELECT COUNT(*) FROM messages) AS messages',
        )
        .get()

      expect(counts).toEqual({ chats: 0, messages: 0 })
    })
  })

  describe('rate limits', () => {
    it('answers 429 on the 31st call within an hour', async () => {
      for (let index = 0; index < ARTIFACT_BRIDGE_HOURLY_LIMIT.max; index++) {
        await call()
      }

      expect(mocks.generateText)
        .toHaveBeenCalledTimes(ARTIFACT_BRIDGE_HOURLY_LIMIT.max)

      const handler = await loadComplete()
      const event = createEvent({
        params: { id: artifactId },
        body: { prompt: 'One more', modelId: OPENAI_MODEL_ID },
      })

      await expect(handler(event)).rejects.toMatchObject({
        status: 429,
        data: { reason: 'bridge-rate-limit' },
      })

      const retryAfter = Number(event.res.headers.get('Retry-After'))

      expect(retryAfter).toBeGreaterThanOrEqual(1)
      expect(retryAfter).toBeLessThanOrEqual(
        ARTIFACT_BRIDGE_HOURLY_LIMIT.window,
      )
      expect(mocks.generateText)
        .toHaveBeenCalledTimes(ARTIFACT_BRIDGE_HOURLY_LIMIT.max)
    })

    it('names the hour in the refusal and keeps the daily count',
      async () => {
        seedKvCount(hourKey(), ARTIFACT_BRIDGE_HOURLY_LIMIT.max)

        await expect(call()).rejects.toMatchObject({
          status: 429,
          why: expect.stringContaining('this hour'),
        })
        expect(readKvCount(dayKey())).toBe(1)
        expect(mocks.generateText).not.toHaveBeenCalled()
      })

    it('answers 429 once the daily cap of 200 is used', async () => {
      seedKvCount(dayKey(), ARTIFACT_BRIDGE_DAILY_LIMIT.max)

      const handler = await loadComplete()
      const event = createEvent({
        params: { id: artifactId },
        body: { prompt: 'Hi', modelId: OPENAI_MODEL_ID },
      })

      await expect(handler(event)).rejects.toMatchObject({
        status: 429,
        data: { reason: 'bridge-rate-limit' },
        why: expect.stringContaining('today'),
      })

      const retryAfter = Number(event.res.headers.get('Retry-After'))

      expect(retryAfter).toBeGreaterThanOrEqual(1)
      expect(retryAfter).toBeLessThanOrEqual(ARTIFACT_BRIDGE_DAILY_LIMIT.window)
      expect(mocks.generateText).not.toHaveBeenCalled()
    })

    it('checks the daily cap first and spares the hourly slot', async () => {
      seedKvCount(dayKey(), ARTIFACT_BRIDGE_DAILY_LIMIT.max)

      await expect(call()).rejects.toMatchObject({ status: 429 })

      expect(readKvCount(hourKey())).toBeNull()
    })

    it('names the day when both caps are used up', async () => {
      seedKvCount(dayKey(), ARTIFACT_BRIDGE_DAILY_LIMIT.max)
      seedKvCount(hourKey(), ARTIFACT_BRIDGE_HOURLY_LIMIT.max)

      await expect(call()).rejects.toMatchObject({
        status: 429,
        why: expect.stringContaining('today'),
      })
    })

    it('allows the 200th daily call and refuses the next', async () => {
      seedKvCount(dayKey(), ARTIFACT_BRIDGE_DAILY_LIMIT.max - 1)

      await expect(call()).resolves.toBeDefined()
      await expect(call()).rejects.toMatchObject({ status: 429 })
    })

    it('counts the daily cap across artifacts but the hour per artifact',
      async () => {
        const second = await createArtifact({
          db: testDb.db,
          storage: createMemoryBlobStore(),
          userId: ownerId,
          kind: 'html',
          title: 'Second',
          content: '<p>2</p>',
          createdVia: 'chat',
          createdBy: 'model',
        })
        const secondInternalId = decodeArtifactId(
          second.artifactId,
        ) as number

        await call()
        await call({}, second.artifactId)

        expect(readKvCount(dayKey())).toBe(2)
        expect(readKvCount(hourKey())).toBe(1)
        expect(readKvCount(hourKey(ownerId, secondInternalId))).toBe(1)
      })

    it('starts a fresh hour when the window has passed', async () => {
      seedKvCount(
        hourKey(),
        ARTIFACT_BRIDGE_HOURLY_LIMIT.max,
        Date.now() - ARTIFACT_BRIDGE_HOURLY_LIMIT.window * 1000 - 1000,
      )

      await expect(call()).resolves.toBeDefined()
      expect(readKvCount(hourKey())).toBe(1)
    })

    it('does not let another viewer use up this viewer cap', async () => {
      seedKvCount(dayKey(ownerId + 1000), ARTIFACT_BRIDGE_DAILY_LIMIT.max)

      await expect(call()).resolves.toBeDefined()
    })

    it('does not take a slot for a refused model or consent', async () => {
      await expect(call({ modelId: ANTHROPIC_MODEL_ID })).rejects.toBeDefined()
      await expect(call({ modelId: GATEWAY_MODEL_ID })).rejects.toBeDefined()

      expect(kv.entries.size).toBe(0)
    })
  })

  describe('rate limiter failure', () => {
    it('answers 429 with Retry-After 1 when the KV write fails', async () => {
      kv.put.mockRejectedValue(new Error('KV PUT failed: 429 Too Many'))

      const handler = await loadComplete()
      const event = createEvent({
        params: { id: artifactId },
        body: { prompt: 'Explain', modelId: OPENAI_MODEL_ID },
      })

      await expect(handler(event)).rejects.toMatchObject({
        status: 429,
        data: { reason: 'bridge-rate-limit', retryAfter: 1 },
      })
      expect(event.res.headers.get('Retry-After')).toBe('1')
      expect(mocks.generateText).not.toHaveBeenCalled()
    })

    it('answers 429 when the KV read fails as well', async () => {
      kv.get.mockRejectedValue(new Error('KV GET failed'))

      await expect(call()).rejects.toMatchObject({
        status: 429,
        data: { reason: 'bridge-rate-limit' },
      })
      expect(mocks.generateText).not.toHaveBeenCalled()
    })
  })

  describe('provider failures', () => {
    it('never puts the provider message into the 502 reason', async () => {
      mocks.generateText.mockRejectedValue(Object.assign(
        new Error(`Incorrect API key provided: ${SECRET_ANSWER}`),
        { statusCode: 401 },
      ))

      const handler = await loadComplete()
      const event = createEvent({
        params: { id: artifactId },
        body: { prompt: SECRET_PROMPT, modelId: OPENAI_MODEL_ID },
      })
      const failure = await handler(event).catch((exception: any) => {
        return exception
      })

      expect(failure.status).toBe(502)
      expect(failure.why).toBe('OpenAI answered with status 401.')
      expect(JSON.stringify({
        message: failure.message,
        why: failure.why,
        fix: failure.fix,
        data: failure.data,
      })).not.toContain(SECRET_ANSWER)
      expect(JSON.stringify({
        message: failure.message,
        why: failure.why,
        fix: failure.fix,
        data: failure.data,
      })).not.toContain(SECRET_PROMPT)
    })

    it('names only the provider and the status for any failure', async () => {
      mocks.generateText.mockRejectedValue(
        new Error(`Provider exploded ${SECRET_ANSWER}`),
      )

      const failure = await call().catch((exception: any) => exception)

      expect(failure.status).toBe(502)
      expect(failure.why).toMatch(
        /^(OpenAI answered with status \d{3}\.|The request to OpenAI failed or timed out\.)$/,
      )
      expect(failure.why).not.toContain('exploded')
      expect(failure.fix).toBe(
        'Check the key in Profile → API keys or try another model.',
      )
    })

    it('answers 502 when the provider throws', async () => {
      mocks.generateText.mockRejectedValue(new Error('Provider exploded'))

      await expect(call()).rejects.toMatchObject({
        status: 502,
        message: 'The model request failed',
      })
    })

    it('records the failure in the log and analytics', async () => {
      mocks.generateText.mockRejectedValue(new Error('Provider exploded'))

      await expect(call({ prompt: SECRET_PROMPT })).rejects.toBeDefined()

      const lastFields = mocks.logger.set.mock.calls.at(-1)![0]

      expect(lastFields.attributes.artifactBridge).toMatchObject({
        artifactId,
        modelId: OPENAI_MODEL_ID,
        error: 'Error',
      })
      expect(JSON.stringify(mocks.logger.set.mock.calls))
        .not.toContain(SECRET_PROMPT)
      expect(mocks.writeDataPoint).toHaveBeenCalledWith({
        blobs: ['artifact_bridge_call', 'openai', OPENAI_MODEL_ID, 'error'],
        indexes: ['artifact_bridge_call'],
      })
    })

    it('answers 502 when the model cannot be built', async () => {
      factories.useOpenAI!.mockRejectedValue(new Error('No key'))

      await expect(call()).rejects.toMatchObject({ status: 502 })
      expect(mocks.generateText).not.toHaveBeenCalled()
    })

    it('has already taken the call from the caps when the provider fails',
      async () => {
        mocks.generateText.mockRejectedValue(new Error('Provider exploded'))

        await expect(call()).rejects.toBeDefined()

        expect(readKvCount(dayKey())).toBe(1)
        expect(readKvCount(hourKey())).toBe(1)
      })
  })
})
