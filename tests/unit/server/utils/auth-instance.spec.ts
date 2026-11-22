import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createSettledInstanceCache,
  isEndedRequestPromiseError,
  retryOnEndedRequestPromise,
  runOnceAfterInit,
} from '~~/server/utils/auth-instance'

const mocks = vi.hoisted(() => ({
  loggerSet: vi.fn(),
}))

vi.mock('~~/server/utils/files/logger', () => ({
  resolveServerLogger: () => ({ set: mocks.loggerSet }),
}))

const WORKERD_ENDED_REQUEST_MESSAGE = 'Cannot perform I/O on behalf of a '
  + 'different request. This promise was created by a request that has '
  + 'since ended, so it can never settle.'

interface FakeInstance {
  id: number
  ready: Promise<void>
  settle: () => void
  fail: (reason: Error) => void
}

function createInstanceFactory() {
  const instances: FakeInstance[] = []

  function create(): FakeInstance {
    let settle: () => void = () => {}
    let fail: (reason: Error) => void = () => {}
    const ready = new Promise<void>((resolve, reject) => {
      settle = resolve
      fail = reject
    })
    const instance = { id: instances.length + 1, ready, settle, fail }

    instances.push(instance)

    return instance
  }

  return { instances, create }
}

async function flushMicrotasks(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0))
}

function createCacheHarness() {
  const factory = createInstanceFactory()
  let currentRequest: object | null = null
  const cache = createSettledInstanceCache<FakeInstance>({
    create: factory.create,
    whenReady: instance => instance.ready,
    resolveRequestScope: () => currentRequest,
  })

  function inRequest<Result>(request: object, run: () => Result): Result {
    currentRequest = request

    try {
      return run()
    } finally {
      currentRequest = null
    }
  }

  return { cache, factory, inRequest }
}

describe('createSettledInstanceCache', () => {
  it('never hands a later request the instance an ended request started',
    async () => {
      const { cache, factory, inRequest } = createCacheHarness()
      const endedRequest = {}
      const nextRequest = {}

      const orphaned = inRequest(endedRequest, () => cache.get())
      const fresh = inRequest(nextRequest, () => cache.get())

      expect(fresh).not.toBe(orphaned)
      expect(factory.instances).toHaveLength(2)

      fresh.settle()
      await flushMicrotasks()

      expect(inRequest({}, () => cache.get())).toBe(fresh)
      expect(factory.instances).toHaveLength(2)
    })

  it('reuses one pending instance within the request that created it', () => {
    const { cache, factory, inRequest } = createCacheHarness()
    const request = {}

    const first = inRequest(request, () => cache.get())
    const second = inRequest(request, () => cache.get())

    expect(second).toBe(first)
    expect(factory.instances).toHaveLength(1)
  })

  it('lets concurrent first requests each init and publishes the first ready',
    async () => {
      const { cache, factory, inRequest } = createCacheHarness()

      const first = inRequest({}, () => cache.get())
      const second = inRequest({}, () => cache.get())

      expect(first).not.toBe(second)

      second.settle()
      first.settle()
      await flushMicrotasks()

      expect(inRequest({}, () => cache.get())).toBe(second)
      expect(cache.get()).toBe(second)
      expect(factory.instances).toHaveLength(2)
    })

  it('builds a fresh instance per call outside a request until one is ready',
    async () => {
      const { cache, factory } = createCacheHarness()

      const first = cache.get()
      const second = cache.get()

      expect(second).not.toBe(first)

      first.settle()
      await flushMicrotasks()

      expect(cache.get()).toBe(first)
      expect(factory.instances).toHaveLength(2)
    })

  it('never publishes an instance whose initialization failed', async () => {
    const { cache, factory, inRequest } = createCacheHarness()

    const failed = inRequest({}, () => cache.get())

    failed.fail(new Error('init failed'))
    await flushMicrotasks()

    expect(inRequest({}, () => cache.get())).not.toBe(failed)
    expect(factory.instances).toHaveLength(2)
  })

  it('drops the published instance so the next request builds a new one',
    async () => {
      const { cache, factory, inRequest } = createCacheHarness()

      const published = inRequest({}, () => cache.get())

      published.settle()
      await flushMicrotasks()
      cache.drop()

      const replacement = inRequest({}, () => cache.get())

      expect(replacement).not.toBe(published)
      expect(factory.instances).toHaveLength(2)
    })
})

describe('isEndedRequestPromiseError', () => {
  it('matches the workerd cross-request promise error', () => {
    expect(isEndedRequestPromiseError(
      new Error(WORKERD_ENDED_REQUEST_MESSAGE),
    )).toBe(true)
  })

  it('ignores other errors', () => {
    expect(isEndedRequestPromiseError(new Error('D1 unavailable'))).toBe(false)
    expect(isEndedRequestPromiseError(null)).toBe(false)
  })
})

describe('retryOnEndedRequestPromise', () => {
  beforeEach(() => {
    mocks.loggerSet.mockClear()
  })

  it('drops the cache and retries once after the workerd error', async () => {
    const recover = vi.fn()
    const operation = vi.fn()
      .mockRejectedValueOnce(new Error(WORKERD_ENDED_REQUEST_MESSAGE))
      .mockResolvedValueOnce('session')

    await expect(retryOnEndedRequestPromise(operation, recover))
      .resolves.toBe('session')
    expect(recover).toHaveBeenCalledTimes(1)
    expect(operation).toHaveBeenCalledTimes(2)
    expect(mocks.loggerSet).toHaveBeenCalledWith({
      attributes: { authInit: { endedRequestPromise: true, retried: true } },
    })
  })

  it('retries only once', async () => {
    const recover = vi.fn()
    const operation = vi.fn()
      .mockRejectedValue(new Error(WORKERD_ENDED_REQUEST_MESSAGE))

    await expect(retryOnEndedRequestPromise(operation, recover))
      .rejects.toThrow('since ended')
    expect(operation).toHaveBeenCalledTimes(2)
  })

  it('rethrows any other error without dropping the cache', async () => {
    const recover = vi.fn()
    const operation = vi.fn().mockRejectedValue(new Error('D1 unavailable'))

    await expect(retryOnEndedRequestPromise(operation, recover))
      .rejects.toThrow('D1 unavailable')
    expect(recover).not.toHaveBeenCalled()
    expect(operation).toHaveBeenCalledTimes(1)
  })
})

describe('runOnceAfterInit', () => {
  beforeEach(() => {
    mocks.loggerSet.mockClear()
  })

  it('retries only the init wait, then runs the handler once', async () => {
    const recover = vi.fn()
    const waitForInit = vi.fn()
      .mockRejectedValueOnce(new Error(WORKERD_ENDED_REQUEST_MESSAGE))
      .mockResolvedValueOnce(undefined)
    const handler = vi.fn().mockResolvedValue('response')

    await expect(runOnceAfterInit(waitForInit, handler, recover))
      .resolves.toBe('response')
    expect(waitForInit).toHaveBeenCalledTimes(2)
    expect(recover).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('never runs a handler twice after a side effect, even on the workerd '
    + 'error', async () => {
    const recover = vi.fn()
    const sideEffect = vi.fn()
    const handler = vi.fn(async () => {
      sideEffect()

      throw new Error(WORKERD_ENDED_REQUEST_MESSAGE)
    })

    await expect(runOnceAfterInit(async () => {}, handler, recover))
      .rejects.toThrow('since ended')
    expect(handler).toHaveBeenCalledTimes(1)
    expect(sideEffect).toHaveBeenCalledTimes(1)
    expect(recover).toHaveBeenCalledTimes(1)
    expect(mocks.loggerSet).toHaveBeenCalledWith({
      attributes: {
        authInit: { endedRequestPromise: true, retried: false },
      },
    })
  })

  it('rethrows other handler errors without dropping the cache', async () => {
    const recover = vi.fn()
    const handler = vi.fn().mockRejectedValue(new Error('D1 unavailable'))

    await expect(runOnceAfterInit(async () => {}, handler, recover))
      .rejects.toThrow('D1 unavailable')
    expect(recover).not.toHaveBeenCalled()
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('does not run the handler when init keeps failing', async () => {
    const handler = vi.fn()
    const waitForInit = vi.fn()
      .mockRejectedValue(new Error(WORKERD_ENDED_REQUEST_MESSAGE))

    await expect(runOnceAfterInit(waitForInit, handler, vi.fn()))
      .rejects.toThrow('since ended')
    expect(waitForInit).toHaveBeenCalledTimes(2)
    expect(handler).not.toHaveBeenCalled()
  })
})
