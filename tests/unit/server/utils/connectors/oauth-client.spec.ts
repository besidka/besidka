import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  REGISTER_URL,
  REVOKE_URL,
  TOKEN_URL,
  defaultMetadata,
  ISSUER,
} from '../../../../setup/helpers/connectors-oauth'
import { buildConnectorClientMetadata } from '~~/server/utils/connectors/client-metadata'
import {
  buildAuthorizationUrl,
  createOAuthState,
  createPkcePair,
  exchangeAuthorizationCode,
  refreshAccessToken,
  registerDynamicClient,
  revokeToken,
} from '~~/server/utils/connectors/oauth-client'
import { parseAuthorizationServerMetadata } from '~~/server/utils/connectors/oauth-metadata'
import type { ConnectorClientRegistration } from '~~/server/utils/connectors/store'

const fetchMock = vi.fn()

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function lastRequest() {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit]

  return {
    url,
    headers: new Headers(init.headers),
    form: new URLSearchParams(String(init.body)),
    body: String(init.body),
  }
}

const publicClient: ConnectorClientRegistration = {
  clientId: 'client-1',
  registrationKind: 'cimd',
  tokenEndpointAuthMethod: 'none',
  tokenEndpoint: TOKEN_URL,
  revocationEndpoint: REVOKE_URL,
  resource: 'https://mcp.example.com/mcp',
}

describe('connector OAuth client', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('creates an S256 PKCE pair and a random state', async () => {
    const pair = await createPkcePair()

    expect(pair.verifier).toMatch(/^[\w-]{43}$/)
    expect(pair.challenge).toBe(
      createHash('sha256').update(pair.verifier).digest('base64url'),
    )
    expect(createOAuthState()).not.toBe(createOAuthState())
  })

  it('builds the authorization URL and keeps endpoint parameters',
    () => {
      const url = new URL(buildAuthorizationUrl({
        authorizationEndpoint: 'https://auth.example.com/authorize?tenant=a',
        clientId: 'client-1',
        redirectUri: 'https://besidka.com/cb',
        codeChallenge: 'challenge',
        state: 'state',
        resource: 'https://mcp.example.com/mcp',
        scope: null,
      }))

      expect(url.searchParams.get('tenant')).toBe('a')
      expect(url.searchParams.get('code_challenge_method')).toBe('S256')
      expect(url.searchParams.has('scope')).toBe(false)
    })

  describe('registerDynamicClient', () => {
    const metadata = parseAuthorizationServerMetadata(
      { ...defaultMetadata(), client_id_metadata_document_supported: false },
      ISSUER,
    )

    it('registers a public client without redirects', async () => {
      fetchMock.mockResolvedValue(json({ client_id: 'dcr-1' }, 201))

      const registration = await registerDynamicClient({
        metadata,
        clientMetadata: buildConnectorClientMetadata('https://besidka.com'),
        resource: 'https://mcp.example.com/mcp',
      })

      expect(registration).toMatchObject({
        clientId: 'dcr-1',
        registrationKind: 'dcr',
        tokenEndpointAuthMethod: 'none',
        redirectUri: 'https://besidka.com/api/v1/connectors/oauth/callback',
      })
      expect(registration).not.toHaveProperty('clientSecret')
      expect(lastRequest().url).toBe(REGISTER_URL)
    })

    it('keeps a secret the server insists on', async () => {
      fetchMock.mockResolvedValue(json({
        client_id: 'dcr-1',
        client_secret: 'shh',
        token_endpoint_auth_method: 'client_secret_basic',
      }))

      expect(await registerDynamicClient({
        metadata,
        clientMetadata: buildConnectorClientMetadata('https://besidka.com'),
        resource: 'https://mcp.example.com/mcp',
      })).toMatchObject({
        clientSecret: 'shh',
        tokenEndpointAuthMethod: 'client_secret_basic',
      })
    })

    it.each([
      [json({ error: 'invalid_client_metadata' }, 400)],
      [json({ client_id: 42 })],
      [json({ client_id: 'x', token_endpoint_auth_method: 'private_key_jwt' })],
      [new Response('<html>', { status: 200 })],
    ])('refuses a failed registration', async (response) => {
      fetchMock.mockResolvedValue(response)

      await expect(registerDynamicClient({
        metadata,
        clientMetadata: buildConnectorClientMetadata('https://besidka.com'),
        resource: 'https://mcp.example.com/mcp',
      })).rejects.toMatchObject({ code: 'CONNECTOR_OAUTH_REGISTRATION_FAILED' })
    })

    it('says so when the server does not approve the redirect address',
      async () => {
        const logger = { set: vi.fn() }

        fetchMock.mockResolvedValue(json({
          error: 'invalid_redirect_uri',
          error_description: 'The provided redirect URIs are not approved',
        }, 400))

        await expect(registerDynamicClient({
          metadata,
          clientMetadata: buildConnectorClientMetadata('https://besidka.com'),
          resource: 'https://mcp.example.com/mcp',
          logger,
        })).rejects.toMatchObject({
          code: 'CONNECTOR_OAUTH_REDIRECT_NOT_ALLOWED',
        })
        expect(logger.set).toHaveBeenCalledWith({
          attributes: {
            connectors: {
              step: 'oauth-registration-refused',
              status: 400,
              error: 'invalid_redirect_uri',
            },
          },
        })
      })

    it('never logs a crafted error code from the registration endpoint',
      async () => {
        const logger = { set: vi.fn() }

        fetchMock.mockResolvedValue(json({
          error: 'Bearer secret-token <script>',
        }, 400))

        await expect(registerDynamicClient({
          metadata,
          clientMetadata: buildConnectorClientMetadata('https://besidka.com'),
          resource: 'https://mcp.example.com/mcp',
          logger,
        })).rejects.toMatchObject({
          code: 'CONNECTOR_OAUTH_REGISTRATION_FAILED',
        })
        expect(JSON.stringify(logger.set.mock.calls))
          .not.toContain('secret-token')
      })

    it('never follows a redirect from the registration endpoint',
      async () => {
        fetchMock.mockResolvedValue(new Response(null, {
          status: 307,
          headers: { location: 'https://elsewhere.example.com/register' },
        }))

        await expect(registerDynamicClient({
          metadata,
          clientMetadata: buildConnectorClientMetadata('https://besidka.com'),
          resource: 'https://mcp.example.com/mcp',
        })).rejects.toMatchObject({ code: 'safe-fetch-redirects' })
        expect(fetchMock).toHaveBeenCalledTimes(1)
      })
  })

  describe('token requests', () => {
    it('sends a public client id in the body', async () => {
      fetchMock.mockResolvedValue(json({
        access_token: 'a',
        token_type: 'Bearer',
        expires_in: 60,
      }))

      const result = await exchangeAuthorizationCode({
        registration: publicClient,
        code: 'code',
        codeVerifier: 'verifier',
        redirectUri: 'https://besidka.com/cb',
        resource: 'https://mcp.example.com/mcp',
      })

      expect(result.ok).toBe(true)
      expect(lastRequest().form.get('client_id')).toBe('client-1')
      expect(lastRequest().headers.has('authorization')).toBe(false)
    })

    it('uses HTTP Basic for client_secret_basic', async () => {
      fetchMock.mockResolvedValue(json({ access_token: 'a' }))

      await refreshAccessToken({
        registration: {
          ...publicClient,
          clientSecret: 's e/cret',
          tokenEndpointAuthMethod: 'client_secret_basic',
        },
        refreshToken: 'r',
      })

      const { headers, form } = lastRequest()

      expect(headers.get('authorization')).toBe(
        `Basic ${Buffer.from('client-1:s+e%2Fcret').toString('base64')}`,
      )
      expect(form.has('client_secret')).toBe(false)
      expect(form.has('client_id')).toBe(false)
    })

    it('posts the secret for client_secret_post', async () => {
      fetchMock.mockResolvedValue(json({ access_token: 'a' }))

      await refreshAccessToken({
        registration: {
          ...publicClient,
          clientSecret: 'secret',
          tokenEndpointAuthMethod: 'client_secret_post',
        },
        refreshToken: 'r',
      })

      expect(lastRequest().form.get('client_secret')).toBe('secret')
    })

    it.each([
      [{ access_token: 'a', token_type: 'DPoP' }],
      [{ access_token: '' }],
      [{ token_type: 'Bearer' }],
    ])('refuses an invalid token response %j', async (body) => {
      fetchMock.mockResolvedValue(json(body))

      expect(await refreshAccessToken({
        registration: publicClient,
        refreshToken: 'r',
      })).toEqual({ ok: false, invalidGrant: false })
    })

    it('reports invalid_grant', async () => {
      fetchMock.mockResolvedValue(json({ error: 'invalid_grant' }, 400))

      expect(await refreshAccessToken({
        registration: publicClient,
        refreshToken: 'r',
      })).toEqual({ ok: false, invalidGrant: true })
    })

    it('computes the expiry from expires_in', async () => {
      fetchMock.mockResolvedValue(json({ access_token: 'a', expires_in: 120 }))

      const before = Date.now()
      const result = await refreshAccessToken({
        registration: publicClient,
        refreshToken: 'r',
      })

      expect(result.ok && result.tokens.expiresAt!.getTime())
        .toBeGreaterThanOrEqual(before + 120_000)
    })
  })

  describe('revokeToken', () => {
    it('posts the token with its type hint', async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 200 }))

      expect(await revokeToken({
        registration: publicClient,
        token: 'refresh',
        tokenTypeHint: 'refresh_token',
      })).toBe(true)
      expect(lastRequest().url).toBe(REVOKE_URL)
      expect(lastRequest().form.get('token_type_hint')).toBe('refresh_token')
    })

    it('never throws', async () => {
      fetchMock.mockRejectedValue(new TypeError('connection refused'))

      expect(await revokeToken({
        registration: publicClient,
        token: 'refresh',
        tokenTypeHint: 'refresh_token',
      })).toBe(false)
    })

    it('does nothing without a revocation endpoint', async () => {
      expect(await revokeToken({
        registration: { ...publicClient, revocationEndpoint: null },
        token: 'refresh',
        tokenTypeHint: 'refresh_token',
      })).toBe(false)
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })
})
