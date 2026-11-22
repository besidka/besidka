import { createMCPClient } from '@ai-sdk/mcp'
import type { MCPClient } from '@ai-sdk/mcp'
import {
  CONNECTOR_CALL_RESPONSE_MAX_BYTES,
  CONNECTOR_CLOSE_TIMEOUT_MS,
  CONNECTOR_CONNECT_TIMEOUT_MS,
  CONNECTOR_PARALLEL_CONNECTS,
  CONNECTOR_SSE_SESSION_MAX_BYTES,
  CONNECTOR_SSE_SESSION_TIMEOUT_MS,
} from '#shared/utils/connectors-policy'
import type { ConnectorTransport } from '#shared/utils/connectors-policy'
import { createConnectorError } from '~~/server/utils/connectors/errors'
import type { LoggerLike } from '~~/server/utils/files/logger'
import { createSafeFetch } from '~~/server/utils/net/safe-fetch'

const HTTP_UNAUTHORIZED = 401
const HTTP_METHOD_NOT_ALLOWED = 405
const CLIENT_NAME = 'besidka'
const CLIENT_VERSION = '1.0.0'
const BEARER_PREFIX = 'Bearer '

export interface ConnectorAuthResolution {
  headers: Record<string, string>
  secrets: string[]
}

export type ConnectorAuthResolver = (
  rejectedToken?: string,
) => Promise<ConnectorAuthResolution | null>

export type ConnectorClient = MCPClient

export interface ConnectorClientHandle {
  readonly connectorId: string
  readonly slug: string
  getClient: () => Promise<ConnectorClient>
  close: () => Promise<void>
}

export interface ConcurrencyLimiter {
  run: <Result>(task: () => Promise<Result>) => Promise<Result>
}

export interface ConnectorClientDependencies {
  createClient?: typeof createMCPClient
  createFetch?: typeof createSafeFetch
}

export function createConcurrencyLimiter(
  maxConcurrent: number = CONNECTOR_PARALLEL_CONNECTS,
): ConcurrencyLimiter {
  let active = 0
  const waiting: Array<() => void> = []

  async function acquire(): Promise<void> {
    if (active < maxConcurrent) {
      active += 1

      return
    }

    await new Promise<void>(resolve => waiting.push(resolve))
  }

  function release(): void {
    const next = waiting.shift()

    if (next) {
      next()

      return
    }

    active -= 1
  }

  return {
    async run(task) {
      await acquire()

      try {
        return await task()
      } finally {
        release()
      }
    },
  }
}

function scopeNetLogger(
  logger?: LoggerLike,
  logsHost: boolean = true,
): LoggerLike | undefined {
  if (!logger) {
    return undefined
  }

  return {
    set(data) {
      const net = (data.attributes as { net?: Record<string, unknown> }
        | undefined)?.net

      if (!net) {
        return
      }

      const { host, ...withoutHost } = net

      logger.set({
        attributes: {
          connectors: {
            net: logsHost ? { ...withoutHost, host } : withoutHost,
          },
        },
      })
    },
  }
}

type JsonRpcId = string | number

function parseRequestBody(init?: RequestInit): Record<string, unknown> | null {
  if (typeof init?.body !== 'string') {
    return null
  }

  try {
    const message: unknown = JSON.parse(init.body)

    return typeof message === 'object'
      && message !== null
      && !Array.isArray(message)
      ? message as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

function isToolCallRequest(init?: RequestInit): boolean {
  return parseRequestBody(init)?.method === 'tools/call'
}

function requestIdOf(init?: RequestInit): JsonRpcId | null {
  const id = parseRequestBody(init)?.id

  return typeof id === 'string' || typeof id === 'number' ? id : null
}

const SSE_EVENT_SEPARATOR = /\r?\n\r?\n/g
const SSE_SEPARATOR_MAX_LENGTH = 4

function isResponseMessage(message: unknown, requestId: JsonRpcId): boolean {
  return typeof message === 'object'
    && message !== null
    && (message as { id?: unknown }).id === requestId
    && ('result' in message || 'error' in message)
}

/**
 * Whether one SSE event carries the JSON-RPC response to `requestId`: a
 * `message` event (or one without a type) whose data is that response, alone
 * or in a batch.
 */
export function isSseResponseEvent(
  event: string,
  requestId: JsonRpcId,
): boolean {
  const lines = event.split(/\r?\n/)
  const eventType = lines.find(line => line.startsWith('event:'))
    ?.slice('event:'.length)
    .trim()

  if (eventType && eventType !== 'message') {
    return false
  }

  const data = lines
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice('data:'.length).replace(/^ /, ''))
    .join('\n')

  if (!data) {
    return false
  }

  try {
    const message: unknown = JSON.parse(data)

    return Array.isArray(message)
      ? message.some(item => isResponseMessage(item, requestId))
      : isResponseMessage(message, requestId)
  } catch {
    return false
  }
}

/**
 * Ends an SSE answer to a POST once it carried the JSON-RPC response to that
 * request. The MCP spec says a server should close the stream then, but
 * `@ai-sdk/mcp` reads it until the server does, so a server that keeps it
 * open held one of the Worker's six simultaneous connections until the
 * 60-second deadline, per call. Every byte up to and including the
 * response is passed on unchanged; the rest is dropped and the request is
 * canceled, which frees the connection.
 */
export function closeAfterJsonRpcResponse(
  response: Response,
  requestId: JsonRpcId,
): Response {
  const contentType = response.headers.get('content-type') ?? ''

  if (!response.body || !contentType.includes('text/event-stream')) {
    return response
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const separatorPattern = new RegExp(SSE_EVENT_SEPARATOR)
  let pending = ''

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read()

      if (done) {
        controller.close()

        return
      }

      controller.enqueue(value)

      const searchFrom = Math.max(
        0,
        pending.length - SSE_SEPARATOR_MAX_LENGTH + 1,
      )

      pending += decoder.decode(value, { stream: true })
      separatorPattern.lastIndex = searchFrom

      let eventStart = 0
      let separator = separatorPattern.exec(pending)
      let isAnswered = false

      while (separator) {
        const event = pending.slice(eventStart, separator.index)

        if (isSseResponseEvent(event, requestId)) {
          isAnswered = true
        }

        eventStart = separator.index + separator[0].length
        separator = separatorPattern.exec(pending)
      }

      pending = pending.slice(eventStart)

      if (isAnswered) {
        controller.close()
        await reader.cancel().catch(() => undefined)
      }
    },
    async cancel(reason) {
      await reader.cancel(reason)
    },
  })

  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

/**
 * The `fetch` of one connector's MCP transport. Every request goes through
 * `safeFetch` with purpose `mcp` (https only, no private names, same-origin
 * redirects, size and time caps, no cookies). A streamable-HTTP server may
 * offer a long-lived `GET` event stream for server-initiated messages;
 * Besidka supports none of them, so that `GET` is answered with a local 405
 * (the transport reads it as "no stream offered") and never leaves the
 * Worker, which keeps a send from holding one connection per connector open.
 * The legacy SSE transport needs its one `GET` stream, so it gets a session
 * deadline and size cap instead. With `largeCallResponses` (a send that
 * forwards images to its model), a `tools/call` response on streamable HTTP
 * may be up to `CONNECTOR_CALL_RESPONSE_MAX_BYTES` (8 MiB); every other
 * request, and every request of a send without images, keeps the 1 MiB
 * `mcp` default. The body is counted as it streams and cut at the cap. An
 * SSE answer to a POST ends right after the JSON-RPC response to it
 * (`closeAfterJsonRpcResponse`).
 */
export function createConnectorTransportFetch(
  transport: ConnectorTransport,
  createFetch: typeof createSafeFetch = createSafeFetch,
  logger?: LoggerLike,
  logsHost: boolean = true,
  largeCallResponses: boolean = false,
): typeof fetch {
  const netLogger = scopeNetLogger(logger, logsHost)

  if (transport === 'sse') {
    return createFetch('mcp', {
      timeoutMs: CONNECTOR_SSE_SESSION_TIMEOUT_MS,
      maxResponseBytes: CONNECTOR_SSE_SESSION_MAX_BYTES,
      ...(netLogger ? { logger: netLogger } : {}),
    })
  }

  const safeFetch = netLogger
    ? createFetch('mcp', { logger: netLogger })
    : createFetch('mcp')

  return ((input: string | URL | Request, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase()

    if (method === 'GET') {
      return Promise.resolve(
        new Response(null, { status: HTTP_METHOD_NOT_ALLOWED }),
      )
    }

    const requestId = method === 'POST' ? requestIdOf(init) : null
    const sent = largeCallResponses && isToolCallRequest(init)
      ? safeFetch(input, {
        ...init,
        maxResponseBytes: CONNECTOR_CALL_RESPONSE_MAX_BYTES,
      } as RequestInit)
      : safeFetch(input, init)

    if (requestId === null) {
      return sent
    }

    return sent.then((response) => {
      return closeAfterJsonRpcResponse(response, requestId)
    })
  }) as typeof fetch
}

function withTimeout<Result>(
  promise: Promise<Result>,
  timeoutMs: number,
  onTimeout: () => Error,
  onLateResult?: (result: Result) => void,
): Promise<Result> {
  return new Promise<Result>((resolve, reject) => {
    let isSettled = false
    const timer = setTimeout(() => {
      isSettled = true
      reject(onTimeout())
    }, timeoutMs)

    promise.then((result) => {
      clearTimeout(timer)

      if (isSettled) {
        onLateResult?.(result)

        return
      }

      isSettled = true
      resolve(result)
    }, (exception) => {
      clearTimeout(timer)

      if (!isSettled) {
        isSettled = true
        reject(exception)
      }
    })
  })
}

function readStatusCode(exception: unknown): number | undefined {
  const statusCode = (exception as { statusCode?: unknown } | null)?.statusCode

  return typeof statusCode === 'number' ? statusCode : undefined
}

async function closeClientQuietly(client: ConnectorClient): Promise<void> {
  try {
    await withTimeout(
      client.close(),
      CONNECTOR_CLOSE_TIMEOUT_MS,
      () => new Error('close timeout'),
    )
  } catch {
    return
  }
}

/**
 * A lazily connected, idempotently closed MCP client for one connector. The
 * connection opens on the first `getClient()` call (a send whose tool list
 * came from the KV cache never connects until a tool is called), at most
 * three connects run at once across the handles that share a limiter, and a
 * connect that takes longer than ten seconds fails with a fixed code. The
 * headers come from this connector's own credentials only. After a 401 on
 * connect, an OAuth connector retries once with a refreshed token.
 */
export function createConnectorClientHandle(input: {
  connectorId: string
  slug: string
  url: string
  transport: ConnectorTransport
  resolveAuth: ConnectorAuthResolver
  limiter: ConcurrencyLimiter
  logger?: LoggerLike
  logsHost?: boolean
  largeCallResponses?: boolean
  dependencies?: ConnectorClientDependencies
}): ConnectorClientHandle {
  const createClient = input.dependencies?.createClient ?? createMCPClient
  const transportFetch = createConnectorTransportFetch(
    input.transport,
    input.dependencies?.createFetch,
    input.logger,
    input.logsHost,
    input.largeCallResponses,
  )
  let clientPromise: Promise<ConnectorClient> | null = null
  let isClosed = false

  async function connectOnce(
    rejectedToken: string | undefined,
    onToken: (token: string | undefined) => void,
  ): Promise<ConnectorClient> {
    const auth = await input.resolveAuth(rejectedToken)

    if (!auth) {
      throw createConnectorError('CONNECTOR_REAUTH_REQUIRED')
    }

    onToken(auth.headers.Authorization?.startsWith(BEARER_PREFIX)
      ? auth.headers.Authorization.slice(BEARER_PREFIX.length)
      : undefined)

    return await withTimeout(
      createClient({
        transport: {
          type: input.transport === 'sse' ? 'sse' : 'http',
          url: input.url,
          headers: auth.headers,
          fetch: transportFetch,
        },
        clientName: CLIENT_NAME,
        version: CLIENT_VERSION,
        initializationOptions: { timeout: CONNECTOR_CONNECT_TIMEOUT_MS },
        onUncaughtError: () => {
          input.logger?.set({
            attributes: {
              connectors: { id: input.connectorId, transportError: true },
            },
          })
        },
      }),
      CONNECTOR_CONNECT_TIMEOUT_MS,
      () => createConnectorError('CONNECTOR_UNREACHABLE'),
      closeClientQuietly,
    )
  }

  async function connect(): Promise<ConnectorClient> {
    let usedToken: string | undefined

    try {
      return await connectOnce(undefined, (token) => {
        usedToken = token
      })
    } catch (exception) {
      if (readStatusCode(exception) !== HTTP_UNAUTHORIZED || !usedToken) {
        throw exception
      }

      return await connectOnce(usedToken, () => {})
    }
  }

  return {
    connectorId: input.connectorId,
    slug: input.slug,
    getClient() {
      if (isClosed) {
        return Promise.reject(createConnectorError('CONNECTOR_UNREACHABLE'))
      }

      clientPromise ??= input.limiter.run(connect)

      return clientPromise
    },
    async close() {
      if (isClosed) {
        return
      }

      isClosed = true

      if (!clientPromise) {
        return
      }

      try {
        await closeClientQuietly(await clientPromise)
      } catch {
        return
      }
    },
  }
}
