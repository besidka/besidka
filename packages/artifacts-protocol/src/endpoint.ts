import {
  ERROR_CODES,
  MAX_PENDING_REQUESTS,
  REQUEST_TIMEOUT_MS,
} from './constants.ts'
import {
  RpcError,
  createErrorResponse,
  createNotification,
  createRequest,
  createSuccessResponse,
  isJsonRpcErrorResponse,
  isJsonRpcNotification,
  isJsonRpcRequest,
  isJsonRpcResponse,
  toRpcError,
} from './jsonrpc.ts'
import type { JsonRpcId, JsonRpcRequest } from './jsonrpc.ts'

export interface PortLike {
  postMessage: (message: unknown) => void
  close: () => void
  onmessage: ((event: MessageEvent) => void) | null
}

export type RequestHandler = (
  method: string,
  params: unknown,
) => unknown

export type NotificationHandler = (method: string, params: unknown) => void

export interface EndpointOptions {
  onRequest?: RequestHandler
  onNotification?: NotificationHandler
  timeoutMs?: number
}

export interface RequestOptions {
  timeoutMs?: number
}

export interface Endpoint {
  request: (
    method: string,
    params: unknown,
    options?: RequestOptions,
  ) => Promise<unknown>
  notify: (method: string, params: unknown) => void
  close: () => void
  isClosed: () => boolean
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (reason: RpcError) => void
  timer: ReturnType<typeof setTimeout>
}

/**
 * JSON-RPC 2.0 over one MessagePort. Every message that does not arrive on
 * this port is outside the protocol, which is why the port is the only
 * trusted channel between the host and the sandboxed runtime.
 */
export function createEndpoint(
  port: PortLike,
  options: EndpointOptions = {},
): Endpoint {
  const pendingRequests = new Map<JsonRpcId, PendingRequest>()
  const defaultTimeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS
  let nextRequestId = 1
  let closed = false

  function send(message: unknown) {
    if (closed) {
      return
    }

    port.postMessage(message)
  }

  function sendResponse(id: JsonRpcId, result: unknown) {
    try {
      send(createSuccessResponse(id, result ?? {}))
    } catch {
      send(createErrorResponse(id, {
        code: ERROR_CODES.internalError,
        message: 'Result could not be sent',
      }))
    }
  }

  async function handleRequest(message: JsonRpcRequest) {
    if (!options.onRequest) {
      send(createErrorResponse(message.id, {
        code: ERROR_CODES.methodNotFound,
        message: `Method not found: ${message.method}`,
      }))

      return
    }

    try {
      const result = await options.onRequest(message.method, message.params)

      sendResponse(message.id, result)
    } catch (exception) {
      send(createErrorResponse(message.id, toRpcError(exception).toJSON()))
    }
  }

  function handleResponse(message: unknown) {
    if (!isJsonRpcResponse(message) || message.id === null) {
      return
    }

    const pending = pendingRequests.get(message.id)

    if (!pending) {
      return
    }

    pendingRequests.delete(message.id)
    clearTimeout(pending.timer)

    if (isJsonRpcErrorResponse(message)) {
      pending.reject(new RpcError(
        message.error.code,
        message.error.message,
        message.error.data,
      ))

      return
    }

    pending.resolve(message.result)
  }

  port.onmessage = (event: MessageEvent) => {
    if (closed) {
      return
    }

    const message: unknown = event.data

    if (isJsonRpcRequest(message)) {
      handleRequest(message)

      return
    }

    if (isJsonRpcNotification(message)) {
      options.onNotification?.(message.method, message.params)

      return
    }

    handleResponse(message)
  }

  function request(
    method: string,
    params: unknown,
    requestOptions: RequestOptions = {},
  ): Promise<unknown> {
    if (closed) {
      return Promise.reject(new RpcError(
        ERROR_CODES.connectionClosed,
        'Connection closed',
      ))
    }

    if (pendingRequests.size >= MAX_PENDING_REQUESTS) {
      return Promise.reject(new RpcError(
        ERROR_CODES.rateLimited,
        'Too many pending requests',
      ))
    }

    const id = nextRequestId
    const timeoutMs = requestOptions.timeoutMs ?? defaultTimeoutMs

    nextRequestId += 1

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingRequests.delete(id)
        reject(new RpcError(
          ERROR_CODES.requestTimeout,
          `Request timed out: ${method}`,
        ))
      }, timeoutMs)

      pendingRequests.set(id, { resolve, reject, timer })

      try {
        send(createRequest(id, method, params))
      } catch (exception) {
        pendingRequests.delete(id)
        clearTimeout(timer)
        reject(toRpcError(exception))
      }
    })
  }

  function notify(method: string, params: unknown) {
    send(createNotification(method, params))
  }

  function close() {
    if (closed) {
      return
    }

    closed = true
    port.onmessage = null

    for (const pending of pendingRequests.values()) {
      clearTimeout(pending.timer)
      pending.reject(new RpcError(
        ERROR_CODES.connectionClosed,
        'Connection closed',
      ))
    }

    pendingRequests.clear()
    port.close()
  }

  return {
    request,
    notify,
    close,
    isClosed: () => {
      return closed
    },
  }
}
