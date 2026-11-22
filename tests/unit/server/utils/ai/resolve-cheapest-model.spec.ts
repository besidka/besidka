import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Model } from '#shared/types/providers.d'
import { providers } from '~~/providers'
import { createGrantedLegalConsentRecord } from '../../../../setup/fixtures/legal-consent'

const mocks = vi.hoisted(() => ({
  unusableModelIds: new Set<string>(),
}))

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

const {
  DIRECT_MODEL_PROVIDER_ORDER,
  instantiateDirectModel,
  isDirectModelProvider,
  readAvailableKeys,
  resolveCheapestDirectModel,
} = await import('~~/server/utils/ai/resolve-cheapest-model')

const CHEAPEST_BY_PROVIDER = {
  openai: 'gpt-6-luna',
  anthropic: 'claude-haiku-5-5',
  qwen: 'qwen3.8-flash',
  deepseek: 'deepseek-flash',
  google: 'gemini-3.1-flash-lite',
  moonshotai: 'kimi-k2.6',
  xai: 'grok-4.20-0309-non-reasoning',
} as const

function createDb(providerIds: string[]) {
  const findMany = vi.fn(async () => {
    return providerIds.map((provider) => {
      return { provider }
    })
  })

  return { db: { query: { keys: { findMany } } }, findMany }
}

function noConsent() {
  return createGrantedLegalConsentRecord({ providerTransferConsents: null })
}

describe('DIRECT_MODEL_PROVIDER_ORDER', () => {
  it('lists the direct providers cheapest-first as memory always did', () => {
    expect([...DIRECT_MODEL_PROVIDER_ORDER]).toEqual([
      'openai',
      'anthropic',
      'qwen',
      'deepseek',
      'google',
      'moonshotai',
      'xai',
    ])
  })
})

describe('isDirectModelProvider', () => {
  it.each([...DIRECT_MODEL_PROVIDER_ORDER])('accepts %s', (providerId) => {
    expect(isDirectModelProvider(providerId)).toBe(true)
  })

  it.each([
    'vercel-gateway',
    'openrouter',
    'cloudflare-gateway',
    'vercel',
    'cloudflare',
    'brave',
    '',
  ])('rejects %j', (providerId) => {
    expect(isDirectModelProvider(providerId)).toBe(false)
  })
})

describe('readAvailableKeys', () => {
  it('asks only for the provider column of the user keys', async () => {
    const { db, findMany } = createDb(['openai'])

    await readAvailableKeys(7, db as never, createGrantedLegalConsentRecord())

    expect(findMany).toHaveBeenCalledWith({
      where: { userId: 7 },
      columns: { provider: true },
    })
  })

  it('returns the saved provider ids once each', async () => {
    const { db } = createDb(['openai', 'openai', 'anthropic'])

    const keys = await readAvailableKeys(
      1,
      db as never,
      createGrantedLegalConsentRecord(),
    )

    expect([...keys].sort()).toEqual(['anthropic', 'openai'])
  })

  it('drops providers whose transfer consent is missing', async () => {
    const { db } = createDb(['openai', 'deepseek', 'moonshotai', 'qwen'])

    const keys = await readAvailableKeys(1, db as never, noConsent())

    expect([...keys]).toEqual(['openai'])
  })

  it('keeps transfer providers with consent', async () => {
    const { db } = createDb(['openai', 'deepseek', 'moonshotai', 'qwen'])

    const keys = await readAvailableKeys(
      1,
      db as never,
      createGrantedLegalConsentRecord(),
    )

    expect([...keys].sort()).toEqual([
      'deepseek',
      'moonshotai',
      'openai',
      'qwen',
    ])
  })

  it('drops a provider whose consent was withdrawn', async () => {
    const { db } = createDb(['deepseek'])

    const keys = await readAvailableKeys(
      1,
      db as never,
      createGrantedLegalConsentRecord({
        providerTransferConsents: {
          deepseek: { consentedAt: 1000, withdrawnAt: 2000 },
        },
      }),
    )

    expect(keys.size).toBe(0)
  })

  it('keeps gateway key ids under their own names', async () => {
    const { db } = createDb(['vercel-gateway', 'openai'])

    const keys = await readAvailableKeys(1, db as never, noConsent())

    expect(keys.has('vercel-gateway')).toBe(true)
    expect(keys.has('openai')).toBe(true)
  })

  it('returns an empty set for a user without keys', async () => {
    const { db } = createDb([])

    const keys = await readAvailableKeys(1, db as never, noConsent())

    expect(keys.size).toBe(0)
  })
})

describe('resolveCheapestDirectModel', () => {
  beforeEach(() => {
    mocks.unusableModelIds.clear()
  })

  it.each(Object.entries(CHEAPEST_BY_PROVIDER))(
    'picks the cheap %s model flagged for project memory',
    (providerId, modelId) => {
      const resolved = resolveCheapestDirectModel(new Set([providerId]))

      expect(resolved).toMatchObject({ providerId, modelId })
      expect(resolved?.modelName).toEqual(expect.any(String))
    },
  )

  it('returns the name from the catalog', () => {
    const catalogModel = providers
      .find((provider) => {
        return provider.id === 'openai'
      })
      ?.models.find((model) => {
        return model.id === CHEAPEST_BY_PROVIDER.openai
      })

    expect(resolveCheapestDirectModel(new Set(['openai']))).toEqual({
      providerId: 'openai',
      modelId: CHEAPEST_BY_PROVIDER.openai,
      modelName: catalogModel?.name,
    })
  })

  it('follows the provider order, not the key order', () => {
    const resolved = resolveCheapestDirectModel(
      new Set(['xai', 'google', 'anthropic', 'openai']),
    )

    expect(resolved?.providerId).toBe('openai')
  })

  it('skips providers without a key', () => {
    const resolved = resolveCheapestDirectModel(new Set(['google', 'xai']))

    expect(resolved?.providerId).toBe('google')
  })

  it('returns null without any direct key', () => {
    expect(resolveCheapestDirectModel(new Set())).toBeNull()
  })

  it('ignores gateway keys', () => {
    expect(resolveCheapestDirectModel(
      new Set(['vercel-gateway', 'openrouter', 'cloudflare-gateway']),
    )).toBeNull()
  })

  it('falls to the next provider when the cheap model is not usable', () => {
    mocks.unusableModelIds.add(CHEAPEST_BY_PROVIDER.openai)

    const resolved = resolveCheapestDirectModel(
      new Set(['openai', 'anthropic']),
    )

    expect(resolved).toMatchObject({
      providerId: 'anthropic',
      modelId: CHEAPEST_BY_PROVIDER.anthropic,
    })
  })

  it('returns null when the only cheap model is not usable', () => {
    mocks.unusableModelIds.add(CHEAPEST_BY_PROVIDER.xai)

    expect(resolveCheapestDirectModel(new Set(['xai']))).toBeNull()
  })

  it('only ever returns a catalog model with the cheap flag', () => {
    for (const providerId of DIRECT_MODEL_PROVIDER_ORDER) {
      const resolved = resolveCheapestDirectModel(new Set([providerId]))
      const catalogModel = providers
        .find((provider) => {
          return provider.id === providerId
        })
        ?.models.find((model) => {
          return model.id === resolved?.modelId
        })

      expect(catalogModel?.forProjectMemory).toBe(true)
    }
  })
})

describe('instantiateDirectModel', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function stubFactory(
    factoryName: string,
    reasoning: 'low' | 'medium' | 'high' | undefined = undefined,
  ) {
    const factory = vi.fn(async () => {
      return {
        instance: { id: `${factoryName}-model` },
        reasoning,
        providerOptions: { flag: factoryName },
      }
    })

    vi.stubGlobal(factoryName, factory)

    return factory
  }

  it('builds an OpenAI model with low reasoning and wrapped options',
    async () => {
      const factory = stubFactory('useOpenAI', 'low')

      const instance = await instantiateDirectModel('openai', 'gpt-x', 7)

      expect(factory).toHaveBeenCalledWith('7', 'gpt-x', [], 'low')
      expect(instance).toEqual({
        model: { id: 'useOpenAI-model' },
        reasoning: 'low',
        providerOptions: { openai: { flag: 'useOpenAI' } },
      })
    })

  it.each([
    ['google', 'useGoogle'],
    ['anthropic', 'useAnthropic'],
    ['xai', 'useXai'],
    ['deepseek', 'useDeepSeek'],
    ['moonshotai', 'useMoonshotAi'],
    ['qwen', 'useQwen'],
  ])('builds a %s model with reasoning off and no files', async (
    providerId,
    factoryName,
  ) => {
    const factory = stubFactory(factoryName)

    const instance = await instantiateDirectModel(providerId, 'some-model', 9)

    expect(factory).toHaveBeenCalledWith('9', 'some-model', [], 'off')
    expect(instance).toEqual({
      model: { id: `${factoryName}-model` },
      reasoning: undefined,
      providerOptions: { [providerId]: { flag: factoryName } },
    })
  })

  it('stringifies the user id for the provider factory', async () => {
    const factory = stubFactory('useAnthropic')

    await instantiateDirectModel('anthropic', 'model', 1234)

    expect(factory.mock.calls[0]![0]).toBe('1234')
  })

  it.each(['vercel-gateway', 'openrouter', 'unknown', null])(
    'throws 400 for %j',
    async (providerId) => {
      await expect(instantiateDirectModel(providerId, 'model', 1))
        .rejects.toMatchObject({ status: 400 })
    },
  )

  it('lets a factory failure through unchanged', async () => {
    vi.stubGlobal('useOpenAI', vi.fn(async () => {
      throw new Error('No key saved')
    }))

    await expect(instantiateDirectModel('openai', 'model', 1))
      .rejects.toThrow('No key saved')
  })
})
