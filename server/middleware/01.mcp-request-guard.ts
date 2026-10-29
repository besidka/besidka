import {
  defineEventHandler,
  getRequestHeader,
  setResponseStatus,
} from 'nuxt/server'
import type { RequestEvent } from 'nuxt/server'
import {
  MCP_MAX_AUTHENTICATED_REQUEST_BODY_BYTES,
  MCP_MAX_REQUEST_BODY_BYTES,
  MCP_SERVER_ROUTE,
} from '~~/config/mcp-server'
import type {
  McpAuthContext,
  McpTokenVerification,
} from '~~/server/utils/mcp/auth'
import {
  buildMcpBearerChallenge,
  createMcpTokenVerifierDependencies,
  resolveMcpResourceMetadataUrl,
  resolveMcpSiteUrl,
  verifyMcpAccessToken,
} from '~~/server/utils/mcp/auth'
import {
  findMissingMcpScopes,
  getMcpToolRequiredScopes,
} from '~~/server/utils/mcp/tool-scopes'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const JSON_RPC_PARSE_ERROR = -32700
const JSON_RPC_INVALID_REQUEST = -32600
const JSON_RPC_SERVER_ERROR = -32000
const JSON_ARRAY_START = /^[ \t\r\n]*\[/
const DIGITS_ONLY = /^\d+$/
const BYTE_ORDER_MARK = '\uFEFF'

type JsonRpcId = string | number | null

interface JsonRpcSummary {
  id: JsonRpcId
  method: string | null
  toolName: string | null
}

interface McpRequestGuardOptions {
  readBody: () => Promise<string | undefined>
  verifyAccessToken?: (authorization: string) => Promise<McpTokenVerification>
  resolveResourceMetadataUrl?: () => string
}

export function isMcpEndpointPath(pathname: string): boolean {
  return pathname === MCP_SERVER_ROUTE || pathname === `${MCP_SERVER_ROUTE}/`
}

export function parseContentLength(header: string | null): number | null {
  if (header === null || !DIGITS_ONLY.test(header.trim())) {
    return null
  }

  return Number(header.trim())
}

export function isJsonRpcBatch(body: string | undefined): boolean {
  return body !== undefined && JSON_ARRAY_START.test(body)
}

function toJsonRpcId(value: unknown): JsonRpcId {
  return typeof value === 'string' || typeof value === 'number'
    ? value
    : null
}

/**
 * Returns null when the body is not a JSON object, so the caller can answer
 * a parse error itself instead of letting a body it could not read reach a
 * parser that might read it differently.
 */
export function summarizeJsonRpcBody(body: string): JsonRpcSummary | null {
  let parsed: unknown

  try {
    parsed = JSON.parse(
      body.startsWith(BYTE_ORDER_MARK) ? body.slice(1) : body,
    )
  } catch {
    return null
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null
  }

  const message = parsed as {
    id?: unknown
    method?: unknown
    params?: { name?: unknown }
  }
  const method = typeof message.method === 'string' ? message.method : null
  const params = message.params && typeof message.params === 'object'
    ? message.params
    : null
  const toolName = typeof params?.name === 'string' ? params.name : null

  return { id: toJsonRpcId(message.id), method, toolName }
}

function jsonRpcError(
  event: RequestEvent,
  status: number,
  message: string,
  options: { code?: number, id?: JsonRpcId } = {},
) {
  setResponseStatus(event, status)

  return {
    jsonrpc: '2.0',
    error: { code: options.code ?? JSON_RPC_INVALID_REQUEST, message },
    id: options.id ?? null,
  }
}

function setMcpAuthLogFields(
  event: RequestEvent,
  fields: Record<string, string | number>,
): void {
  try {
    useRequestLogger(event).set({ mcp: fields })
  } catch {
    return
  }
}

function challenge(
  event: RequestEvent,
  status: 401 | 403,
  header: string,
  message: string,
  id: JsonRpcId,
) {
  event.res.headers.set('WWW-Authenticate', header)

  return jsonRpcError(event, status, message, {
    code: JSON_RPC_SERVER_ERROR,
    id,
  })
}

function defaultVerifyAccessToken(authorization: string) {
  return verifyMcpAccessToken(
    authorization,
    createMcpTokenVerifierDependencies(),
  )
}

function defaultResolveResourceMetadataUrl(): string {
  return resolveMcpResourceMetadataUrl(resolveMcpSiteUrl())
}

export function createMcpRequestGuard(options: McpRequestGuardOptions) {
  const verifyAccessToken = options.verifyAccessToken
    ?? defaultVerifyAccessToken
  const resolveResourceMetadataUrl = options.resolveResourceMetadataUrl
    ?? defaultResolveResourceMetadataUrl

  return defineEventHandler(async (event) => {
    if (event.req.method !== 'POST' || !isMcpEndpointPath(event.url.pathname)) {
      return
    }

    const contentLength = parseContentLength(
      getRequestHeader(event, 'content-length') ?? null,
    )

    if (
      contentLength === null
      || contentLength > MCP_MAX_AUTHENTICATED_REQUEST_BODY_BYTES
    ) {
      return jsonRpcError(
        event,
        413,
        `Send a Content-Length of at most ${MCP_MAX_REQUEST_BODY_BYTES} `
        + `bytes, or ${MCP_MAX_AUTHENTICATED_REQUEST_BODY_BYTES} bytes `
        + 'with a valid access token.',
      )
    }

    const authorization = getRequestHeader(event, 'authorization')
    let auth: McpAuthContext | null = null

    if (authorization) {
      const verification = await verifyAccessToken(authorization)

      if (verification.status === 'unavailable') {
        setMcpAuthLogFields(event, {
          auth: 'unavailable',
          auth_reason: verification.reason,
        })

        return jsonRpcError(
          event,
          503,
          'Access token verification is unavailable. Try again later.',
          { code: JSON_RPC_SERVER_ERROR },
        )
      }

      if (verification.status === 'invalid') {
        setMcpAuthLogFields(event, {
          auth: 'invalid',
          auth_reason: verification.reason,
        })

        return challenge(
          event,
          401,
          buildMcpBearerChallenge({
            resourceMetadataUrl: resolveResourceMetadataUrl(),
            error: 'invalid_token',
            description: 'The access token is invalid or expired',
          }),
          'The access token is invalid or expired. Sign in again.',
          null,
        )
      }

      auth = verification.auth
      event.context.mcpAuth = auth
      setMcpAuthLogFields(event, {
        auth: 'token',
        user_id: auth.userId,
        client_id: auth.clientId,
      })
    }

    const maxBodyBytes = auth
      ? MCP_MAX_AUTHENTICATED_REQUEST_BODY_BYTES
      : MCP_MAX_REQUEST_BODY_BYTES

    if (contentLength > maxBodyBytes) {
      return jsonRpcError(
        event,
        413,
        `Send a Content-Length of at most ${maxBodyBytes} bytes.`,
      )
    }

    const body = await options.readBody()

    if (isJsonRpcBatch(body)) {
      return jsonRpcError(
        event,
        400,
        'JSON-RPC batch requests are not supported. Send one message per request.',
      )
    }

    if (body === undefined || body.trim().length === 0) {
      return
    }

    const message = summarizeJsonRpcBody(body)

    if (!message) {
      return jsonRpcError(event, 400, 'The request body is not valid JSON.', {
        code: JSON_RPC_PARSE_ERROR,
      })
    }

    if (message.method !== 'tools/call') {
      return
    }

    const requiredScopes = getMcpToolRequiredScopes(message.toolName)

    if (requiredScopes.length === 0) {
      return
    }

    if (!auth) {
      return challenge(
        event,
        401,
        buildMcpBearerChallenge({
          resourceMetadataUrl: resolveResourceMetadataUrl(),
          scopes: requiredScopes,
        }),
        'Sign in to Besidka to use this tool.',
        message.id,
      )
    }

    const missingScopes = findMissingMcpScopes(requiredScopes, auth.scopes)

    if (missingScopes.length === 0) {
      return
    }

    setMcpAuthLogFields(event, { auth_denied: 'insufficient_scope' })

    return challenge(
      event,
      403,
      buildMcpBearerChallenge({
        resourceMetadataUrl: resolveResourceMetadataUrl(),
        scopes: missingScopes,
        error: 'insufficient_scope',
        description: `The access token is missing the scope ${missingScopes.join(' ')}`,
      }),
      `This connection was not granted ${missingScopes.join(' ')}. `
      + 'Reconnect Besidka and allow it.',
      message.id,
    )
  })
}

export default createMcpRequestGuard({
  readBody: () => {
    return readRawBody(useEvent(), 'utf8')
  },
})
