import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import { CONNECTOR_CONSENT_VERSION } from '#shared/utils/connectors-policy'
import {
  createMemoryExtractionTestDb,
  seedUser,
} from '../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../setup/helpers/memory-extraction-db'
import { createSkillsRouteEvent } from '../../setup/helpers/skills-route'
import type { SkillsRouteEvent } from '../../setup/helpers/skills-route'
import {
  AUTH_CODE,
  DCR_CLIENT_ID,
  ISSUER,
  MCP_ORIGIN,
  MCP_SERVER_URL,
  REGISTER_URL,
  REVOKE_URL,
  TOKEN_URL,
  createFakeConnectorKv,
  createMockAuthServer,
  defaultMetadata,
  fakeDecrypt,
  fakeEncrypt,
} from '../../setup/helpers/connectors-oauth'
import type {
  FakeConnectorKv,
  MockAuthServer,
  MockAuthServerOptions,
} from '../../setup/helpers/connectors-oauth'

const PRODUCTION_ORIGIN = 'https://besidka.com'
const PREVIEW_ORIGIN = 'https://pr-12-besidka.chernenko.workers.dev'

const mocks = vi.hoisted(() => ({
  flags: new Set<string>(['connectors', 'connectors.oauth']),
  origin: 'https://besidka.com',
  logged: [] as unknown[],
}))

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { skillPublicIdMockFactory } = await import(
    '../../setup/helpers/skills-public-id-mock'
  )

  return await skillPublicIdMockFactory()
})

vi.mock('nuxt/server', async () => {
  const { connectorsNuxtServerMockFactory } = await import(
    '../../setup/helpers/connectors-oauth'
  )

  return await connectorsNuxtServerMockFactory()
})

vi.mock('~~/server/utils/features/guards', () => ({
  requireFeature: async (_event: unknown, flag: string) => {
    if (!mocks.flags.has(flag)) {
      throw Object.assign(new Error('Not found'), { status: 404 })
    }

    return { active: true }
  },
}))

vi.mock('~~/server/utils/logging/request-logger', () => ({
  useRequestLogger: () => ({
    set: (values: unknown) => {
      mocks.logged.push(values)
    },
  }),
}))

vi.mock('~~/server/utils/request-public-origin', () => ({
  resolveRequestPublicOrigin: () => mocks.origin,
}))

type Handler = (event: SkillsRouteEvent) => Promise<any>

async function handler(path: string): Promise<Handler> {
  const module = await import(path)

  return module.default as Handler
}

async function failureOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (exception) {
    return exception as { status: number, code?: string, message: string }
  }

  throw new Error('Expected a rejection')
}

describe('connector OAuth flow', () => {
  let testDb: MemoryExtractionTestDb
  let kv: FakeConnectorKv
  let server: MockAuthServer
  let userId: number
  let sessionUserId: number
  const thrown: unknown[] = []

  function useServer(options: MockAuthServerOptions = {}) {
    server = createMockAuthServer(options)
    vi.stubGlobal('fetch', server.fetch)

    return server
  }

  async function call(
    path: string,
    partial: Partial<SkillsRouteEvent> = {},
  ) {
    const event = createSkillsRouteEvent(partial)

    try {
      const result = await (await handler(path))(event)

      return { result, event }
    } catch (exception) {
      thrown.push(exception)

      throw exception
    }
  }

  async function createConnector(body: Record<string, unknown> = {
    url: MCP_SERVER_URL,
  }) {
    const { result } = await call('~~/server/api/v1/connectors/index.post', {
      body,
    })

    return result.connector as { id: string, status: string }
  }

  async function discover(id: string) {
    const { result } = await call(
      '~~/server/api/v1/connectors/[id]/connect/discover.post',
      { params: { id } },
    )

    return result
  }

  async function consent(id: string, issuerHost: string | null) {
    return await call('~~/server/api/v1/connectors/[id]/consent/index.post', {
      params: { id },
      body: { accepted: true, version: CONNECTOR_CONSENT_VERSION, issuerHost },
    })
  }

  async function start(id: string) {
    const { result } = await call(
      '~~/server/api/v1/connectors/[id]/oauth/start.post',
      { params: { id } },
    )

    return result.authorizationUrl as string
  }

  async function callback(query: Record<string, string>) {
    const { event } = await call(
      '~~/server/api/v1/connectors/oauth/callback.get',
      { query },
    )

    return event.res.headers.get('location') ?? ''
  }

  async function connectedConnector() {
    const connector = await createConnector()

    await discover(connector.id)
    await consent(connector.id, 'auth.example.com')

    const authorizationUrl = await start(connector.id)
    const approval = server.authorize(authorizationUrl)
    const location = await callback({
      code: approval.code,
      state: approval.state,
      iss: approval.iss,
    })

    return { connector, authorizationUrl, approval, location }
  }

  async function credentialRows() {
    return await testDb.db.select()
      .from(schema.connectorCredentials)
      .where(eq(schema.connectorCredentials.userId, userId))
  }

  async function connectorRow(id: string) {
    const [row] = await testDb.db.select()
      .from(schema.connectors)
      .where(eq(schema.connectors.id, Number(id.slice(3))))

    return row!
  }

  beforeEach(async () => {
    mocks.flags = new Set(['connectors', 'connectors.oauth'])
    mocks.origin = PRODUCTION_ORIGIN
    mocks.logged = []
    thrown.length = 0
    testDb = createMemoryExtractionTestDb()
    kv = createFakeConnectorKv()
    userId = await seedUser(testDb.db)
    sessionUserId = userId
    useServer()
    vi.stubGlobal('useDb', () => testDb.db)
    vi.stubGlobal('useKV', () => kv)
    vi.stubGlobal('useEncryptText', vi.fn(async (plain: string) => {
      return fakeEncrypt(plain)
    }))
    vi.stubGlobal('useDecryptText', vi.fn(async (cipher: string) => {
      return fakeDecrypt(cipher)
    }))
    vi.stubGlobal('useUserSession', async () => {
      return { user: { id: String(sessionUserId) } }
    })
    vi.stubGlobal('useUnauthorizedError', () => {
      throw Object.assign(new Error('Unauthorized'), { status: 401 })
    })
  })

  afterEach(() => {
    testDb.close()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  describe('happy path with CIMD', () => {
    it('connects without a registration request and stores the tokens '
      + 'encrypted', async () => {
      const {
        connector,
        authorizationUrl,
        location,
      } = await connectedConnector()
      const url = new URL(authorizationUrl)

      expect(url.origin + url.pathname).toBe('https://auth.example.com/authorize')
      expect(url.searchParams.get('client_id'))
        .toBe(`${PRODUCTION_ORIGIN}/connectors/client-metadata.json`)
      expect(url.searchParams.get('redirect_uri'))
        .toBe(`${PRODUCTION_ORIGIN}/api/v1/connectors/oauth/callback`)
      expect(url.searchParams.get('code_challenge_method')).toBe('S256')
      expect(url.searchParams.get('code_challenge')).toMatch(/^[\w-]{43}$/)
      expect(url.searchParams.get('resource')).toBe(MCP_SERVER_URL)
      expect(url.searchParams.get('scope')).toBe('read write')
      expect(url.searchParams.get('state')).toMatch(/^[\w-]{43}$/)
      expect(server.requestsTo(REGISTER_URL)).toHaveLength(0)
      expect(location).toBe(`/profile/connectors?connected=${connector.id}`)

      const [tokenRequest] = server.requestsTo(TOKEN_URL)
      const form = new URLSearchParams(tokenRequest!.body)

      expect(form.get('grant_type')).toBe('authorization_code')
      expect(form.get('code')).toBe(AUTH_CODE)
      expect(form.get('code_verifier')).toMatch(/^[\w-]{43}$/)
      expect(form.get('resource')).toBe(MCP_SERVER_URL)
      expect(form.get('redirect_uri'))
        .toBe(`${PRODUCTION_ORIGIN}/api/v1/connectors/oauth/callback`)
      expect(form.get('client_id'))
        .toBe(`${PRODUCTION_ORIGIN}/connectors/client-metadata.json`)
      expect(tokenRequest!.headers.has('authorization')).toBe(false)

      const [row] = await credentialRows()

      expect(row!.issuer).toBe(ISSUER)
      expect(row!.accessToken).not.toContain('access-token-1')
      expect(fakeDecrypt(row!.accessToken!)).toBe('access-token-1')
      expect(fakeDecrypt(row!.refreshToken!)).toBe('refresh-token-1')
      expect(JSON.parse(fakeDecrypt(row!.clientRegistration!))).toMatchObject({
        registrationKind: 'cimd',
        tokenEndpoint: TOKEN_URL,
        revocationEndpoint: REVOKE_URL,
        resource: MCP_SERVER_URL,
      })
      expect(row!.scope).toBe('read write')

      const stored = await connectorRow(connector.id)

      expect(stored.status).toBe('ready')
      expect(stored.authType).toBe('oauth')
      expect(stored.enabled).toBe(false)
      expect(stored.lastError).toBeNull()
    })

    it('reports the issuer host from discovery', async () => {
      const connector = await createConnector()
      const result = await discover(connector.id)

      expect(result).toMatchObject({
        authType: 'oauth',
        host: 'mcp.example.com',
        issuerHost: 'auth.example.com',
        issuerDiffers: true,
      })
    })

    it('uses the allow-listed preview origin for client id and redirect',
      async () => {
        mocks.origin = PREVIEW_ORIGIN

        const { authorizationUrl, location } = await connectedConnector()
        const url = new URL(authorizationUrl)

        expect(url.searchParams.get('client_id'))
          .toBe(`${PREVIEW_ORIGIN}/connectors/client-metadata.json`)
        expect(url.searchParams.get('redirect_uri'))
          .toBe(`${PREVIEW_ORIGIN}/api/v1/connectors/oauth/callback`)
        expect(location).toContain('connected=')
      })
  })

  describe('DCR fallback', () => {
    it('registers when the issuer does not accept CIMD, and reuses the '
      + 'registration for the same redirect URI', async () => {
      useServer({
        metadata: {
          ...defaultMetadata(),
          client_id_metadata_document_supported: false,
        },
      })

      const {
        connector,
        authorizationUrl,
        location,
      } = await connectedConnector()

      expect(new URL(authorizationUrl).searchParams.get('client_id'))
        .toBe(DCR_CLIENT_ID)
      expect(location).toContain('connected=')

      const [registration] = server.requestsTo(REGISTER_URL)
      const registrationBody = JSON.parse(registration!.body)

      expect(registrationBody).toMatchObject({
        client_name: 'Besidka',
        redirect_uris: [`${PRODUCTION_ORIGIN}/api/v1/connectors/oauth/callback`],
        token_endpoint_auth_method: 'none',
      })
      expect(registrationBody).not.toHaveProperty('client_id')

      const [row] = await credentialRows()

      expect(JSON.parse(fakeDecrypt(row!.clientRegistration!))).toMatchObject({
        clientId: DCR_CLIENT_ID,
        registrationKind: 'dcr',
      })

      await start(connector.id)

      expect(server.requestsTo(REGISTER_URL)).toHaveLength(1)
    })

    it('registers again on another origin', async () => {
      useServer({
        metadata: {
          ...defaultMetadata(),
          client_id_metadata_document_supported: false,
        },
      })

      const { connector } = await connectedConnector()

      mocks.origin = PREVIEW_ORIGIN
      await start(connector.id)

      expect(server.requestsTo(REGISTER_URL)).toHaveLength(2)
    })

    it('refuses an issuer with neither CIMD nor DCR', async () => {
      useServer({
        metadata: {
          ...defaultMetadata(),
          client_id_metadata_document_supported: false,
          registration_endpoint: undefined,
        },
      })

      const connector = await createConnector()

      await consent(connector.id, 'auth.example.com')

      const failure = await failureOf(start(connector.id))

      expect(failure.code).toBe('CONNECTOR_OAUTH_NO_REGISTRATION')
    })
  })

  describe('refusals', () => {
    it('refuses an authorization server without S256', async () => {
      useServer({
        metadata: {
          ...defaultMetadata(),
          code_challenge_methods_supported: ['plain'],
        },
      })

      const connector = await createConnector()

      await consent(connector.id, 'auth.example.com')

      const failure = await failureOf(start(connector.id))

      expect(failure.code).toBe('CONNECTOR_OAUTH_PKCE_UNSUPPORTED')
      expect([...kv.values.keys()].some((key) => {
        return key.startsWith('connectors:oauth:')
      })).toBe(false)
    })

    it('refuses a metadata document whose issuer differs', async () => {
      useServer({
        metadata: { ...defaultMetadata(), issuer: 'https://evil.example.org' },
      })

      const connector = await createConnector()

      await consent(connector.id, 'auth.example.com')

      expect((await failureOf(start(connector.id))).code)
        .toBe('CONNECTOR_OAUTH_METADATA_INVALID')
    })

    it('refuses a wrong iss and keeps the state used', async () => {
      const connector = await createConnector()

      await consent(connector.id, 'auth.example.com')

      const approval = server.authorize(await start(connector.id))
      const location = await callback({
        code: approval.code,
        state: approval.state,
        iss: 'https://evil.example.org',
      })

      expect(location)
        .toBe('/profile/connectors?error=CONNECTOR_OAUTH_ISSUER_MISMATCH')
      expect(server.requestsTo(TOKEN_URL)).toHaveLength(0)

      const replay = await callback({
        code: approval.code,
        state: approval.state,
        iss: approval.iss,
      })

      expect(replay).toBe('/profile/connectors?error=CONNECTOR_OAUTH_STATE_INVALID')
      expect(await credentialRows()).toHaveLength(0)
    })

    it('refuses a missing iss when the issuer advertises it', async () => {
      const connector = await createConnector()

      await consent(connector.id, 'auth.example.com')

      const approval = server.authorize(await start(connector.id))

      expect(await callback({ code: approval.code, state: approval.state }))
        .toBe('/profile/connectors?error=CONNECTOR_OAUTH_ISSUER_MISMATCH')
    })

    it('refuses a replayed state', async () => {
      const { approval } = await connectedConnector()
      const replay = await callback({
        code: approval.code,
        state: approval.state,
        iss: approval.iss,
      })

      expect(replay).toBe('/profile/connectors?error=CONNECTOR_OAUTH_STATE_INVALID')
      expect(server.requestsTo(TOKEN_URL)).toHaveLength(1)
    })

    it('refuses an expired state', async () => {
      const connector = await createConnector()

      await consent(connector.id, 'auth.example.com')

      const approval = server.authorize(await start(connector.id))

      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(Date.now() + 11 * 60 * 1000)

      expect(await callback({
        code: approval.code,
        state: approval.state,
        iss: approval.iss,
      })).toBe('/profile/connectors?error=CONNECTOR_OAUTH_STATE_INVALID')
      expect(server.requestsTo(TOKEN_URL)).toHaveLength(0)
    })

    it('refuses a state that belongs to another user', async () => {
      const connector = await createConnector()

      await consent(connector.id, 'auth.example.com')

      const approval = server.authorize(await start(connector.id))

      sessionUserId = await seedUser(testDb.db)

      expect(await callback({
        code: approval.code,
        state: approval.state,
        iss: approval.iss,
      })).toBe('/profile/connectors?error=CONNECTOR_OAUTH_STATE_INVALID')
      expect(server.requestsTo(TOKEN_URL)).toHaveLength(0)
    })

    it('refuses a callback that arrives at another redirect URI', async () => {
      const connector = await createConnector()

      await consent(connector.id, 'auth.example.com')

      const approval = server.authorize(await start(connector.id))

      mocks.origin = PREVIEW_ORIGIN

      expect(await callback({
        code: approval.code,
        state: approval.state,
        iss: approval.iss,
      })).toBe('/profile/connectors?error=CONNECTOR_OAUTH_REDIRECT_MISMATCH')
      expect(server.requestsTo(TOKEN_URL)).toHaveLength(0)
    })

    it('maps an authorization error to a fixed code', async () => {
      const connector = await createConnector()

      await consent(connector.id, 'auth.example.com')

      const approval = server.authorize(await start(connector.id))

      expect(await callback({
        state: approval.state,
        error: 'access_denied',
        error_description: '<script>alert(1)</script>',
      })).toBe('/profile/connectors?error=CONNECTOR_OAUTH_DENIED')
    })
  })

  describe('reconnect', () => {
    it('revokes the tokens of the earlier sign-in', async () => {
      const { connector } = await connectedConnector()
      const approval = server.authorize(await start(connector.id), 'code-two')

      await callback({
        code: approval.code,
        state: approval.state,
        iss: approval.iss,
      })

      expect(server.requestsTo(REVOKE_URL)).toHaveLength(2)
      expect(await credentialRows()).toHaveLength(1)
    })

    it('refuses the callback when the consent was withdrawn after the start',
      async () => {
        const connector = await createConnector()

        await consent(connector.id, 'auth.example.com')

        const approval = server.authorize(await start(connector.id))

        await call('~~/server/api/v1/connectors/[id]/consent/withdraw.post', {
          params: { id: connector.id },
        })

        expect(await callback({
          code: approval.code,
          state: approval.state,
          iss: approval.iss,
        })).toBe('/profile/connectors?error=CONNECTOR_CONSENT_REQUIRED')
        expect(server.requestsTo(TOKEN_URL)).toHaveLength(0)
      })

    it('keeps the auth type of a connected connector on rediscovery',
      async () => {
        const connector = await createConnector()

        await consent(connector.id, null)
        await call('~~/server/api/v1/connectors/[id]/credentials.post', {
          params: { id: connector.id },
          body: { headerName: 'Authorization', headerValue: 'Bearer key' },
        })
        await discover(connector.id)

        expect((await connectorRow(connector.id)).authType).toBe('header')
      })
  })

  describe('consent gate', () => {
    it('refuses to start without consent', async () => {
      const connector = await createConnector()
      const failure = await failureOf(start(connector.id))

      expect(failure.status).toBe(403)
      expect(failure.code).toBe('CONNECTOR_CONSENT_REQUIRED')
      expect(server.requestsTo(REGISTER_URL)).toHaveLength(0)
    })

    it('asks again when the consent named another issuer', async () => {
      const connector = await createConnector()

      await consent(connector.id, 'other-auth.example.com')

      expect((await failureOf(start(connector.id))).code)
        .toBe('CONNECTOR_CONSENT_REQUIRED')
    })

    it('refuses an outdated consent version', async () => {
      const connector = await createConnector()
      const failure = await failureOf(call(
        '~~/server/api/v1/connectors/[id]/consent/index.post',
        {
          params: { id: connector.id },
          body: { accepted: true, version: '1999-01-a', issuerHost: null },
        },
      ))

      expect(failure.code).toBe('CONNECTOR_CONSENT_OUTDATED')
    })

    it('logs the consent with the host and the withdrawal', async () => {
      const connector = await createConnector()

      await consent(connector.id, 'auth.example.com')
      await call('~~/server/api/v1/connectors/[id]/consent/withdraw.post', {
        params: { id: connector.id },
      })

      const actions = JSON.stringify(mocks.logged)

      expect(actions).toContain('"action":"connector-granted"')
      expect(actions).toContain('"host":"mcp.example.com"')
      expect(actions).toContain('"action":"connector-withdrawn"')
      expect((await failureOf(start(connector.id))).code)
        .toBe('CONNECTOR_CONSENT_REQUIRED')
    })
  })

  describe('scope downgrade', () => {
    it('keeps the connector ready with a degraded note', async () => {
      useServer({ grantedScope: 'read' })

      const { connector } = await connectedConnector()
      const stored = await connectorRow(connector.id)
      const [row] = await credentialRows()

      expect(stored.status).toBe('ready')
      expect(stored.lastError).toMatchObject({
        code: 'CONNECTOR_SCOPE_DEGRADED',
      })
      expect(row!.scope).toBe('read')
    })
  })

  describe('disconnect and delete', () => {
    it('revokes both tokens, deletes the credentials and signs out',
      async () => {
        const { connector } = await connectedConnector()

        await call('~~/server/api/v1/connectors/[id]/disconnect.post', {
          params: { id: connector.id },
        })

        const revocations = server.requestsTo(REVOKE_URL).map((request) => {
          return new URLSearchParams(request.body)
        })

        expect(revocations.map((form) => {
          return [form.get('token'), form.get('token_type_hint')]
        })).toEqual([
          ['refresh-token-1', 'refresh_token'],
          ['access-token-1', 'access_token'],
        ])
        expect(await credentialRows()).toHaveLength(0)

        const stored = await connectorRow(connector.id)

        expect(stored.status).toBe('needs-auth')
        expect(stored.enabled).toBe(false)
        expect(stored.consentOrigin).toBe(MCP_ORIGIN)
      })

    it('deletes connectors in bulk and revokes first', async () => {
      const { connector } = await connectedConnector()
      const { result } = await call(
        '~~/server/api/v1/connectors/delete/bulk.post',
        { body: { ids: [connector.id, 'skl999999'] } },
      )

      expect(result.deleted).toEqual([connector.id])
      expect(server.requestsTo(REVOKE_URL)).toHaveLength(2)
      expect(await credentialRows()).toHaveLength(0)
      expect(JSON.stringify(mocks.logged)).toContain('connector-withdrawn')
    })

    it('never deletes another user\'s connector', async () => {
      const connector = await createConnector()

      sessionUserId = await seedUser(testDb.db)

      const { result } = await call(
        '~~/server/api/v1/connectors/delete/bulk.post',
        { body: { ids: [connector.id] } },
      )

      expect(result.deleted).toEqual([])
      expect((await connectorRow(connector.id)).id).toBeTruthy()
    })
  })

  describe('header auth', () => {
    async function saveHeader(
      id: string,
      headerName: string,
      headerValue: string,
    ) {
      return await call('~~/server/api/v1/connectors/[id]/credentials.post', {
        params: { id },
        body: { headerName, headerValue },
      })
    }

    it('stores the header encrypted and marks the connector ready',
      async () => {
        const connector = await createConnector({ presetId: 'github' })

        await consent(connector.id, null)

        const { result } = await saveHeader(
          connector.id,
          'Authorization',
          'Bearer github_pat_secret',
        )

        expect(JSON.stringify(result)).not.toContain('github_pat_secret')

        const [row] = await credentialRows()

        expect(row!.issuer).toBe('')
        expect(row!.headerName).toBe('Authorization')
        expect(row!.headerValue).not.toContain('github_pat_secret')
        expect(fakeDecrypt(row!.headerValue!)).toBe('Bearer github_pat_secret')
        expect((await connectorRow(connector.id)).status).toBe('ready')
        expect(JSON.stringify(mocks.logged)).not.toContain('github_pat_secret')
      })

    it.each([
      ['Host', 'example.com'],
      ['Cookie', 'a=b'],
      ['Content-Length', '1'],
      ['Mcp-Session-Id', 'x'],
      ['X Api Key', 'value'],
      ['X-Api-Key', 'line\r\nInjected: yes'],
      ['X-Api-Key', 'x'.repeat(4097)],
    ])('refuses the header %s', async (headerName, headerValue) => {
      const connector = await createConnector()

      await consent(connector.id, null)

      const failure = await failureOf(
        saveHeader(connector.id, headerName, headerValue),
      )

      expect(failure.status).toBe(400)
      expect(await credentialRows()).toHaveLength(0)
    })

    it('needs consent first', async () => {
      const connector = await createConnector()

      expect((await failureOf(
        saveHeader(connector.id, 'X-Api-Key', 'secret'),
      )).code).toBe('CONNECTOR_CONSENT_REQUIRED')
    })

    it('works without the connectors.oauth flag', async () => {
      mocks.flags = new Set(['connectors'])

      const connector = await createConnector()

      await consent(connector.id, null)
      await saveHeader(connector.id, 'X-Api-Key', 'secret')

      expect(await credentialRows()).toHaveLength(1)
      expect((await failureOf(start(connector.id))).status).toBe(404)
    })
  })

  describe('enable', () => {
    async function patch(id: string, body: Record<string, unknown>) {
      return await call('~~/server/api/v1/connectors/[id]/index.patch', {
        params: { id },
        body,
      })
    }

    it('refuses to enable a connector that is not connected', async () => {
      const connector = await createConnector()

      expect((await failureOf(patch(connector.id, { enabled: true }))).code)
        .toBe('CONNECTOR_NOT_READY')
    })

    it('enables a connected connector with a current consent', async () => {
      const { connector } = await connectedConnector()
      const { result } = await patch(connector.id, { enabled: true })

      expect(result.connector.enabled).toBe(true)
    })

    it('refuses to enable after the consent was withdrawn', async () => {
      const { connector } = await connectedConnector()

      await call('~~/server/api/v1/connectors/[id]/consent/withdraw.post', {
        params: { id: connector.id },
      })

      expect((await failureOf(patch(connector.id, { enabled: true }))).code)
        .toBe('CONNECTOR_CONSENT_REQUIRED')
    })
  })

  describe('outbound URL rules', () => {
    it.each([
      ['a private resource_metadata URL', 'https://169.254.169.254/latest'],
      ['an own-host resource_metadata URL', 'https://besidka.com/.well-known/x'],
      ['a loopback name', 'https://localhost/.well-known/x'],
    ])('refuses %s', async (_label, metadataUrl) => {
      useServer({ challenge: `Bearer resource_metadata="${metadataUrl}"` })

      const connector = await createConnector()
      const failure = await failureOf(discover(connector.id))

      expect(failure.status).toBe(400)
      expect(failure.code).toMatch(/^safe-fetch-/)
      expect(server.fetch.mock.calls.map(([url]) => String(url)))
        .not.toContain(metadataUrl)
    })

    it('skips an authorization server on a private address', async () => {
      useServer({
        protectedResource: {
          resource: MCP_SERVER_URL,
          authorization_servers: ['https://10.0.0.1'],
        },
      })

      const connector = await createConnector()

      expect((await failureOf(discover(connector.id))).code)
        .toBe('CONNECTOR_OAUTH_METADATA_INVALID')
    })

    it('refuses token endpoints on special names', async () => {
      useServer({
        metadata: {
          ...defaultMetadata(),
          token_endpoint: 'https://metadata.google.internal/token',
        },
      })

      const connector = await createConnector()

      expect((await failureOf(discover(connector.id))).code)
        .toBe('CONNECTOR_OAUTH_METADATA_INVALID')
    })

    it('refuses to add a private or own address', async () => {
      for (const url of [
        'https://10.0.0.1/mcp',
        'https://besidka.com/mcp',
        'http://mcp.example.com/mcp',
      ]) {
        expect((await failureOf(createConnector({ url }))).status).toBe(400)
      }

      expect(server.fetch).not.toHaveBeenCalled()
    })

    it('makes no request when a connector is added', async () => {
      await createConnector()

      expect(server.fetch).not.toHaveBeenCalled()
    })

    it('treats a server without metadata as header auth', async () => {
      useServer({ challenge: null, protectedResource: null })

      const connector = await createConnector()

      expect((await discover(connector.id)).authType).toBe('header')
    })
  })

  describe('flags and sessions', () => {
    it('answers 404 without the connectors flag', async () => {
      mocks.flags = new Set()

      expect((await failureOf(createConnector())).status).toBe(404)
    })

    it('answers 404 for another user\'s connector', async () => {
      const connector = await createConnector()

      sessionUserId = await seedUser(testDb.db)

      expect((await failureOf(discover(connector.id))).status).toBe(404)
    })
  })

  it('never puts a token, code, verifier or state in logs, errors or '
    + 'redirects', async () => {
    const { connector, approval, location } = await connectedConnector()

    await callback({ code: approval.code, state: approval.state, iss: 'x' })
    server.state.refreshBehavior = 'invalid_grant'
    await call('~~/server/api/v1/connectors/[id]/disconnect.post', {
      params: { id: connector.id },
    })

    const [tokenRequest] = server.requestsTo(TOKEN_URL)
    const verifier = new URLSearchParams(tokenRequest!.body)
      .get('code_verifier')!
    const visible = JSON.stringify({
      logged: mocks.logged,
      thrown: thrown.map((exception) => {
        return { ...(exception as object), message: String(exception) }
      }),
      location,
    })

    for (const secret of [
      'access-token-1',
      'refresh-token-1',
      AUTH_CODE,
      verifier,
      approval.state,
      'secret-host',
    ]) {
      expect(visible).not.toContain(secret)
    }
  })
})
