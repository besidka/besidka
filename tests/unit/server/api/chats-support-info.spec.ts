import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

const mocks = vi.hoisted(() => ({
  connectorsActive: true,
  loggerSet: vi.fn(),
  getDebugInfo: vi.fn(),
  headers: new Map<string, string>(),
}))

vi.mock('~~/server/utils/features/context', () => ({
  evaluateFeatureForEvent: vi.fn(async () => ({
    active: mocks.connectorsActive,
  })),
}))

vi.mock('~~/server/utils/mcp/private/debug-info', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('~~/server/utils/mcp/private/debug-info')
  >()

  return {
    ...original,
    getDebugInfo: mocks.getDebugInfo,
    resolveDebugRuntime: () => ({
      siteUrl: 'https://besidka.com',
      buildId: 'build-abc',
      supportEmail: 'support@besidka.com',
    }),
  }
})

const OWNER_ID = 7
const SLUG = '01ARZ3NDEKTSV4RRFFQ69G5FAV'
const DB = { marker: 'db' }
const kvStore = new Map<string, string>()
const KV = {
  marker: 'kv',
  get: async (key: string) => kvStore.get(key) ?? null,
  put: async (key: string, value: string) => {
    kvStore.set(key, value)
  },
}
const INFO = {
  generatedAt: '2026-11-20T10:00:00.000Z',
  app: { buildId: 'build-abc', mcpServerVersion: '5.3.0' },
  chat: {
    slug: SLUG,
    url: `https://besidka.com/chats/${SLUG}`,
    projectId: null,
    branchedFromShare: false,
    memoryExcluded: false,
    createdAt: null,
    activityAt: null,
    pendingApprovals: 0,
    generationLeases: [],
    messages: [],
  },
  connectors: [],
  connectorsNote: null,
  features: [],
  contact: 'Send this block to support@besidka.com.',
}

async function loadHandler() {
  const module = await import('~~/server/api/v1/chats/[slug]/support-info.get')

  return module.default as unknown as (
    event: object,
  ) => Promise<Record<string, any>>
}

function createEvent(slug: string) {
  return {
    params: { slug },
    context: {},
    res: {
      headers: {
        set: (name: string, value: string) => mocks.headers.set(name, value),
      },
    },
  }
}

function stubServerGlobals(session: { user: { id: string } } | null) {
  vi.stubGlobal('defineEventHandler', (handler: unknown) => handler)
  vi.stubGlobal('z', z)
  vi.stubGlobal('useDb', () => DB)
  vi.stubGlobal('useKV', () => KV)
  vi.stubGlobal('useUserSession', async () => session)
  vi.stubGlobal('useRequestLogger', () => ({ set: mocks.loggerSet }))
  vi.stubGlobal('getRouterParams', (event: { params: unknown }) => {
    return event.params
  })
  vi.stubGlobal('useUnauthorizedError', async () => {
    const { createError } = await import('evlog')

    throw createError({ message: 'Unauthorized', status: 401 })
  })
}

describe('GET /api/v1/chats/[slug]/support-info', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.loggerSet.mockReset()
    mocks.getDebugInfo.mockReset()
    mocks.getDebugInfo.mockResolvedValue(INFO)
    mocks.headers.clear()
    kvStore.clear()
    mocks.connectorsActive = true
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the plain-text report of the signed-in owner', async () => {
    stubServerGlobals({ user: { id: String(OWNER_ID) } })

    const handler = await loadHandler()
    const response = await handler(createEvent(SLUG))

    expect(Object.keys(response)).toEqual(['report'])
    expect(response.report).toContain('Besidka debug info')
    expect(response.report).toContain(`Chat URL: https://besidka.com/chats/${SLUG}`)
    expect(response.report).toContain('Send this block to support@besidka.com.')
  })

  it('reads the owner chat with connectors and features included', async () => {
    stubServerGlobals({ user: { id: String(OWNER_ID) } })

    const handler = await loadHandler()

    await handler(createEvent(SLUG))

    expect(mocks.getDebugInfo).toHaveBeenCalledWith(
      DB,
      KV,
      OWNER_ID,
      expect.objectContaining({
        slug: SLUG,
        maxMessages: 10,
        includeConnectors: true,
        includeFeatures: true,
        supportEmail: 'support@besidka.com',
      }),
      expect.anything(),
    )
  })

  it('leaves connectors out while the connectors feature is off', async () => {
    mocks.connectorsActive = false
    stubServerGlobals({ user: { id: String(OWNER_ID) } })

    const handler = await loadHandler()

    await handler(createEvent(SLUG))

    expect(mocks.getDebugInfo.mock.calls[0]?.[3]).toMatchObject({
      includeConnectors: false,
      includeFeatures: true,
    })
  })

  it('is never cached', async () => {
    stubServerGlobals({ user: { id: String(OWNER_ID) } })

    const handler = await loadHandler()

    await handler(createEvent(SLUG))

    expect(mocks.headers.get('cache-control')).toBe('private, no-store')
  })

  it('answers 401 without a session', async () => {
    stubServerGlobals(null)

    const handler = await loadHandler()

    await expect(handler(createEvent(SLUG)))
      .rejects.toMatchObject({ status: 401 })
    expect(mocks.getDebugInfo).not.toHaveBeenCalled()
  })

  it('answers 400 for a malformed slug', async () => {
    stubServerGlobals({ user: { id: String(OWNER_ID) } })

    const handler = await loadHandler()

    await expect(handler(createEvent('not-a-slug')))
      .rejects.toMatchObject({ status: 400 })
    expect(mocks.getDebugInfo).not.toHaveBeenCalled()
  })

  it('passes a 404 for a chat the user does not own', async () => {
    const { createError } = await import('evlog')

    mocks.getDebugInfo.mockRejectedValue(
      createError({ message: 'No chat', status: 404 }),
    )
    stubServerGlobals({ user: { id: String(OWNER_ID) } })

    const handler = await loadHandler()

    await expect(handler(createEvent(SLUG)))
      .rejects.toMatchObject({ status: 404 })
  })

  it('answers 429 past 30 reports a minute and sets Retry-After', async () => {
    stubServerGlobals({ user: { id: String(OWNER_ID) } })

    const handler = await loadHandler()

    for (let run = 0; run < 30; run++) {
      await handler(createEvent(SLUG))
    }

    expect(mocks.getDebugInfo).toHaveBeenCalledTimes(30)

    await expect(handler(createEvent(SLUG)))
      .rejects.toMatchObject({ status: 429 })
    expect(mocks.getDebugInfo).toHaveBeenCalledTimes(30)
    expect(Number(mocks.headers.get('Retry-After'))).toBeGreaterThan(0)
  })

  it('counts each user on their own', async () => {
    stubServerGlobals({ user: { id: String(OWNER_ID) } })

    const handler = await loadHandler()

    for (let run = 0; run < 30; run++) {
      await handler(createEvent(SLUG))
    }

    vi.stubGlobal('useUserSession', async () => ({ user: { id: '8' } }))

    await expect(handler(createEvent(SLUG))).resolves.toBeDefined()
  })
})
