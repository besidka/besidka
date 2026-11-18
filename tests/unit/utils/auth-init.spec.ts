import { beforeEach, describe, expect, it, vi } from 'vitest'

interface FakeAuth {
  id: number
  $context: Promise<{ checkSchema?: () => Promise<void> | undefined }>
  resolveContext: () => void
}

const mocks = vi.hoisted(() => ({
  instances: [] as Array<{
    id: number
    resolveContext: () => void
  }>,
  checkSchema: undefined as (() => Promise<void> | undefined) | undefined,
}))

vi.mock('better-auth', () => ({
  betterAuth: () => {
    let resolveContext: () => void = () => {}
    const $context = new Promise((resolve) => {
      resolveContext = () => resolve({ checkSchema: mocks.checkSchema })
    })
    const instance = {
      id: mocks.instances.length + 1,
      $context,
      resolveContext,
    }

    mocks.instances.push(instance)

    return instance
  },
}))

function stubBindings() {
  vi.stubGlobal('useRuntimeConfig', () => ({
    betterAuthSecret: 'secret',
    public: { baseUrl: 'https://example.com' },
  }))
  vi.stubGlobal('useDb', () => ({}))
  vi.stubGlobal('useKV', () => ({}))
  vi.stubGlobal('getCaptchaOptions', () => null)
  vi.stubGlobal('authRateLimitDefaults', { window: 60, max: 60 })
  vi.stubGlobal('authRateLimitRules', {})
  vi.stubGlobal('createAuthRateLimitStorage', () => ({}))
  vi.stubGlobal('createAuthSecondaryStorage', () => ({}))
}

async function flushMicrotasks(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

async function importAuth() {
  vi.resetModules()
  stubBindings()

  return await import('../../../server/utils/auth')
}

function inRequest<Result>(request: object, run: () => Result): Result {
  vi.stubGlobal('useEvent', () => request)

  return run()
}

describe('useServerAuth initialization', () => {
  beforeEach(() => {
    mocks.instances.length = 0
    mocks.checkSchema = undefined
  })

  it('never hands the next request an init that an ended request started',
    async () => {
      const { useServerAuth } = await importAuth()

      const orphaned = inRequest({}, useServerAuth) as unknown as FakeAuth
      const next = inRequest({}, useServerAuth) as unknown as FakeAuth

      expect(next).not.toBe(orphaned)

      next.resolveContext()
      await flushMicrotasks()

      expect(inRequest({}, useServerAuth)).toBe(next)
      expect(mocks.instances).toHaveLength(2)
    })

  it('keeps one instance per request while its init is pending', async () => {
    const { useServerAuth } = await importAuth()
    const request = {}

    expect(inRequest(request, useServerAuth))
      .toBe(inRequest(request, useServerAuth))
    expect(mocks.instances).toHaveLength(1)
  })

  it('lets concurrent first requests init on their own and shares the first '
    + 'one ready', async () => {
    const { useServerAuth } = await importAuth()

    const first = inRequest({}, useServerAuth) as unknown as FakeAuth
    const second = inRequest({}, useServerAuth) as unknown as FakeAuth

    second.resolveContext()
    first.resolveContext()
    await flushMicrotasks()

    expect(inRequest({}, useServerAuth)).toBe(second)
  })

  it('waits for the schema check before sharing an instance', async () => {
    let finishSchemaCheck: () => void = () => {}
    const schemaCheck = new Promise<void>((resolve) => {
      finishSchemaCheck = resolve
    })

    mocks.checkSchema = () => schemaCheck

    const { useServerAuth } = await importAuth()
    const first = inRequest({}, useServerAuth) as unknown as FakeAuth

    first.resolveContext()
    await flushMicrotasks()

    expect(inRequest({}, useServerAuth)).not.toBe(first)

    finishSchemaCheck()
    await flushMicrotasks()

    expect(inRequest({}, useServerAuth)).toBe(first)
  })

  it('builds a fresh instance after dropServerAuth', async () => {
    const { useServerAuth, dropServerAuth } = await importAuth()
    const published = inRequest({}, useServerAuth) as unknown as FakeAuth

    published.resolveContext()
    await flushMicrotasks()
    inRequest({}, dropServerAuth)

    expect(inRequest({}, useServerAuth)).not.toBe(published)
  })
})
