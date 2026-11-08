import { describe, expect, it, vi } from 'vitest'
import type { FeatureRequestContext } from '~~/server/utils/features/context'
import type { FeatureUserState } from '~~/server/utils/features/provider'
import {
  FEATURE_KEYS,
  FEATURE_REGISTRY,
} from '#shared/utils/features/registry'

const mocks = vi.hoisted(() => ({
  context: null as FeatureRequestContext | null,
}))

vi.mock('nuxt/server', () => ({
  defineEventHandler: (handler: unknown) => handler,
}))

vi.mock('~~/server/utils/features/context', () => ({
  useFeatureContext: async () => mocks.context,
}))

const config = {
  featuresDisabled: '',
  featuresHostMode: 'byok' as const,
  featuresRolloutEnabled: false,
  adminEmails: 'owner@example.com',
  requireAdminTwoFactor: false,
}

function createContext(
  userState: FeatureUserState | null,
  isAdmin = false,
): FeatureRequestContext {
  return {
    userId: userState?.userId ?? null,
    rules: {},
    userState,
    config,
    isAdmin,
    exposures: new Set(),
  }
}

const adminState: FeatureUserState = {
  userId: 1,
  email: 'owner@example.com',
  emailVerified: true,
  twoFactorEnabled: true,
  roles: [],
  grants: {},
  optIns: {},
}

async function callRoute() {
  const { default: handler } = await import(
    '~~/server/api/v1/features/index.get'
  )
  const event = { context: {}, res: { headers: new Headers() } }
  const body = await (handler as (input: unknown) => Promise<unknown>)(event)

  return { body: body as Record<string, any>, headers: event.res.headers }
}

const exposedKeys = FEATURE_KEYS.filter((key) => {
  return FEATURE_REGISTRY[key].exposeToClient
})

describe('GET /api/v1/features', () => {
  it('answers signed-out callers with 200 defaults and no-store', async () => {
    mocks.context = createContext(null)

    const { body, headers } = await callRoute()

    expect(headers.get('Cache-Control')).toBe('private, no-store')
    expect(body.isAdmin).toBe(false)
    expect(Object.keys(body.features).sort()).toEqual([...exposedKeys].sort())
    expect(body.features.artifacts).toEqual({
      enabled: false,
      active: false,
      variant: null,
    })
  })

  it('returns only flags exposed to the client', async () => {
    mocks.context = createContext(adminState, true)

    const { body } = await callRoute()

    expect(body.features).not.toHaveProperty(['artifacts.mcp'])
    expect(body.features).not.toHaveProperty(['documents.mcp'])
    expect(body.features).not.toHaveProperty(['research.mcp'])
    expect(body.features).toHaveProperty(['ui.side-panel-demo'])
  })

  it('reports the admin state and enabled internal flags', async () => {
    mocks.context = createContext(adminState, true)

    const { body } = await callRoute()

    expect(body.isAdmin).toBe(true)
    expect(body.features['ui.side-panel-demo']).toEqual({
      enabled: true,
      active: true,
      variant: null,
    })
    expect(body.features['research.custom']).toEqual({
      enabled: true,
      active: false,
      variant: null,
    })
  })

  it('records no exposure for a rollout decision', async () => {
    const writeDataPoint = vi.fn()

    vi.stubGlobal('useAnalytics', () => ({ writeDataPoint }))
    mocks.context = {
      ...createContext({ ...adminState, email: 'user@example.com' }),
      config: { ...config, featuresRolloutEnabled: true },
      rules: {
        'ui.side-panel-demo': {
          flag: 'ui.side-panel-demo',
          enabled: true,
          rolloutBps: 10_000,
          allowRoles: null,
          variants: null,
          salt: 'salt-a',
        },
      },
    }

    const { body } = await callRoute()

    expect(body.features['ui.side-panel-demo'].enabled).toBe(true)
    expect(writeDataPoint).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('leaks no bucket or reason to the client', async () => {
    mocks.context = createContext(adminState, true)

    const { body } = await callRoute()

    expect(JSON.stringify(body)).not.toMatch(/bucket|reason/)
  })
})
