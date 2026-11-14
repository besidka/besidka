import { vi } from 'vitest'

export interface MockMcpTool {
  name: string
  title?: string
  description?: string
  inputSchema?: Record<string, unknown>
  annotations?: Record<string, unknown>
}

export interface MockMcpRequestRecord {
  host: string
  method: string
  rpcMethod: string | null
  headers: Headers
  params: Record<string, unknown> | null
}

export interface MockMcpServerOptions {
  url: string
  tools?: MockMcpTool[]
  ttlMs?: number
  respond?: (
    name: string,
    args: Record<string, unknown>,
  ) => { text?: string, isError?: boolean, content?: unknown[] }
  status?: number
}

export interface MockMcpServer {
  url: string
  host: string
  tools: MockMcpTool[]
  requests: MockMcpRequestRecord[]
  callCount: (rpcMethod: string) => number
  handle: (init: RequestInit) => Response
}

const SESSION_ID = 'session-1'

function jsonResponse(body: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function readJsonBody(init: RequestInit): Record<string, any> | null {
  if (typeof init.body !== 'string') {
    return null
  }

  try {
    return JSON.parse(init.body)
  } catch {
    return null
  }
}

export function createMockMcpServer(
  options: MockMcpServerOptions,
): MockMcpServer {
  const tools = options.tools ?? []
  const requests: MockMcpRequestRecord[] = []
  const host = new URL(options.url).host

  function handle(init: RequestInit): Response {
    const method = (init.method ?? 'GET').toUpperCase()
    const body = readJsonBody(init)
    const rpcMethod = typeof body?.method === 'string' ? body.method : null

    requests.push({
      host,
      method,
      rpcMethod,
      headers: new Headers(init.headers),
      params: body?.params ?? null,
    })

    if (options.status && options.status !== 200) {
      return new Response('failure', { status: options.status })
    }

    if (method === 'DELETE') {
      return new Response(null, { status: 204 })
    }

    if (method !== 'POST' || !body) {
      return new Response(null, { status: 405 })
    }

    if (rpcMethod === null || body.id === undefined) {
      return new Response(null, { status: 202 })
    }

    if (rpcMethod === 'server/discover') {
      return jsonResponse({
        jsonrpc: '2.0',
        id: body.id,
        error: { code: -32601, message: 'Method not found' },
      })
    }

    if (rpcMethod === 'initialize') {
      return jsonResponse({
        jsonrpc: '2.0',
        id: body.id,
        result: {
          protocolVersion: '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'mock', version: '1.0.0' },
        },
      }, 200, { 'mcp-session-id': SESSION_ID })
    }

    if (rpcMethod === 'tools/list') {
      return jsonResponse({
        jsonrpc: '2.0',
        id: body.id,
        result: {
          tools: tools.map((tool) => {
            return {
              inputSchema: { type: 'object', properties: {} },
              ...tool,
            }
          }),
          ...(options.ttlMs ? { ttlMs: options.ttlMs } : {}),
        },
      })
    }

    if (rpcMethod === 'tools/call') {
      const name = String(body.params?.name)
      const answer = options.respond?.(name, body.params?.arguments ?? {})
        ?? { text: `result of ${name}` }

      return jsonResponse({
        jsonrpc: '2.0',
        id: body.id,
        result: {
          content: answer.content ?? [{ type: 'text', text: answer.text ?? '' }],
          ...(answer.isError ? { isError: true } : {}),
        },
      })
    }

    return jsonResponse({
      jsonrpc: '2.0',
      id: body.id,
      error: { code: -32601, message: 'Method not found' },
    })
  }

  return {
    url: options.url,
    host,
    tools,
    requests,
    callCount: rpcMethod => requests.filter((request) => {
      return request.rpcMethod === rpcMethod
    }).length,
    handle,
  }
}

/**
 * A `fetch` that answers for the given in-process MCP servers by host and
 * fails any other host, so a test sees exactly what left the Worker.
 */
export function createMockMcpFetch(servers: readonly MockMcpServer[]) {
  const serversByHost = new Map(servers.map(server => [server.host, server]))

  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL
      ? input
      : input.url)
    const server = serversByHost.get(url.host)

    if (!server) {
      return new Response('unknown host', { status: 599 })
    }

    return server.handle(init ?? {})
  })
}
