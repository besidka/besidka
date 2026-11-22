import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import {
  createMemoryExtractionTestDb,
  seedUser,
} from '../../../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../../../setup/helpers/memory-extraction-db'
import {
  ISSUER,
  MCP_SERVER_URL,
  REVOKE_URL,
  TOKEN_URL,
  createFakeConnectorKv,
  createMockAuthServer,
  fakeDecrypt,
  fakeEncrypt,
} from '../../../../setup/helpers/connectors-oauth'
import type {
  FakeConnectorKv,
  MockAuthServer,
} from '../../../../setup/helpers/connectors-oauth'

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { skillPublicIdMockFactory } = await import(
    '../../../../setup/helpers/skills-public-id-mock'
  )

  return await skillPublicIdMockFactory()
})

const {
  getValidAccessToken,
  isValidConnectorHeader,
} = await import('~~/server/utils/connectors/credentials')
const {
  createConnector,
  getConnector,
  readConnectorCredentials,
  replaceConnectorCredentials,
} = await import('~~/server/utils/connectors/store')

const NOW = new Date('2026-11-14T12:00:00.000Z').getTime()

describe('connector credentials', () => {
  let testDb: MemoryExtractionTestDb
  let kv: FakeConnectorKv
  let server: MockAuthServer
  let userId: number
  let connectorId: string
  let logged: unknown[]
  const noWait = vi.fn(async () => undefined)

  function dependencies(overrides: Record<string, unknown> = {}) {
    return {
      db: testDb.db,
      kv: kv as never,
      logger: { set: (values: unknown) => logged.push(values) },
      now: () => NOW,
      wait: noWait,
      ...overrides,
    }
  }

  async function token(overrides: Record<string, unknown> = {}) {
    return await getValidAccessToken(
      { userId, connectorId },
      dependencies(overrides),
    )
  }

  async function storeTokens(expiresAt: Date | null) {
    await replaceConnectorCredentials(testDb.db, {
      userId,
      connectorId,
      issuer: ISSUER,
      clientRegistration: {
        clientId: 'client-1',
        registrationKind: 'cimd',
        tokenEndpointAuthMethod: 'none',
        tokenEndpoint: TOKEN_URL,
        revocationEndpoint: REVOKE_URL,
        resource: MCP_SERVER_URL,
      },
      accessToken: 'access-token-1',
      refreshToken: 'refresh-token-1',
      scope: 'read',
      expiresAt,
    })
  }

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    kv = createFakeConnectorKv()
    server = createMockAuthServer()
    logged = []
    noWait.mockClear()
    vi.stubGlobal('fetch', server.fetch)
    vi.stubGlobal('useEncryptText', vi.fn(async (plain: string) => {
      return fakeEncrypt(plain)
    }))
    vi.stubGlobal('useDecryptText', vi.fn(async (cipher: string) => {
      return fakeDecrypt(cipher)
    }))
    userId = await seedUser(testDb.db, null)

    const connector = await createConnector(testDb.db, {
      userId,
      title: 'Example',
      url: MCP_SERVER_URL,
      slugBase: 'example',
      createdVia: 'app',
    })

    connectorId = connector.id
  })

  afterEach(() => {
    testDb.close()
    vi.unstubAllGlobals()
  })

  describe('isValidConnectorHeader', () => {
    it('accepts a normal API key header', () => {
      expect(isValidConnectorHeader('Authorization', 'Bearer abc')).toBe(true)
      expect(isValidConnectorHeader('X-Api-Key', 'key')).toBe(true)
    })

    it.each([
      ['Host', 'x'],
      ['cookie', 'x'],
      ['Transfer-Encoding', 'chunked'],
      ['Connection', 'close'],
      ['Mcp-Protocol-Version', '1'],
      ['Bad Name', 'x'],
      ['X'.repeat(65), 'x'],
      ['X-Key', ''],
      ['X-Key', '   '],
      ['X-Key', 'a\nb'],
      ['X-Key', 'a\rb'],
      ['X-Key', 'a\u0000b'],
      ['X-Key', 'a\tb'],
      ['X-Key', 'a\u000Bb'],
      ['X-Key', 'a\u000Cb'],
      ['X-Key', 'a\u007Fb'],
      ['Keep-Alive', 'timeout=5'],
      ['Upgrade', 'websocket'],
      ['TE', 'trailers'],
      ['Trailer', 'x'],
      ['Proxy-Authorization', 'Basic x'],
      ['X-Key', 'ключ'],
      ['X-Key', 'x'.repeat(4097)],
    ])('refuses %s', (name, value) => {
      expect(isValidConnectorHeader(name, value)).toBe(false)
    })
  })

  describe('getValidAccessToken', () => {
    it('returns the stored token without refreshing while it is fresh',
      async () => {
        await storeTokens(new Date(NOW + 10 * 60 * 1000))

        expect(await token())
          .toBe('access-token-1')
        expect(server.requestsTo(TOKEN_URL)).toHaveLength(0)
      })

    it('refreshes less than 60 s before expiry and stores the rotation',
      async () => {
        await storeTokens(new Date(NOW + 30 * 1000))

        expect(await token())
          .toBe('access-token-r1')

        const [request] = server.requestsTo(TOKEN_URL)
        const form = new URLSearchParams(request!.body)

        expect(form.get('grant_type')).toBe('refresh_token')
        expect(form.get('refresh_token')).toBe('refresh-token-1')
        expect(form.get('resource')).toBe(MCP_SERVER_URL)
        expect(form.get('client_id')).toBe('client-1')

        const stored = await readConnectorCredentials(
          testDb.db,
          userId,
          connectorId,
        )

        expect(stored!.accessToken).toBe('access-token-r1')
        expect(stored!.refreshToken).toBe('refresh-token-r1')
        expect(kv.values.has(`connectors:refresh:${connectorId}`)).toBe(false)
      })

    it('keeps the lock entry at the KV minimum TTL', async () => {
      await storeTokens(new Date(NOW))

      await token()

      expect(kv.put).toHaveBeenCalledWith(
        `connectors:refresh:${connectorId}`,
        expect.any(String),
        { expirationTtl: 60 },
      )
    })

    it('refreshes once for two parallel calls sharing a request',
      async () => {
        await storeTokens(new Date(NOW))

        const inFlight = new Map()
        const tokens = await Promise.all([
          token({ inFlight }),
          token({ inFlight }),
        ])

        expect(tokens).toEqual(['access-token-r1', 'access-token-r1'])
        expect(server.requestsTo(TOKEN_URL)).toHaveLength(1)
      })

    it('refreshes once for two parallel calls in different requests',
      async () => {
        await storeTokens(new Date(NOW))

        const wait = vi.fn((milliseconds: number) => {
          return new Promise<void>((resolve) => {
            setTimeout(resolve, milliseconds / 50)
          })
        })
        const tokens = await Promise.all([
          token({ wait }),
          token({ wait }),
        ])

        expect(tokens).toEqual(['access-token-r1', 'access-token-r1'])
        expect(server.requestsTo(TOKEN_URL)).toHaveLength(1)
        expect(wait).toHaveBeenCalledWith(500)
      })

    it('gives up instead of reusing the refresh token while the owner is '
      + 'still refreshing', async () => {
      await storeTokens(new Date(NOW))

      const original = server.fetch.getMockImplementation()!
      let releaseToken: () => void = () => undefined

      server.fetch.mockImplementation(async (input, init) => {
        if (String(input) === TOKEN_URL) {
          await new Promise<void>((resolve) => {
            releaseToken = resolve
          })
        }

        return await original(input, init)
      })

      const settled = [token(), token()].map((promise) => {
        return promise.then(
          (value) => {
            return { ok: true, value }
          },
          (exception: { code?: string }) => {
            return { ok: false, code: exception.code }
          },
        )
      })
      const firstSettled = await Promise.race(settled)

      expect(firstSettled).toEqual({
        ok: false,
        code: 'CONNECTOR_REFRESH_FAILED',
      })
      releaseToken()

      const results = await Promise.all(settled)

      expect(results).toContainEqual({ ok: true, value: 'access-token-r1' })
      expect(server.requestsTo(TOKEN_URL)).toHaveLength(1)
      expect(noWait).toHaveBeenCalledTimes(3)
    })

    it('refreshes at once without a lock when KV fails', async () => {
      await storeTokens(new Date(NOW))
      kv.get.mockRejectedValueOnce(new Error('KV unavailable'))

      expect(await token()).toBe('access-token-r1')
      expect(noWait).not.toHaveBeenCalled()
    })

    it('does not refresh for a 401 on a token that was already replaced',
      async () => {
        await storeTokens(new Date(NOW + 10 * 60 * 1000))

        expect(await getValidAccessToken(
          { userId, connectorId, rejectedToken: 'old-token' },
          dependencies(),
        )).toBe('access-token-1')
        expect(server.requestsTo(TOKEN_URL)).toHaveLength(0)
      })

    it('refreshes after a 401 on the stored token', async () => {
      await storeTokens(new Date(NOW + 10 * 60 * 1000))

      expect(await getValidAccessToken(
        { userId, connectorId, rejectedToken: 'access-token-1' },
        dependencies(),
      )).toBe('access-token-r1')
    })

    it('treats invalid_grant as terminal', async () => {
      await storeTokens(new Date(NOW))
      server.state.refreshBehavior = 'invalid_grant'

      expect(await token())
        .toBeNull()
      expect(await readConnectorCredentials(testDb.db, userId, connectorId))
        .toBeNull()

      const connector = await getConnector(testDb.db, userId, connectorId)

      expect(connector!.status).toBe('needs-auth')
      expect(connector!.lastError).toMatchObject({
        code: 'CONNECTOR_REAUTH_REQUIRED',
      })
      expect(JSON.stringify(connector!.lastError)).not.toContain('secret-host')
    })

    it('keeps tokens another writer stored before an invalid_grant',
      async () => {
        await storeTokens(new Date(NOW))
        server.state.refreshBehavior = 'invalid_grant'

        const original = server.fetch.getMockImplementation()!

        server.fetch.mockImplementation(async (input, init) => {
          const response = await original(input, init)

          if (String(input) === TOKEN_URL) {
            await testDb.db.update(schema.connectorCredentials)
              .set({ accessToken: fakeEncrypt('access-token-other') })
              .where(eq(schema.connectorCredentials.userId, userId))
          }

          return response
        })

        expect(await token())
          .toBe('access-token-other')
        expect(await readConnectorCredentials(testDb.db, userId, connectorId))
          .not.toBeNull()
      })

    it('never overwrites tokens a concurrent writer stored first',
      async () => {
        await storeTokens(new Date(NOW))

        const original = server.fetch.getMockImplementation()!

        server.fetch.mockImplementation(async (input, init) => {
          const response = await original(input, init)

          if (String(input) === TOKEN_URL) {
            await testDb.db.update(schema.connectorCredentials)
              .set({
                accessToken: fakeEncrypt('access-token-winner'),
                refreshToken: fakeEncrypt('refresh-token-winner'),
              })
              .where(eq(schema.connectorCredentials.userId, userId))
          }

          return response
        })

        expect(await token())
          .toBe('access-token-winner')

        const stored = await readConnectorCredentials(
          testDb.db,
          userId,
          connectorId,
        )

        expect(stored!.refreshToken).toBe('refresh-token-winner')
      })

    it('throws a fixed error on a server failure and keeps the credentials',
      async () => {
        await storeTokens(new Date(NOW))
        server.state.refreshBehavior = 'server_error'

        await expect(token()).rejects.toMatchObject({ code: 'CONNECTOR_REFRESH_FAILED' })
        expect(await readConnectorCredentials(testDb.db, userId, connectorId))
          .not.toBeNull()
      })

    it('returns null without credentials', async () => {
      expect(await token())
        .toBeNull()
    })

    it('never logs a token', async () => {
      await storeTokens(new Date(NOW))
      await token()

      const visible = JSON.stringify(logged)

      expect(visible).toContain('refreshed')
      expect(visible).not.toContain('access-token')
      expect(visible).not.toContain('refresh-token')
    })
  })
})
