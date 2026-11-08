import { ERROR_CODES, METHODS, PROTOCOL_VERSION } from './constants.ts'
import { createEndpoint } from './endpoint.ts'
import type { Endpoint, PortLike } from './endpoint.ts'
import {
  isCompleteParams,
  isInitializeParams,
  isLogMessageParams,
  isOpenLinkParams,
  isSizeChangedParams,
  isStorageKeyParams,
  isStorageListParams,
  isStorageSetParams,
} from './guards.ts'
import { RpcError, createConnectMessage } from './jsonrpc.ts'
import type {
  ArtifactPayload,
  CompleteParams,
  CompleteResult,
  EmptyResult,
  HostContext,
  HostContextChangedParams,
  HostNotificationMethod,
  HostNotifications,
  InitializeParams,
  InitializeResult,
  LogMessageParams,
  OpenLinkParams,
  SizeChangedParams,
  StorageGetResult,
  StorageKeyParams,
  StorageListParams,
  StorageListResult,
  StorageSetParams,
  ToolResultContent,
} from './messages.ts'

type MaybePromise<Value> = Value | Promise<Value>

export interface HostFrameLike {
  contentWindow: {
    postMessage: (
      message: unknown,
      targetOrigin: string,
      transfer: Transferable[],
    ) => void
  } | null
  addEventListener: (type: 'load', listener: () => void) => void
  removeEventListener: (type: 'load', listener: () => void) => void
  remove: () => void
}

export interface HostStorageHandlers {
  get: (params: StorageKeyParams) => MaybePromise<StorageGetResult>
  set: (params: StorageSetParams) => MaybePromise<EmptyResult | void>
  delete: (params: StorageKeyParams) => MaybePromise<EmptyResult | void>
  list: (params: StorageListParams) => MaybePromise<StorageListResult>
}

export interface UnexpectedNavigationDetails {
  loadCount: number
}

export interface HostHandlers {
  getHostContext: () => HostContext
  onInitialized?: (params: InitializeParams) => void
  onReady?: () => void
  onSizeChanged?: (params: SizeChangedParams) => void
  onMessage?: (params: LogMessageParams) => void
  onOpenLink?: (params: OpenLinkParams) => MaybePromise<void>
  storage?: HostStorageHandlers
  complete?: (params: CompleteParams) => MaybePromise<CompleteResult>
  onUnexpectedNavigation?: (details: UnexpectedNavigationDetails) => void
}

export interface HostConnectionOptions {
  timeoutMs?: number
  removeFrameOnNavigation?: boolean
  createChannel?: () => MessageChannel
}

export interface HostConnection {
  sendToolInputPartial: (payload: ArtifactPayload) => void
  sendToolResult: (content: ToolResultContent) => void
  setHostContext: (changes: HostContextChangedParams) => void
  isReady: () => boolean
  destroy: () => void
}

interface QueuedNotification {
  method: HostNotificationMethod
  params: HostNotifications[HostNotificationMethod]
}

const MAX_QUEUED_NOTIFICATIONS = 32

function invalidParams(method: string): RpcError {
  return new RpcError(
    ERROR_CODES.invalidParams,
    `Invalid params for ${method}`,
  )
}

function methodNotFound(method: string): RpcError {
  return new RpcError(
    ERROR_CODES.methodNotFound,
    `Method not found: ${method}`,
  )
}

/**
 * Connects the app to a runtime iframe. Call it in the same task that sets
 * the iframe `src` (before the first `load`): the first `load` hands the
 * runtime a fresh MessagePort, and any later `load` means the frame
 * navigated itself away from the runtime, so the connection is closed, the
 * frame removed and `onUnexpectedNavigation` called. The URL of that
 * navigation has already left the browser by then; this is a tripwire that
 * limits the damage, not a guarantee that no data leaves the frame.
 */
export function createHostConnection(
  frame: HostFrameLike,
  handlers: HostHandlers,
  options: HostConnectionOptions = {},
): HostConnection {
  const queuedNotifications: QueuedNotification[] = []
  let endpoint: Endpoint | null = null
  let loadCount = 0
  let initializeAnswered = false
  let ready = false
  let destroyed = false

  async function handleStorageRequest(method: string, params: unknown) {
    const storage = handlers.storage

    if (!storage) {
      throw methodNotFound(method)
    }

    if (method === METHODS.storageGet) {
      if (!isStorageKeyParams(params)) {
        throw invalidParams(method)
      }

      return storage.get(params)
    }

    if (method === METHODS.storageSet) {
      if (!isStorageSetParams(params)) {
        throw invalidParams(method)
      }

      return (await storage.set(params)) ?? {}
    }

    if (method === METHODS.storageDelete) {
      if (!isStorageKeyParams(params)) {
        throw invalidParams(method)
      }

      return (await storage.delete(params)) ?? {}
    }

    if (!isStorageListParams(params)) {
      throw invalidParams(method)
    }

    return storage.list(params)
  }

  async function handleRequest(method: string, params: unknown) {
    if (method === METHODS.initialize) {
      if (!isInitializeParams(params)) {
        throw invalidParams(method)
      }

      handlers.onInitialized?.(params)
      initializeAnswered = true

      const result: InitializeResult = {
        protocolVersion: PROTOCOL_VERSION,
        hostContext: handlers.getHostContext(),
      }

      return result
    }

    if (method === METHODS.openLink) {
      if (!handlers.onOpenLink) {
        throw methodNotFound(method)
      }

      if (!isOpenLinkParams(params)) {
        throw invalidParams(method)
      }

      await handlers.onOpenLink(params)

      return {}
    }

    if (
      method === METHODS.storageGet
      || method === METHODS.storageSet
      || method === METHODS.storageDelete
      || method === METHODS.storageList
    ) {
      return handleStorageRequest(method, params)
    }

    if (method === METHODS.complete) {
      if (!handlers.complete) {
        throw methodNotFound(method)
      }

      if (!isCompleteParams(params)) {
        throw invalidParams(method)
      }

      return handlers.complete(params)
    }

    throw methodNotFound(method)
  }

  function flushQueuedNotifications() {
    const pending = queuedNotifications.splice(0)

    for (const notification of pending) {
      endpoint?.notify(notification.method, notification.params)
    }
  }

  function handleNotification(method: string, params: unknown) {
    if (method === METHODS.initialized) {
      if (!initializeAnswered || ready) {
        return
      }

      ready = true
      flushQueuedNotifications()
      handlers.onReady?.()

      return
    }

    if (method === METHODS.sizeChanged && isSizeChangedParams(params)) {
      handlers.onSizeChanged?.(params)

      return
    }

    if (method === METHODS.message && isLogMessageParams(params)) {
      handlers.onMessage?.(params)
    }
  }

  function sendNotification<Method extends HostNotificationMethod>(
    method: Method,
    params: HostNotifications[Method],
  ) {
    if (destroyed) {
      return
    }

    if (ready && endpoint) {
      endpoint.notify(method, params)

      return
    }

    if (queuedNotifications.length >= MAX_QUEUED_NOTIFICATIONS) {
      queuedNotifications.shift()
    }

    queuedNotifications.push({ method, params })
  }

  function connect() {
    const contentWindow = frame.contentWindow

    if (!contentWindow) {
      return
    }

    const channel = options.createChannel?.() ?? new MessageChannel()

    endpoint = createEndpoint(channel.port1 as unknown as PortLike, {
      timeoutMs: options.timeoutMs,
      onRequest: handleRequest,
      onNotification: handleNotification,
    })

    contentWindow.postMessage(createConnectMessage(), '*', [channel.port2])
  }

  function destroy() {
    if (destroyed) {
      return
    }

    destroyed = true
    ready = false
    queuedNotifications.length = 0
    frame.removeEventListener('load', handleLoad)
    endpoint?.close()
    endpoint = null
  }

  function handleLoad() {
    if (destroyed) {
      return
    }

    loadCount += 1

    if (loadCount === 1) {
      connect()

      return
    }

    destroy()

    if (options.removeFrameOnNavigation !== false) {
      frame.remove()
    }

    handlers.onUnexpectedNavigation?.({ loadCount })
  }

  frame.addEventListener('load', handleLoad)

  return {
    sendToolInputPartial: (payload) => {
      sendNotification(METHODS.toolInputPartial, { arguments: payload })
    },
    sendToolResult: (content) => {
      sendNotification(METHODS.toolResult, { structuredContent: content })
    },
    setHostContext: (changes) => {
      sendNotification(METHODS.hostContextChanged, changes)
    },
    isReady: () => {
      return ready
    },
    destroy,
  }
}
