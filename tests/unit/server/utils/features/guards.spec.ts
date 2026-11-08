import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  logger: { set: vi.fn() },
  writeDataPoint: vi.fn(),
  batch: vi.fn(),
  kvGet: vi.fn(),
  runtimeConfig: {} as Record<string, unknown>,
  unauthorized: vi.fn(() => {
    throw Object.assign(new Error('unauthorized'), { status: 401 })
  }),
}))

vi.mock('~~/server/utils/logging/request-logger', () => ({
  useRequestLogger: () => mocks.logger,
}))

vi.mock('~~/server/utils/features/evaluate', async (importOriginal) => {
  const original = await importOriginal<
    typeof import('~~/server/utils/features/evaluate')
  >()

  return {
    ...original,
    getFeatureEvaluationConfig: () => {
      return original.getFeatureEvaluationConfig(mocks.runtimeConfig)
    },
  }
})

interface FakeUser {
  email: string
  emailVerified: boolean
  twoFactorEnabled: boolean
  roles?: string[]
}

function createQuery() {
  const query = {
    from: () => query,
    where: () => query,
    limit: () => query,
  }

  return query
}

function stubRuntime(options: {
  user?: FakeUser | null
  userId?: number
  runtimeConfig?: Record<string, unknown>
} = {}) {
  const user = options.user ?? null

  mocks.batch.mockResolvedValue(user
    ? [
      [user],
      (user.roles ?? []).map((role) => {
        return { role }
      }),
      [],
      [],
    ]
    : [[], [], [], []])
  mocks.kvGet.mockResolvedValue('[]')

  vi.stubGlobal('useDb', () => ({
    select: vi.fn(createQuery),
    batch: mocks.batch,
  }))
  vi.stubGlobal('useKV', () => ({
    get: mocks.kvGet,
    put: vi.fn(),
    delete: vi.fn(),
  }))
  vi.stubGlobal('useUserSession', async () => {
    return user ? { user: { id: String(options.userId ?? 7) } } : null
  })
  vi.stubGlobal('useAnalytics', () => ({
    writeDataPoint: mocks.writeDataPoint,
  }))
  mocks.runtimeConfig = {
    adminEmails: 'owner@example.com',
    featuresDisabled: '',
    featuresHostMode: 'byok',
    featuresRolloutEnabled: false,
    ...options.runtimeConfig,
  }
  vi.stubGlobal('useUnauthorizedError', mocks.unauthorized)
}

async function importGuards() {
  return import('~~/server/utils/features/guards')
}

function createEvent() {
  return { context: {} } as never
}

describe('requireFeature', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('throws a 404 with why feature_unavailable when off', async () => {
    stubRuntime({
      user: {
        email: 'user@example.com',
        emailVerified: true,
        twoFactorEnabled: false,
      },
    })

    const { requireFeature } = await importGuards()

    await expect(requireFeature(createEvent(), 'artifacts'))
      .rejects.toMatchObject({
        status: 404,
        message: 'Not found',
        why: 'feature_unavailable',
      })
  })

  it('lets an env admin with a verified email through', async () => {
    stubRuntime({
      user: {
        email: 'owner@example.com',
        emailVerified: true,
        twoFactorEnabled: true,
      },
    })

    const { requireFeature } = await importGuards()

    await expect(requireFeature(createEvent(), 'artifacts'))
      .resolves.toMatchObject({ value: true, reason: 'ROLE', active: true })
  })

  it('rejects an env admin email that is not verified', async () => {
    stubRuntime({
      user: {
        email: 'owner@example.com',
        emailVerified: false,
        twoFactorEnabled: true,
      },
    })

    const { requireFeature } = await importGuards()

    await expect(requireFeature(createEvent(), 'artifacts'))
      .rejects.toMatchObject({ status: 404 })
  })

  it('needs an opt-in for a spending feature by default', async () => {
    stubRuntime({
      user: {
        email: 'owner@example.com',
        emailVerified: true,
        twoFactorEnabled: true,
      },
    })

    const { requireFeature } = await importGuards()

    await expect(requireFeature(createEvent(), 'research.custom'))
      .rejects.toMatchObject({ status: 404 })
    await expect(requireFeature(createEvent(), 'research.custom', {
      active: true,
    })).rejects.toMatchObject({ status: 404 })
    await expect(requireFeature(createEvent(), 'research.custom', {
      active: false,
    })).resolves.toMatchObject({ value: true, active: false })
  })

  it('loads the user state once per request', async () => {
    stubRuntime({
      user: {
        email: 'owner@example.com',
        emailVerified: true,
        twoFactorEnabled: true,
      },
    })

    const { requireFeature } = await importGuards()
    const event = createEvent()

    await requireFeature(event, 'artifacts')
    await requireFeature(event, 'documents')

    expect(mocks.batch).toHaveBeenCalledTimes(1)
    expect(mocks.kvGet).toHaveBeenCalledTimes(1)
  })
})

describe('requireAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('answers 401 when signed out', async () => {
    stubRuntime({ user: null })

    const { requireAdmin } = await importGuards()

    await expect(requireAdmin(createEvent()))
      .rejects.toMatchObject({ status: 401 })
  })

  it('answers 404 to a signed-in non-admin', async () => {
    stubRuntime({
      user: {
        email: 'user@example.com',
        emailVerified: true,
        twoFactorEnabled: true,
      },
    })

    const { requireAdmin } = await importGuards()

    await expect(requireAdmin(createEvent())).rejects.toMatchObject({
      status: 404,
      why: 'feature_unavailable',
    })
  })

  it('accepts an admin role row', async () => {
    stubRuntime({
      user: {
        email: 'user@example.com',
        emailVerified: true,
        twoFactorEnabled: true,
        roles: ['admin'],
      },
    })

    const { requireAdmin } = await importGuards()

    await expect(requireAdmin(createEvent()))
      .resolves.toMatchObject({ isAdmin: true, userId: 7 })
  })
})
