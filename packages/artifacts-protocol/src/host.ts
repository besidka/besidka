import {
  CLIPBOARD_WRITE_LIMIT,
  CONNECT_TIMEOUT_MS,
  DISPLAY_REQUEST_LIMIT,
  ERROR_CODES,
  METHODS,
  PROTOCOL_VERSION,
} from './constants.ts'
import { createEndpoint } from './endpoint.ts'
import type { Endpoint, PortLike } from './endpoint.ts'
import {
  isClipboardWriteParams,
  isClipboardWriteResult,
  isCompleteParams,
  isInitializeParams,
  isLogMessageParams,
  isOpenDiagramViewerParams,
  isOpenLinkParams,
  isRequestDisplayModeParams,
  isRequestDisplayModeResult,
  isSizeChangedParams,
  isStorageKeyParams,
  isStorageListParams,
  isStorageSetParams,
  normalizeLinkUrl,
} from './guards.ts'
import { RpcError, createConnectMessage } from './jsonrpc.ts'
import type {
  ArtifactPayload,
  ClipboardWriteParams,
  ClipboardWriteResult,
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
  OpenDiagramViewerParams,
  OpenLinkParams,
  RequestDisplayModeParams,
  RequestDisplayModeResult,
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
  clipboardWrite?: (
    params: ClipboardWriteParams,
  ) => MaybePromise<ClipboardWriteResult>
  requestDisplayMode?: (
    params: RequestDisplayModeParams,
  ) => MaybePromise<RequestDisplayModeResult>
  openDiagramViewer?: (
    params: OpenDiagramViewerParams,
  ) => MaybePromise<EmptyResult | void>
  onUnexpectedNavigation?: (details: UnexpectedNavigationDetails) => void
  onConnectTimeout?: () => void
}

export interface HostConnectionOptions {
  timeoutMs?: number
  connectTimeoutMs?: number
  removeFrameOnNavigation?: boolean
  createChannel?: () => MessageChannel
  hasUserActivation?: () => boolean | null
  now?: () => number
}

export interface ClipboardLike {
  writeText: (text: string) => Promise<void>
}

interface RateLimit {
  count: number
  windowMs: number
}

interface UserActivationNavigator {
  userActivation?: { isActive: boolean }
  clipboard?: ClipboardLike
}

export interface HostConnection {
  sendToolInputPartial: (payload: ArtifactPayload) => void
  sendToolResult: (content: ToolResultContent) => void
  setHostContext: (changes: HostContextChangedParams) => void
  isReady: () => boolean
  destroy: () => void
}

interface QueuedNotifications {
  hostContext: HostContextChangedParams | null
  toolResult: HostNotifications[typeof METHODS.toolResult] | null
  toolInputPartial: HostNotifications[typeof METHODS.toolInputPartial] | null
}

function createEmptyQueue(): QueuedNotifications {
  return { hostContext: null, toolResult: null, toolInputPartial: null }
}

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

function rateLimited(method: string): RpcError {
  return new RpcError(ERROR_CODES.rateLimited, `Too many ${method} requests`)
}

function gestureRequired(method: string): RpcError {
  return new RpcError(
    ERROR_CODES.notAllowed,
    `${method} needs a click in the artifact`,
  )
}

function readHostNavigator(): UserActivationNavigator | undefined {
  return (globalThis as { navigator?: UserActivationNavigator }).navigator
}

function readHostUserActivation(): boolean | null {
  return readHostNavigator()?.userActivation?.isActive ?? null
}

function createRateLimiter(limit: RateLimit, now: () => number) {
  const timestamps: number[] = []

  return function tryTake(): boolean {
    const current = now()

    while (
      timestamps.length > 0
      && current - (timestamps[0] as number) >= limit.windowMs
    ) {
      timestamps.shift()
    }

    if (timestamps.length >= limit.count) {
      return false
    }

    timestamps.push(current)

    return true
  }
}

/**
 * Writes text to the host's clipboard and reports the outcome in the shape
 * `ui/clipboard-write` returns. Browsers refuse the write without a recent
 * user activation (`NotAllowedError`), which maps to `gesture-required`, so
 * a host can then offer its own Copy button in the parent document.
 */
export async function writeClipboardText(
  text: string,
  clipboard: ClipboardLike | undefined = readHostNavigator()?.clipboard,
): Promise<ClipboardWriteResult> {
  if (!clipboard) {
    return { copied: false, reason: 'unavailable' }
  }

  try {
    await clipboard.writeText(text)

    return { copied: true }
  } catch (exception) {
    const name = exception instanceof Error ? exception.name : ''

    return {
      copied: false,
      reason: name === 'NotAllowedError' ? 'gesture-required' : 'denied',
    }
  }
}

/**
 * Connects the app to a runtime iframe. Create the iframe with its `src`
 * already set, call this, then insert the iframe, all in one task, and never
 * move it in the DOM afterwards: the first `load` hands the runtime a fresh
 * MessagePort, and any later `load` is treated as the frame having left the
 * runtime, so the connection is closed, the frame removed and
 * `onUnexpectedNavigation` called. Only a `frame-src` policy on the
 * embedding page stops such a navigation before its request leaves; this
 * tripwire limits the damage afterwards (docs/artifacts-runtime.md).
 */
export function createHostConnection(
  frame: HostFrameLike,
  handlers: HostHandlers,
  options: HostConnectionOptions = {},
): HostConnection {
  let queuedNotifications = createEmptyQueue()
  let connectTimer: ReturnType<typeof setTimeout> | null = null
  let endpoint: Endpoint | null = null
  let loadCount = 0
  let initializeAnswered = false
  let ready = false
  let destroyed = false
  const now = options.now ?? Date.now
  const takeClipboardSlot = createRateLimiter(CLIPBOARD_WRITE_LIMIT, now)
  const takeDisplaySlot = createRateLimiter(DISPLAY_REQUEST_LIMIT, now)

  function hasUserGesture(claimedByFrame: boolean): boolean {
    if (!claimedByFrame) {
      return false
    }

    const hostActivation = (options.hasUserActivation
      ?? readHostUserActivation)()

    return hostActivation !== false
  }

  async function handleClipboardWrite(
    params: unknown,
  ): Promise<ClipboardWriteResult> {
    const method = METHODS.clipboardWrite

    if (!handlers.clipboardWrite) {
      throw methodNotFound(method)
    }

    if (!isClipboardWriteParams(params)) {
      throw invalidParams(method)
    }

    if (!hasUserGesture(params.userActivation)) {
      return { copied: false, reason: 'gesture-required' }
    }

    if (!takeClipboardSlot()) {
      throw rateLimited(method)
    }

    const result = await handlers.clipboardWrite({
      text: params.text,
      mimeType: 'text/plain',
      userActivation: true,
    })

    if (!isClipboardWriteResult(result)) {
      return { copied: false, reason: 'unavailable' }
    }

    return result.copied
      ? { copied: true }
      : { copied: false, reason: result.reason }
  }

  async function handleRequestDisplayMode(
    params: unknown,
  ): Promise<RequestDisplayModeResult> {
    const method = METHODS.requestDisplayMode

    if (!handlers.requestDisplayMode) {
      throw methodNotFound(method)
    }

    if (!isRequestDisplayModeParams(params)) {
      throw invalidParams(method)
    }

    if (!hasUserGesture(params.userActivation)) {
      throw gestureRequired(method)
    }

    if (!takeDisplaySlot()) {
      throw rateLimited(method)
    }

    const result = await handlers.requestDisplayMode({
      mode: params.mode,
      userActivation: true,
    })

    if (!isRequestDisplayModeResult(result)) {
      throw new RpcError(ERROR_CODES.internalError, 'Display mode unknown')
    }

    return { displayMode: result.displayMode }
  }

  async function handleOpenDiagramViewer(params: unknown) {
    const method = METHODS.openDiagramViewer

    if (!handlers.openDiagramViewer) {
      throw methodNotFound(method)
    }

    if (!isOpenDiagramViewerParams(params)) {
      throw invalidParams(method)
    }

    if (!hasUserGesture(params.userActivation)) {
      throw gestureRequired(method)
    }

    if (!takeDisplaySlot()) {
      throw rateLimited(method)
    }

    await handlers.openDiagramViewer({
      source: params.source,
      userActivation: true,
    })

    return {}
  }

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
      if (initializeAnswered) {
        throw new RpcError(
          ERROR_CODES.invalidRequest,
          'Already initialized',
        )
      }

      if (!isInitializeParams(params)) {
        throw invalidParams(method)
      }

      if (params.protocolVersion !== PROTOCOL_VERSION) {
        throw new RpcError(
          ERROR_CODES.invalidRequest,
          `Unsupported protocol version: ${params.protocolVersion}`,
        )
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

      const url = isOpenLinkParams(params) ? normalizeLinkUrl(params.url) : null

      if (!url) {
        throw invalidParams(method)
      }

      await handlers.onOpenLink({ url })

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

    if (method === METHODS.clipboardWrite) {
      return handleClipboardWrite(params)
    }

    if (method === METHODS.requestDisplayMode) {
      return handleRequestDisplayMode(params)
    }

    if (method === METHODS.openDiagramViewer) {
      return handleOpenDiagramViewer(params)
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

  function clearConnectTimer() {
    if (connectTimer) {
      clearTimeout(connectTimer)
    }

    connectTimer = null
  }

  function flushQueuedNotifications() {
    const pending = queuedNotifications

    queuedNotifications = createEmptyQueue()

    if (pending.hostContext) {
      endpoint?.notify(METHODS.hostContextChanged, pending.hostContext)
    }

    if (pending.toolResult) {
      endpoint?.notify(METHODS.toolResult, pending.toolResult)

      return
    }

    if (pending.toolInputPartial) {
      endpoint?.notify(METHODS.toolInputPartial, pending.toolInputPartial)
    }
  }

  function handleNotification(method: string, params: unknown) {
    if (method === METHODS.initialized) {
      if (!initializeAnswered || ready) {
        return
      }

      ready = true
      clearConnectTimer()
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

    queueNotification(method, params)
  }

  function queueNotification<Method extends HostNotificationMethod>(
    method: Method,
    params: HostNotifications[Method],
  ) {
    if (method === METHODS.hostContextChanged) {
      queuedNotifications.hostContext = {
        ...queuedNotifications.hostContext,
        ...(params as HostContextChangedParams),
      }

      return
    }

    if (method === METHODS.toolResult) {
      queuedNotifications.toolResult
        = params as HostNotifications[typeof METHODS.toolResult]
      queuedNotifications.toolInputPartial = null

      return
    }

    queuedNotifications.toolInputPartial
      = params as HostNotifications[typeof METHODS.toolInputPartial]
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
    connectTimer = setTimeout(() => {
      connectTimer = null

      if (!ready && !destroyed) {
        handlers.onConnectTimeout?.()
      }
    }, options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS)
  }

  function destroy() {
    if (destroyed) {
      return
    }

    destroyed = true
    ready = false
    queuedNotifications = createEmptyQueue()
    clearConnectTimer()
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
