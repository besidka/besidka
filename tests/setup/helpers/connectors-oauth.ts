import { createHash } from 'node:crypto'
import { vi } from 'vitest'

export const MCP_SERVER_URL = 'https://mcp.example.com/mcp'
export const MCP_ORIGIN = 'https://mcp.example.com'
export const ISSUER = 'https://auth.example.com'
export const PRM_URL
  = 'https://mcp.example.com/.well-known/oauth-protected-resource/mcp'
export const AS_METADATA_URL
  = 'https://auth.example.com/.well-known/oauth-authorization-server'
export const AUTHORIZE_URL = 'https://auth.example.com/authorize'
export const TOKEN_URL = 'https://auth.example.com/token'
export const REGISTER_URL = 'https://auth.example.com/register'
export const REVOKE_URL = 'https://auth.example.com/revoke'
export const DCR_CLIENT_ID = 'dcr-client-1'
export const AUTH_CODE = 'auth-code-secret-1'

export type RefreshBehavior = 'ok' | 'invalid_grant' | 'server_error'

export interface MockAuthServerOptions {
  probeStatus?: number
  challenge?: string | null
  protectedResource?: Record<string, unknown> | null
  metadata?: Record<string, unknown>
  grantedScope?: string | null
  expiresIn?: number
}

export interface RecordedRequest {
  url: string
  method: string
  headers: Headers
  body: string
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function challengeOf(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

export function defaultMetadata(): Record<string, unknown> {
  return {
    issuer: ISSUER,
    authorization_endpoint: AUTHORIZE_URL,
    token_endpoint: TOKEN_URL,
    registration_endpoint: REGISTER_URL,
    revocation_endpoint: REVOKE_URL,
    response_types_supported: ['code'],
    code_challenge_methods_supported: ['S256'],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
  }
}

/**
 * A scripted MCP server plus authorization server behind a `fetch` stub:
 * the 401 probe, protected-resource metadata, RFC 8414 metadata, DCR, the
 * token endpoint (code and refresh grants, PKCE checked) and revocation.
 */
export function createMockAuthServer(options: MockAuthServerOptions = {}) {
  const requests: RecordedRequest[] = []
  const challenges = new Map<string, string>()
  const state = {
    refreshBehavior: 'ok' as RefreshBehavior,
    refreshCount: 0,
    issuedCodes: new Set<string>(),
    metadata: options.metadata ?? defaultMetadata(),
  }

  async function handle(url: string, init: RequestInit): Promise<Response> {
    const method = init.method ?? 'GET'
    const body = typeof init.body === 'string' ? init.body : ''

    requests.push({ url, method, headers: new Headers(init.headers), body })

    if (url === MCP_SERVER_URL && method === 'POST') {
      const challenge = options.challenge === undefined
        ? `Bearer resource_metadata="${PRM_URL}", scope="read write"`
        : options.challenge

      return new Response('unauthorized', {
        status: options.probeStatus ?? 401,
        headers: challenge ? { 'www-authenticate': challenge } : {},
      })
    }

    if (url === PRM_URL) {
      if (options.protectedResource === null) {
        return new Response('missing', { status: 404 })
      }

      return json(options.protectedResource ?? {
        resource: MCP_SERVER_URL,
        authorization_servers: [ISSUER],
        scopes_supported: ['read', 'write'],
      })
    }

    if (url === AS_METADATA_URL) {
      return json(state.metadata)
    }

    if (url === REGISTER_URL && method === 'POST') {
      return json({ client_id: DCR_CLIENT_ID }, 201)
    }

    if (url === REVOKE_URL && method === 'POST') {
      return new Response(null, { status: 200 })
    }

    if (url === TOKEN_URL && method === 'POST') {
      return handleToken(new URLSearchParams(body))
    }

    return new Response('not found', { status: 404 })
  }

  function handleToken(form: URLSearchParams): Response {
    if (form.get('grant_type') === 'authorization_code') {
      const code = form.get('code') ?? ''
      const verifier = form.get('code_verifier') ?? ''

      if (
        !state.issuedCodes.has(code)
        || challenges.get(code) !== challengeOf(verifier)
      ) {
        return json({ error: 'invalid_grant' }, 400)
      }

      state.issuedCodes.delete(code)

      return json({
        access_token: 'access-token-1',
        refresh_token: 'refresh-token-1',
        token_type: 'Bearer',
        expires_in: options.expiresIn ?? 3600,
        ...(options.grantedScope !== undefined && options.grantedScope !== null
          ? { scope: options.grantedScope }
          : {}),
      })
    }

    if (form.get('grant_type') === 'refresh_token') {
      state.refreshCount += 1

      if (state.refreshBehavior === 'invalid_grant') {
        return json({
          error: 'invalid_grant',
          error_description: 'refresh token revoked at secret-host.internal',
        }, 400)
      }

      if (state.refreshBehavior === 'server_error') {
        return json({ error: 'server_error' }, 500)
      }

      return json({
        access_token: `access-token-r${state.refreshCount}`,
        refresh_token: `refresh-token-r${state.refreshCount}`,
        token_type: 'bearer',
        expires_in: 3600,
      })
    }

    return json({ error: 'unsupported_grant_type' }, 400)
  }

  const fetch = vi.fn(async (input: string | URL, init: RequestInit = {}) => {
    return await handle(String(input), init)
  })

  /**
   * Plays the user approving at the authorization endpoint: records the
   * PKCE challenge for a fresh code and returns the callback query.
   */
  function authorize(authorizationUrl: string, code = AUTH_CODE) {
    const url = new URL(authorizationUrl)

    challenges.set(code, url.searchParams.get('code_challenge') ?? '')
    state.issuedCodes.add(code)

    return {
      code,
      state: url.searchParams.get('state') ?? '',
      iss: ISSUER,
      params: url.searchParams,
    }
  }

  function requestsTo(url: string): RecordedRequest[] {
    return requests.filter((request) => {
      return request.url === url
    })
  }

  return { fetch, requests, requestsTo, authorize, state }
}

export type MockAuthServer = ReturnType<typeof createMockAuthServer>

export function fakeEncrypt(plain: string): string {
  return `enc:${Buffer.from(plain).toString('base64')}:${Math.random()}`
}

export function fakeDecrypt(cipher: string): string {
  const [, payload] = cipher.split(':')

  return Buffer.from(payload ?? '', 'base64').toString()
}

export function createFakeConnectorKv() {
  const values = new Map<string, string>()
  const ttls = new Map<string, number | undefined>()

  return {
    values,
    ttls,
    get: vi.fn(async (key: string) => {
      return values.get(key) ?? null
    }),
    put: vi.fn(async (
      key: string,
      value: string,
      putOptions?: { expirationTtl?: number },
    ) => {
      if (
        putOptions?.expirationTtl !== undefined
        && putOptions.expirationTtl < 60
      ) {
        throw new Error('KV expirationTtl must be at least 60 seconds')
      }

      values.set(key, value)
      ttls.set(key, putOptions?.expirationTtl)
    }),
    delete: vi.fn(async (key: string) => {
      values.delete(key)
    }),
  }
}

export type FakeConnectorKv = ReturnType<typeof createFakeConnectorKv>

/**
 * The portable `nuxt/server` helpers the connector routes use, reading from
 * the plain skills test event. Loaded through `vi.mock`.
 */
export async function connectorsNuxtServerMockFactory() {
  const { skillsNuxtServerMockFactory } = await import('./skills-route')
  const base = await skillsNuxtServerMockFactory()

  return {
    ...base,
    getRouterParam: (
      event: { params: Record<string, string> },
      name: string,
    ) => event.params[name],
    sendRedirect: (
      event: { status?: number, res: { headers: Headers } },
      location: string,
      status = 302,
    ) => {
      event.status = status
      event.res.headers.set('location', location)

      return location
    },
  }
}
