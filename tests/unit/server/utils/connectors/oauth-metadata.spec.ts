import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ISSUER,
  MCP_SERVER_URL,
  PRM_URL,
  createMockAuthServer,
  defaultMetadata,
} from '../../../../setup/helpers/connectors-oauth'
import {
  discoverConnectorAuth,
  parseAuthorizationServerMetadata,
  parseBearerChallenge,
  resourceCoversUrl,
} from '~~/server/utils/connectors/oauth-metadata'

async function failureOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (exception) {
    return exception as { status: number, code?: string }
  }

  throw new Error('Expected a rejection')
}

function failureOfSync(run: () => unknown) {
  try {
    run()
  } catch (exception) {
    return exception as { code?: string }
  }

  throw new Error('Expected a throw')
}

describe('connector OAuth metadata', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('parseBearerChallenge', () => {
    it('reads resource_metadata and scope', () => {
      expect(parseBearerChallenge(
        `Bearer realm="mcp", resource_metadata="${PRM_URL}", scope="a b"`,
      )).toEqual({ resourceMetadata: PRM_URL, scope: 'a b' })
    })

    it('reads token values and a Bearer challenge after another scheme',
      () => {
        expect(parseBearerChallenge(
          'Basic realm="x", Bearer resource_metadata=https://a.example/prm',
        )).toEqual({
          resourceMetadata: 'https://a.example/prm',
          scope: null,
        })
      })

    it('returns null without a Bearer challenge', () => {
      expect(parseBearerChallenge('Basic realm="x"')).toBeNull()
      expect(parseBearerChallenge(null)).toBeNull()
    })
  })

  describe('resourceCoversUrl', () => {
    it.each([
      ['https://mcp.example.com/mcp', true],
      ['https://mcp.example.com/mcp/', true],
      ['https://mcp.example.com', true],
      ['https://mcp.example.com/m', false],
      ['https://mcp.example.com/other', false],
      ['https://evil.example.com/mcp', false],
      ['https://mcp.example.com/mcp?x=1', false],
      ['not a url', false],
    ])('%s covers the connector URL: %s', (resource, covers) => {
      expect(resourceCoversUrl(resource, MCP_SERVER_URL)).toBe(covers)
    })
  })

  describe('parseAuthorizationServerMetadata', () => {
    it('accepts valid metadata', () => {
      expect(parseAuthorizationServerMetadata(defaultMetadata(), ISSUER))
        .toMatchObject({
          issuer: ISSUER,
          clientIdMetadataDocumentSupported: true,
          issParameterSupported: true,
        })
    })

    it('tolerates one trailing slash on the issuer', () => {
      expect(parseAuthorizationServerMetadata(
        { ...defaultMetadata(), issuer: `${ISSUER}/` },
        ISSUER,
      ).issuer).toBe(`${ISSUER}/`)
    })

    it.each([
      ['another issuer', { issuer: 'https://evil.example.org' }],
      ['no token endpoint', { token_endpoint: undefined }],
      ['an http endpoint', { authorization_endpoint: 'http://auth.example.com/a' }],
      ['an IP endpoint', { token_endpoint: 'https://10.0.0.1/token' }],
      ['no code response type', { response_types_supported: ['token'] }],
    ])('refuses %s', (_label, change) => {
      expect(failureOfSync(() => {
        return parseAuthorizationServerMetadata(
          { ...defaultMetadata(), ...change },
          ISSUER,
        )
      }).code).toBe('CONNECTOR_OAUTH_METADATA_INVALID')
    })

    it.each([
      [['plain']],
      [undefined],
      [[]],
    ])('refuses PKCE methods %j', (methods) => {
      expect(failureOfSync(() => {
        return parseAuthorizationServerMetadata(
          { ...defaultMetadata(), code_challenge_methods_supported: methods },
          ISSUER,
        )
      }).code).toBe('CONNECTOR_OAUTH_PKCE_UNSUPPORTED')
    })

    it('drops an unsafe revocation endpoint instead of using it', () => {
      expect(parseAuthorizationServerMetadata(
        { ...defaultMetadata(), revocation_endpoint: 'https://localhost/r' },
        ISSUER,
      ).revocationEndpoint).toBeNull()
    })
  })

  describe('discoverConnectorAuth', () => {
    beforeEach(() => {
      vi.stubGlobal('fetch', createMockAuthServer().fetch)
    })

    it('finds OAuth through the challenge', async () => {
      const discovery = await discoverConnectorAuth(MCP_SERVER_URL)

      expect(discovery.authType).toBe('oauth')
      expect(discovery.authType === 'oauth' && discovery.oauth).toMatchObject({
        resource: MCP_SERVER_URL,
        issuer: ISSUER,
        requestedScope: 'read write',
      })
    })

    it('falls back to the well-known URL without a challenge', async () => {
      const server = createMockAuthServer({ challenge: 'Bearer' })

      vi.stubGlobal('fetch', server.fetch)

      expect((await discoverConnectorAuth(MCP_SERVER_URL)).authType)
        .toBe('oauth')
      expect(server.requestsTo(PRM_URL)).toHaveLength(1)
    })

    it('reports no auth for a 2xx probe', async () => {
      vi.stubGlobal('fetch', createMockAuthServer({ probeStatus: 200 }).fetch)

      expect(await discoverConnectorAuth(MCP_SERVER_URL))
        .toEqual({ authType: 'none' })
    })

    it('reports header auth for a 403 without metadata', async () => {
      vi.stubGlobal('fetch', createMockAuthServer({
        probeStatus: 403,
        challenge: null,
        protectedResource: null,
      }).fetch)

      expect(await discoverConnectorAuth(MCP_SERVER_URL))
        .toEqual({ authType: 'header' })
    })

    it('reports header auth without metadata requests when OAuth is not allowed', async () => {
      const server = createMockAuthServer()

      vi.stubGlobal('fetch', server.fetch)

      expect(await discoverConnectorAuth(
        MCP_SERVER_URL,
        undefined,
        { allowOAuth: false },
      )).toEqual({ authType: 'header' })
      expect(server.requestsTo(PRM_URL)).toHaveLength(0)
      expect(server.requestsTo(MCP_SERVER_URL)).toHaveLength(1)
    })

    it('still reports no auth when OAuth is not allowed and the probe is 2xx', async () => {
      vi.stubGlobal('fetch', createMockAuthServer({ probeStatus: 200 }).fetch)

      expect(await discoverConnectorAuth(
        MCP_SERVER_URL,
        undefined,
        { allowOAuth: false },
      )).toEqual({ authType: 'none' })
    })

    it('fails on any other status', async () => {
      vi.stubGlobal('fetch', createMockAuthServer({ probeStatus: 500 }).fetch)

      expect((await failureOf(discoverConnectorAuth(MCP_SERVER_URL))).code)
        .toBe('CONNECTOR_DISCOVERY_FAILED')
    })

    it('refuses metadata for another resource', async () => {
      vi.stubGlobal('fetch', createMockAuthServer({
        protectedResource: {
          resource: 'https://other.example.com/mcp',
          authorization_servers: [ISSUER],
        },
      }).fetch)

      expect((await failureOf(discoverConnectorAuth(MCP_SERVER_URL))).code)
        .toBe('CONNECTOR_OAUTH_METADATA_INVALID')
    })

    it('refuses metadata without a resource', async () => {
      vi.stubGlobal('fetch', createMockAuthServer({
        protectedResource: { authorization_servers: [ISSUER] },
      }).fetch)

      expect((await failureOf(discoverConnectorAuth(MCP_SERVER_URL))).code)
        .toBe('CONNECTOR_OAUTH_METADATA_INVALID')
    })

    it('sends the probe without credentials', async () => {
      const server = createMockAuthServer()

      vi.stubGlobal('fetch', server.fetch)
      await discoverConnectorAuth(MCP_SERVER_URL)

      const [probe] = server.requestsTo(MCP_SERVER_URL)

      expect(probe!.headers.has('authorization')).toBe(false)
      expect(probe!.headers.has('cookie')).toBe(false)
      expect(JSON.parse(probe!.body).method).toBe('initialize')
    })
  })
})
