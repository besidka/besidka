import { ERROR_CODES, METHODS } from './constants.ts'
import { createEndpoint } from './endpoint.ts'
import type { Endpoint, PortLike, RequestOptions } from './endpoint.ts'
import {
  isCompleteResult,
  isHostContextChangedParams,
  isInitializeResult,
  isStorageGetResult,
  isStorageListResult,
  isToolInputPartialParams,
  isToolResultParams,
} from './guards.ts'
import { RpcError, isConnectMessage, isRecord } from './jsonrpc.ts'
import type {
  HostContextChangedParams,
  RequestParams,
  RequestResult,
  RuntimeNotificationMethod,
  RuntimeNotifications,
  RuntimeRequestMethod,
  ToolInputPartialParams,
  ToolResultParams,
} from './messages.ts'

export type MessageListener = (event: MessageEvent) => void

export interface RuntimeWindowLike {
  parent: unknown
  addEventListener: (type: 'message', listener: MessageListener) => void
  removeEventListener: (type: 'message', listener: MessageListener) => void
}

export interface RuntimeNotificationHandlers {
  onToolInputPartial?: (params: ToolInputPartialParams) => void
  onToolResult?: (params: ToolResultParams) => void
  onHostContextChanged?: (params: HostContextChangedParams) => void
}

export interface ConnectRuntimeOptions {
  target?: RuntimeWindowLike
  handlers?: RuntimeNotificationHandlers
  timeoutMs?: number
}

export interface RuntimeConnection {
  request: <Method extends RuntimeRequestMethod>(
    method: Method,
    params: RequestParams<Method>,
    options?: RequestOptions,
  ) => Promise<RequestResult<Method>>
  notify: <Method extends RuntimeNotificationMethod>(
    method: Method,
    params: RuntimeNotifications[Method],
  ) => void
  close: () => void
}

const RESULT_GUARDS: Partial<
  Record<RuntimeRequestMethod, (value: unknown) => boolean>
> = {
  [METHODS.initialize]: isInitializeResult,
  [METHODS.storageGet]: isStorageGetResult,
  [METHODS.storageList]: isStorageListResult,
  [METHODS.complete]: isCompleteResult,
}

function dispatchHostNotification(
  handlers: RuntimeNotificationHandlers,
  method: string,
  params: unknown,
) {
  if (method === METHODS.toolResult && isToolResultParams(params)) {
    handlers.onToolResult?.(params)

    return
  }

  if (
    method === METHODS.toolInputPartial
    && isToolInputPartialParams(params)
  ) {
    handlers.onToolInputPartial?.(params)

    return
  }

  if (
    method === METHODS.hostContextChanged
    && isHostContextChangedParams(params)
  ) {
    handlers.onHostContextChanged?.(params)
  }
}

function createRuntimeConnection(endpoint: Endpoint): RuntimeConnection {
  async function request<Method extends RuntimeRequestMethod>(
    method: Method,
    params: RequestParams<Method>,
    options?: RequestOptions,
  ): Promise<RequestResult<Method>> {
    const result = await endpoint.request(method, params, options)
    const guard = RESULT_GUARDS[method] ?? isRecord

    if (!guard(result)) {
      throw new RpcError(
        ERROR_CODES.internalError,
        `Invalid result for ${method}`,
      )
    }

    return result as RequestResult<Method>
  }

  return {
    request,
    notify: (method, params) => {
      endpoint.notify(method, params)
    },
    close: endpoint.close,
  }
}

/**
 * Waits for the parent's `besidka/connect` message and adopts its port.
 * Only the first message from `window.parent` that carries exactly one port
 * is accepted; the listener is removed afterwards, so a forged or repeated
 * connect from any window is ignored.
 */
export function connectRuntime(
  options: ConnectRuntimeOptions = {},
): Promise<RuntimeConnection> {
  const target = options.target ?? (globalThis as unknown as RuntimeWindowLike)
  const handlers = options.handlers ?? {}

  return new Promise((resolve) => {
    const listener: MessageListener = (event) => {
      if (event.source !== target.parent || target.parent === target) {
        return
      }

      if (!isConnectMessage(event.data) || event.ports.length !== 1) {
        return
      }

      const port = event.ports[0] as unknown as PortLike

      target.removeEventListener('message', listener)

      const endpoint = createEndpoint(port, {
        timeoutMs: options.timeoutMs,
        onNotification: (method, params) => {
          dispatchHostNotification(handlers, method, params)
        },
      })

      resolve(createRuntimeConnection(endpoint))
    }

    target.addEventListener('message', listener)
  })
}
