import { createMCPClient } from '@ai-sdk/mcp'
import type { MCPClient } from '@ai-sdk/mcp'
import {
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

function scopeNetLogger(logger?: LoggerLike): LoggerLike | undefined {
  if (!logger) {
    return undefined
  }

  return {
    set(data) {
      const net = (data.attributes as { net?: unknown } | undefined)?.net

      if (net) {
        logger.set({ attributes: { connectors: { net } } })
      }
    },
  }
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
 * deadline and size cap instead.
 */
export function createConnectorTransportFetch(
  transport: ConnectorTransport,
  createFetch: typeof createSafeFetch = createSafeFetch,
  logger?: LoggerLike,
): typeof fetch {
  const netLogger = scopeNetLogger(logger)

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

    return safeFetch(input, init)
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
  dependencies?: ConnectorClientDependencies
}): ConnectorClientHandle {
  const createClient = input.dependencies?.createClient ?? createMCPClient
  const transportFetch = createConnectorTransportFetch(
    input.transport,
    input.dependencies?.createFetch,
    input.logger,
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
