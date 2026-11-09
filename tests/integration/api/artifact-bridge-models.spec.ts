import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ARTIFACT_BRIDGE_DAILY_LIMIT,
  ARTIFACT_BRIDGE_HOURLY_LIMIT,
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
}))

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

const GRANTED_TRANSFERS = createGrantedLegalConsentRecord()
  .providerTransferConsents

interface BridgeModelRow {
  id: string
  name: string
  providerId: string
  providerName: string
  inputPricePerMillion: number | null
  outputPricePerMillion: number | null
}

async function loadHandler() {
  const module = await import(
    '../../../server/api/v1/artifacts/[id]/bridge.get'
  )

  return module.default as (event: unknown) => Promise<any>
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

describe('artifact bridge models API', () => {
  let testDb: MemoryExtractionTestDb
  let kv: ReturnType<typeof createMemoryKv>
  let ownerId: number
  let artifactId: string
  let internalId: number

  async function createArtifactFor(userId: number) {
    const created = await createArtifact({
      db: testDb.db,
      storage: createMemoryBlobStore(),
      userId,
      kind: 'html',
      title: 'Photosynthesis quiz',
      content: '<p>Question 1</p>',
      createdVia: 'chat',
      createdBy: 'model',
    })

    artifactId = created.artifactId
    internalId = decodeArtifactId(artifactId) as number
  }

  async function startAs(
    settings: Parameters<typeof seedUser>[1],
    providers: Array<Parameters<typeof seedKey>[2]>,
  ) {
    ownerId = await seedUser(testDb.db, settings)
    mocks.sessionUserId = ownerId

    for (const provider of providers) {
      await seedKey(testDb.db, ownerId, provider)
    }

    await createArtifactFor(ownerId)
  }

  async function read(id: string = artifactId) {
    const handler = await loadHandler()
    const event = {
      context: {},
      params: { id },
      res: { headers: new Headers() },
    }
    const result = await handler(event)

    return { result, event }
  }

  function providersOf(models: BridgeModelRow[]): string[] {
    return [...new Set(models.map((model) => {
      return model.providerId
    }))]
  }

  beforeEach(() => {
    testDb = createMemoryExtractionTestDb()
    kv = createMemoryKv()
    mocks.featureActive = true
    mocks.requireFeature.mockReset()
    mocks.requireFeature.mockImplementation(async () => {
      if (!mocks.featureActive) {
        throw Object.assign(new Error('Not found'), { status: 404 })
      }

      return { active: true }
    })
    mocks.logger.set.mockReset()

    vi.stubGlobal('useDb', () => testDb.db)
    vi.stubGlobal('useKV', () => kv)
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
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  describe('feature flag and access', () => {
    it('answers 404 when artifacts.llm-bridge is off', async () => {
      await startAs({}, ['openai'])
      mocks.featureActive = false

      await expect(read()).rejects.toMatchObject({ status: 404 })
      expect(mocks.requireFeature).toHaveBeenCalledWith(
        expect.anything(),
        'artifacts.llm-bridge',
      )
    })

    it('answers 401 without a session', async () => {
      await startAs({}, ['openai'])
      mocks.sessionUserId = 0

      await expect(read()).rejects.toMatchObject({ status: 401 })
    })

    it('answers 404 for a viewer who does not own the artifact',
      async () => {
        await startAs({}, ['openai'])

        const strangerId = await seedUser(testDb.db)

        await seedKey(testDb.db, strangerId, 'openai')
        mocks.sessionUserId = strangerId

        await expect(read()).rejects.toMatchObject({ status: 404 })
      })

    it('answers 403 with the legal-consent reason without legal consent',
      async () => {
        await startAs(null, ['openai'])

        await expect(read()).rejects.toMatchObject({
          status: 403,
          data: { reason: 'legal-consent' },
        })
      })

    it('answers 403 for a user whose settings row has no consent',
      async () => {
        await startAs({
          termsAcceptedAt: null,
          termsVersion: null,
          ageConfirmedAt: null,
          sensitiveContentConsentAt: null,
          sensitiveContentConsentVersion: null,
        }, ['openai'])

        await expect(read()).rejects.toMatchObject({
          status: 403,
          data: { reason: 'legal-consent' },
        })
      })

    it('does not read the remaining calls before the consent check',
      async () => {
        await startAs(null, ['openai'])

        await expect(read()).rejects.toBeDefined()
        expect(kv.get).not.toHaveBeenCalled()
      })

    it('sends a private no-store header', async () => {
      await startAs({}, ['openai'])

      const { event } = await read()

      expect(event.res.headers.get('Cache-Control'))
        .toBe('private, no-store')
    })
  })

  describe('models', () => {
    it('lists only direct providers the viewer has a key for', async () => {
      await startAs({}, ['openai', 'anthropic', 'vercel-gateway'])

      const { result } = await read()

      expect(providersOf(result.models)).toEqual(['openai', 'anthropic'])
    })

    it('never lists gateway models for a gateway-only viewer', async () => {
      await startAs({}, ['vercel-gateway', 'openrouter'])

      const { result } = await read()

      expect(result.models).toEqual([])
      expect(result.defaultModelId).toBeNull()
    })

    it('answers an empty list and no default without any key', async () => {
      await startAs({}, [])

      const { result } = await read()

      expect(result.models).toEqual([])
      expect(result.defaultModelId).toBeNull()
    })

    it('leaves out providers whose transfer is not consented', async () => {
      await startAs({}, ['openai', 'deepseek', 'moonshotai', 'qwen'])

      const { result } = await read()

      expect(providersOf(result.models)).toEqual(['openai'])
    })

    it('adds a transfer provider once its consent exists', async () => {
      await startAs(
        { providerTransferConsents: GRANTED_TRANSFERS },
        ['openai', 'deepseek', 'moonshotai', 'qwen'],
      )

      const { result } = await read()

      expect(providersOf(result.models)).toEqual([
        'openai',
        'qwen',
        'deepseek',
        'moonshotai',
      ])
    })

    it('leaves out a provider whose consent was withdrawn', async () => {
      await startAs(
        {
          providerTransferConsents: {
            deepseek: { consentedAt: 1000, withdrawnAt: 2000 },
          },
        },
        ['openai', 'deepseek'],
      )

      const { result } = await read()

      expect(providersOf(result.models)).toEqual(['openai'])
    })

    it('leaves out image, retired and deep research models', async () => {
      await startAs({}, ['openai', 'google'])

      const { result } = await read()
      const ids = result.models.map((model: BridgeModelRow) => {
        return model.id
      })

      expect(ids).toContain('gpt-6-luna')
      expect(ids).not.toContain('gpt-image-2')
      expect(ids).not.toContain('o4-mini')
      expect(ids).not.toContain('deep-research-preview-04-2026')
    })

    it('describes each model with names and published prices', async () => {
      await startAs({}, ['openai'])

      const { result } = await read()
      const luna = result.models.find((model: BridgeModelRow) => {
        return model.id === 'gpt-6-luna'
      })

      expect(luna).toEqual({
        id: 'gpt-6-luna',
        name: expect.any(String),
        providerId: 'openai',
        providerName: 'OpenAI',
        inputPricePerMillion: 0.1,
        outputPricePerMillion: 0.5,
      })
    })

    it('never exposes a key or the key provider ids', async () => {
      await startAs({}, ['openai', 'vercel-gateway'])

      const { result } = await read()
      const text = JSON.stringify(result)

      expect(text).not.toContain('encrypted')
      expect(text).not.toContain('vercel-gateway')
    })
  })

  describe('default model', () => {
    it('is the cheapest model of the first provider with a key', async () => {
      await startAs({}, ['anthropic', 'openai'])

      const { result } = await read()

      expect(result.defaultModelId).toBe('gpt-6-luna')
    })

    it('moves to the next provider when OpenAI has no key', async () => {
      await startAs({}, ['anthropic', 'google'])

      const { result } = await read()

      expect(result.defaultModelId).toBe('claude-haiku-5-5')
    })

    it('skips a provider whose transfer is not consented', async () => {
      await startAs({}, ['deepseek', 'google'])

      const { result } = await read()

      expect(result.defaultModelId).toBe('gemini-3.1-flash-lite')
    })

    it('is a model that appears in the list', async () => {
      await startAs({}, ['xai'])

      const { result } = await read()
      const ids = result.models.map((model: BridgeModelRow) => {
        return model.id
      })

      expect(result.defaultModelId).toBe('grok-4.20-0309-non-reasoning')
      expect(ids).toContain(result.defaultModelId)
    })
  })

  describe('remaining calls', () => {
    it('starts at the full caps', async () => {
      await startAs({}, ['openai'])

      const { result } = await read()

      expect(result.remaining).toEqual({
        hour: ARTIFACT_BRIDGE_HOURLY_LIMIT.max,
        day: ARTIFACT_BRIDGE_DAILY_LIMIT.max,
      })
      expect(result.limits).toEqual({
        hour: ARTIFACT_BRIDGE_HOURLY_LIMIT.max,
        day: ARTIFACT_BRIDGE_DAILY_LIMIT.max,
      })
    })

    it('subtracts what the viewer already used', async () => {
      await startAs({}, ['openai'])

      const now = Date.now()

      kv.entries.set(
        `artifact-bridge:hour:${ownerId}:${internalId}`,
        JSON.stringify({ key: 'h', count: 7, lastRequest: now, windowStart: now }),
      )
      kv.entries.set(
        `artifact-bridge:day:${ownerId}`,
        JSON.stringify({ key: 'd', count: 40, lastRequest: now, windowStart: now }),
      )

      const { result } = await read()

      expect(result.remaining).toEqual({
        hour: ARTIFACT_BRIDGE_HOURLY_LIMIT.max - 7,
        day: ARTIFACT_BRIDGE_DAILY_LIMIT.max - 40,
      })
    })

    it('answers 0 when a cap is used up and never goes negative',
      async () => {
        await startAs({}, ['openai'])

        const now = Date.now()

        kv.entries.set(
          `artifact-bridge:hour:${ownerId}:${internalId}`,
          JSON.stringify({
            key: 'h',
            count: ARTIFACT_BRIDGE_HOURLY_LIMIT.max + 5,
            lastRequest: now,
            windowStart: now,
          }),
        )

        const { result } = await read()

        expect(result.remaining.hour).toBe(0)
        expect(result.remaining.day).toBe(ARTIFACT_BRIDGE_DAILY_LIMIT.max)
      })

    it('resets a cap whose window has passed', async () => {
      await startAs({}, ['openai'])

      const longAgo = Date.now()
        - ARTIFACT_BRIDGE_HOURLY_LIMIT.window * 1000
        - 1000

      kv.entries.set(
        `artifact-bridge:hour:${ownerId}:${internalId}`,
        JSON.stringify({
          key: 'h',
          count: ARTIFACT_BRIDGE_HOURLY_LIMIT.max,
          lastRequest: longAgo,
          windowStart: longAgo,
        }),
      )

      const { result } = await read()

      expect(result.remaining.hour).toBe(ARTIFACT_BRIDGE_HOURLY_LIMIT.max)
    })

    it('does not use up a call by reading', async () => {
      await startAs({}, ['openai'])

      await read()
      await read()

      expect(kv.put).not.toHaveBeenCalled()
    })
  })
})
