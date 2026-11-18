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

function logEndedRequestPromise(retried: boolean): void {
  resolveServerLogger().set({
    attributes: { authInit: { endedRequestPromise: true, retried } },
  })
}

/**
 * Runs an operation that awaits a cached instance and, when it fails because
 * a promise inside that instance belonged to a request that has ended, drops
 * the cache and runs it once more against a fresh instance. Only for
 * operations that are safe to run twice, such as reading a session.
 */
export async function retryOnEndedRequestPromise<Result>(
  operation: () => Promise<Result>,
  recover: () => void,
): Promise<Result> {
  try {
    return await operation()
  } catch (exception) {
    if (!isEndedRequestPromiseError(exception)) {
      throw exception
    }

    recover()
    logEndedRequestPromise(true)

    return await operation()
  }
}

/**
 * Waits for the instance's init, retrying only that wait once after the
 * ended-request error, then runs `operation` exactly once. A handler run may
 * have side effects (sign-in, email, OAuth callbacks) before it fails, so it
 * is never repeated: the same error from it only drops the cache and is
 * rethrown.
 */
export async function runOnceAfterInit<Result>(
  waitForInit: () => Promise<unknown>,
  operation: () => Promise<Result>,
  recover: () => void,
): Promise<Result> {
  await retryOnEndedRequestPromise(waitForInit, recover)

  try {
    return await operation()
  } catch (exception) {
    if (isEndedRequestPromiseError(exception)) {
      recover()
      logEndedRequestPromise(false)
    }

    throw exception
  }
}
