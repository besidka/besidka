import { exceptionMessage } from '~~/server/utils/evlog-attributes'
import { resolveServerLogger } from '~~/server/utils/files/logger'

const ENDED_REQUEST_PROMISE_MESSAGE
  = 'created by a request that has since ended'

interface SettledInstanceCacheOptions<Instance extends object> {
  create: () => Instance
  whenReady: (instance: Instance) => Promise<unknown>
  resolveRequestScope: () => object | null
}

export interface SettledInstanceCache<Instance extends object> {
  get: () => Instance
  drop: () => void
}

export function isEndedRequestPromiseError(exception: unknown): boolean {
  return exceptionMessage(exception).includes(ENDED_REQUEST_PROMISE_MESSAGE)
}

/**
 * Caches an instance whose initialization is asynchronous without ever
 * handing one request a promise that another request created. On Workers a
 * promise that waits on I/O belongs to the request that started it: when that
 * request ends first, the promise never settles and every later request that
 * awaits it fails with "created by a request that has since ended". So an
 * instance is shared across requests only after `whenReady` has settled.
 * Until then each request builds and awaits its own, memoized for the rest of
 * that request, and the first one to become ready is published.
 */
export function createSettledInstanceCache<Instance extends object>(
  options: SettledInstanceCacheOptions<Instance>,
): SettledInstanceCache<Instance> {
  let settledInstance: Instance | undefined
  const pendingByRequest = new WeakMap<object, Instance>()

  async function publishWhenReady(instance: Instance): Promise<void> {
    try {
      await options.whenReady(instance)
    } catch {
      return
    }

    settledInstance ??= instance
  }

  function createPending(): Instance {
    const instance = options.create()

    publishWhenReady(instance)

    return instance
  }

  function get(): Instance {
    if (settledInstance) {
      return settledInstance
    }

    const requestScope = options.resolveRequestScope()

    if (!requestScope) {
      return createPending()
    }

    const pending = pendingByRequest.get(requestScope)

    if (pending) {
      return pending
    }

    const instance = createPending()

    pendingByRequest.set(requestScope, instance)

    return instance
  }

  function drop(): void {
    settledInstance = undefined

    const requestScope = options.resolveRequestScope()

    if (requestScope) {
      pendingByRequest.delete(requestScope)
    }
  }

  return { get, drop }
}

/**
 * Runs an operation that awaits a cached instance and, when it fails because
 * a promise inside that instance belonged to a request that has ended, drops
 * the cache and runs it once more against a fresh instance. `canRetry` lets a
 * caller refuse the second run, for example once a request body was read.
 */
export async function retryOnEndedRequestPromise<Result>(
  operation: () => Promise<Result>,
  recover: () => void,
  canRetry: () => boolean = () => true,
): Promise<Result> {
  try {
    return await operation()
  } catch (exception) {
    if (!isEndedRequestPromiseError(exception)) {
      throw exception
    }

    recover()

    const retried = canRetry()

    resolveServerLogger().set({
      attributes: { authInit: { endedRequestPromise: true, retried } },
    })

    if (!retried) {
      throw exception
    }

    return await operation()
  }
}
