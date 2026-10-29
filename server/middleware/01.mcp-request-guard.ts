import {
  defineEventHandler,
  getRequestHeader,
  setResponseStatus,
} from 'nuxt/server'
import type { RequestEvent } from 'nuxt/server'
import {
  MCP_MAX_REQUEST_BODY_BYTES,
  MCP_SERVER_ROUTE,
} from '~~/config/mcp-server'

const JSON_RPC_INVALID_REQUEST = -32600
const JSON_ARRAY_START = /^[ \t\r\n]*\[/
const DIGITS_ONLY = /^\d+$/

interface McpRequestGuardOptions {
  readBody: () => Promise<string | undefined>
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

function jsonRpcError(event: RequestEvent, status: number, message: string) {
  setResponseStatus(event, status)

  return {
    jsonrpc: '2.0',
    error: { code: JSON_RPC_INVALID_REQUEST, message },
    id: null,
  }
}

export function createMcpRequestGuard(options: McpRequestGuardOptions) {
  return defineEventHandler(async (event) => {
    if (event.req.method !== 'POST' || !isMcpEndpointPath(event.url.pathname)) {
      return
    }

    const contentLength = parseContentLength(
      getRequestHeader(event, 'content-length') ?? null,
    )

    if (contentLength === null || contentLength > MCP_MAX_REQUEST_BODY_BYTES) {
      return jsonRpcError(
        event,
        413,
        `Send a Content-Length of at most ${MCP_MAX_REQUEST_BODY_BYTES} bytes.`,
      )
    }

    if (isJsonRpcBatch(await options.readBody())) {
      return jsonRpcError(
        event,
        400,
        'JSON-RPC batch requests are not supported. Send one message per request.',
      )
    }
  })
}

export default createMcpRequestGuard({
  readBody: () => {
    return readRawBody(useEvent(), 'utf8')
  },
})
