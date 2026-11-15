import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createMemoryExtractionTestDb,
  seedUser,
} from '../../../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../../../setup/helpers/memory-extraction-db'
import {
  ISSUER,
  REVOKE_URL,
  TOKEN_URL,
  fakeDecrypt,
  fakeEncrypt,
} from '../../../../setup/helpers/connectors-oauth'

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { skillPublicIdMockFactory } = await import(
    '../../../../setup/helpers/skills-public-id-mock'
  )

  return await skillPublicIdMockFactory()
})

const {
  revokeAllUserConnectorTokens,
  revokeConnectorCredentials,
} = await import('~~/server/utils/connectors/revoke')
const {
  createConnector,
  replaceConnectorCredentials,
} = await import('~~/server/utils/connectors/store')

describe('connector revocation', () => {
  let testDb: MemoryExtractionTestDb
  let userId: number
  const fetchMock = vi.fn()

  async function connectWithTokens(host: string, revocation: string | null) {
    const connector = await createConnector(testDb.db, {
      userId,
      title: host,
      url: `https://${host}/mcp`,
      slugBase: host.split('.')[0]!,
      createdVia: 'app',
    })

    await replaceConnectorCredentials(testDb.db, {
      userId,
      connectorId: connector.id,
      issuer: ISSUER,
      clientRegistration: {
        clientId: 'client-1',
        registrationKind: 'cimd',
        tokenEndpoint: TOKEN_URL,
        revocationEndpoint: revocation,
      },
      accessToken: `access-${host}`,
      refreshToken: `refresh-${host}`,
    })

    return connector
  }

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    userId = await seedUser(testDb.db, null)
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('useEncryptText', vi.fn(async (plain: string) => {
      return fakeEncrypt(plain)
    }))
    vi.stubGlobal('useDecryptText', vi.fn(async (cipher: string) => {
      return fakeDecrypt(cipher)
    }))
  })

  afterEach(() => {
    testDb.close()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('skips revocation when the issuer has no endpoint', async () => {
    expect(await revokeConnectorCredentials({
      connectorId: 'skl1',
      issuer: ISSUER,
      clientRegistration: { clientId: 'c', registrationKind: 'cimd' },
      accessToken: 'a',
      refreshToken: 'r',
      headerName: null,
      headerValue: null,
      scope: null,
      expiresAt: null,
      updatedAt: new Date(),
      generation: 'g',
    })).toEqual({ attempted: false, revoked: 0 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('revokes every connector of an account before the purge', async () => {
    await connectWithTokens('one.example.com', REVOKE_URL)
    await connectWithTokens('two.example.com', null)

    const logger = { set: vi.fn() }

    expect(await revokeAllUserConnectorTokens(testDb.db, userId, logger))
      .toEqual({ attempted: true, revoked: 2 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(logger.set.mock.calls)).not.toContain('access-')
  })

  it('keeps at most four connectors in flight', async () => {
    for (let index = 0; index < 6; index++) {
      await connectWithTokens(`c${index}.example.com`, REVOKE_URL)
    }

    let inFlight = 0
    let maxInFlight = 0

    fetchMock.mockImplementation(async () => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((resolve) => {
        setTimeout(resolve, 5)
      })
      inFlight -= 1

      return new Response(null, { status: 200 })
    })

    expect(await revokeAllUserConnectorTokens(testDb.db, userId))
      .toEqual({ attempted: true, revoked: 12 })
    expect(maxInFlight).toBe(4)
  })

  it('stops at the deadline and never throws', async () => {
    await connectWithTokens('one.example.com', REVOKE_URL)
    await connectWithTokens('two.example.com', REVOKE_URL)
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'))
        })
      })
    })

    const result = await revokeAllUserConnectorTokens(
      testDb.db,
      userId,
      undefined,
      20,
    )

    expect(result.revoked).toBe(0)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('never throws when the database read fails', async () => {
    const brokenDb = {
      select: () => {
        throw new Error('D1 unavailable')
      },
    }

    expect(await revokeAllUserConnectorTokens(brokenDb as never, userId))
      .toEqual({ attempted: false, revoked: 0 })
  })
})
