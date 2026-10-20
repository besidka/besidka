import { beforeEach, describe, expect, it, vi } from 'vitest'
import { enforceKeysRateLimit } from '../../../server/utils/keys-rate-limit'

const activationMocks = vi.hoisted(() => ({
  recordFirstProviderKeyActivation: vi.fn(async () => undefined),
}))

vi.mock('~~/server/utils/analytics/activation', () => activationMocks)

function createFakeKv() {
  const store = new Map<string, string>()

  return {
    async get(key: string) {
      return store.get(key) ?? null
    },
    async put(key: string, value: string) {
      store.set(key, value)
    },
    async delete(key: string) {
      store.delete(key)
    },
  }
}

function createDbMock(hasExistingKey: boolean) {
  const where = vi.fn().mockImplementation(async () => undefined)

  return {
    query: {
      keys: {
        findFirst: vi.fn().mockImplementation(async () => {
          return hasExistingKey ? { apiKey: 'encrypted:old' } : undefined
        }),
      },
    },
    insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where })) })),
    delete: vi.fn(() => ({ where })),
  }
}

function createRequestEvent(body?: unknown) {
  const logger = { set: vi.fn() }

  return {
    logger,
    event: { body, context: { log: logger } },
  }
}

async function getPostHandler() {
  const module = await import(
    '../../../server/api/v1/profiles/keys/openrouter/index.post'
  )

  return module.default
}

async function getDeleteHandler() {
  const module = await import(
    '../../../server/api/v1/profiles/keys/openrouter/index.delete'
  )

  return module.default
}

describe('key API request logger attributes', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.unstubAllGlobals()

    const fakeKv = createFakeKv()

    vi.stubGlobal('defineEventHandler', (handler: any) => handler)
    vi.stubGlobal('enforceKeysRateLimit', enforceKeysRateLimit)
    vi.stubGlobal('useKV', () => fakeKv)
    vi.stubGlobal('setResponseStatus', vi.fn())
    vi.stubGlobal('useEncryptText', vi.fn(async (plain: string) => {
      return `encrypted:${plain}`
    }))
    vi.stubGlobal('useUnauthorizedError', () => {
      throw new Error('Unauthorized')
    })
    vi.stubGlobal(
      'readValidatedBody',
      async (event: any, parser: (body: unknown) => unknown) => {
        return parser(event.body)
      },
    )
    vi.stubGlobal('useUserSession', vi.fn().mockResolvedValue({
      user: { id: '1' },
    }))
  })

  function stubRequest(event: unknown, hasExistingKey: boolean) {
    vi.stubGlobal('useEvent', () => event)
    vi.stubGlobal('useDb', () => createDbMock(hasExistingKey))
  }

  it('puts keys.provider and keys.action on the wide event when a key '
    + 'is created', async () => {
    const { event, logger } = createRequestEvent({ apiKey: 'sk-or-new' })

    stubRequest(event, false)

    const handler = await getPostHandler()

    await handler(event as any)

    expect(logger.set).toHaveBeenCalledExactlyOnceWith({
      attributes: { keys: { provider: 'openrouter', action: 'created' } },
    })
  })

  it('logs the updated action when a key is replaced', async () => {
    const { event, logger } = createRequestEvent({ apiKey: 'sk-or-new' })

    stubRequest(event, true)

    const handler = await getPostHandler()

    await handler(event as any)

    expect(logger.set).toHaveBeenCalledExactlyOnceWith({
      attributes: { keys: { provider: 'openrouter', action: 'updated' } },
    })
  })

  it('logs the deleted action when a key is removed', async () => {
    const { event, logger } = createRequestEvent()

    stubRequest(event, true)

    const handler = await getDeleteHandler()

    await handler(event as any)

    expect(logger.set).toHaveBeenCalledExactlyOnceWith({
      attributes: { keys: { provider: 'openrouter', action: 'deleted' } },
    })
  })
})
