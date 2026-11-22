import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { and, eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import {
  createMemoryExtractionTestDb,
  seedUser,
} from '../../setup/helpers/memory-extraction-db'
import type {
  MemoryExtractionTestDb,
} from '../../setup/helpers/memory-extraction-db'
import {
  createFakeConnectorKv,
  fakeDecrypt,
  fakeEncrypt,
} from '../../setup/helpers/connectors-oauth'
import type { FakeConnectorKv } from '../../setup/helpers/connectors-oauth'
import {
  BYO_CLIENT_ID,
  BYO_CLIENT_SECRET,
  createFakeBucket,
  createFakeGoogle,
  DRIVE_FILE_SCOPE,
  GOOGLE_SUBJECT,
  seedGoogleByoAccess,
  useGoogleRuntimeConfig,
} from '../../setup/helpers/google-connections'
import type {
  FakeBucket,
  FakeGoogle,
  FakeGoogleOptions,
} from '../../setup/helpers/google-connections'

vi.mock('~~/server/utils/custom-db-types', async () => {
  const { skillPublicIdMockFactory } = await import(
    '../../setup/helpers/skills-public-id-mock'
  )

  return await skillPublicIdMockFactory()
})

const NOW = Date.UTC(2026, 10, 22, 12, 0, 0)

async function tokensModule() {
  return await import('~~/server/utils/google/tokens')
}

async function failureOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (exception) {
    return exception as { status: number }
  }

  throw new Error('Expected a rejection')
}

describe('Google tokens', () => {
  let testDb: MemoryExtractionTestDb
  let kv: FakeConnectorKv
  let bucket: FakeBucket
  let google: FakeGoogle
  let userId: number
  let restoreRuntimeConfig: () => void = () => {}
  const logger = { set: vi.fn() }
  const wait = vi.fn(async () => {})

  function useGoogle(options: FakeGoogleOptions = {}) {
    google = createFakeGoogle(options)

    return google
  }

  function dependencies() {
    return {
      db: testDb.db,
      kv: kv as never,
      storage: bucket,
      logger,
      fetchOptions: { fetchImpl: google.fetch },
      now: () => NOW,
      wait,
    }
  }

  async function seedConnection(input: {
    clientMode?: 'besidka' | 'byo'
    expiresInMs?: number
    scopes?: string[]
  } = {}) {
    const { saveGoogleConnection } = await tokensModule()

    return await saveGoogleConnection(testDb.db, {
      userId,
      clientMode: input.clientMode ?? 'besidka',
      subject: GOOGLE_SUBJECT,
      email: 'person@example.test',
      scopes: input.scopes ?? ['openid', DRIVE_FILE_SCOPE],
      accessToken: 'access-stored',
      accessTokenExpiresAt: new Date(NOW + (input.expiresInMs ?? 3_600_000)),
      refreshToken: 'refresh-stored',
    })
  }

  async function seedGoogleByoClient() {
    await testDb.db.insert(schema.keys).values({
      userId,
      provider: 'google-oauth-client',
      apiKey: fakeEncrypt(JSON.stringify({
        clientId: BYO_CLIENT_ID,
        clientSecret: BYO_CLIENT_SECRET,
      })),
    })
  }

  async function connectionRow(clientMode: 'besidka' | 'byo' = 'besidka') {
    const [row] = await testDb.db
      .select()
      .from(schema.googleConnections)
      .where(and(
        eq(schema.googleConnections.userId, userId),
        eq(schema.googleConnections.clientMode, clientMode),
      ))

    return row
  }

  async function seedGoogleFile(storageKey: string) {
    await testDb.db.insert(schema.files).values({
      userId,
      storageKey,
      name: 'Drive file.pdf',
      size: 10,
      type: 'application/pdf',
      externalSource: 'google',
      externalId: `drive-${storageKey}`,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    })
  }

  async function googleFileCount() {
    const rows = await testDb.db
      .select({ id: schema.files.id })
      .from(schema.files)
      .where(eq(schema.files.userId, userId))

    return rows.length
  }

  beforeEach(async () => {
    testDb = createMemoryExtractionTestDb()
    kv = createFakeConnectorKv()
    bucket = createFakeBucket()
    userId = await seedUser(testDb.db)
    useGoogle()
    logger.set.mockClear()
    wait.mockClear()
    restoreRuntimeConfig = await useGoogleRuntimeConfig()
    vi.stubGlobal('useDb', () => testDb.db)
    vi.stubGlobal('useKV', () => kv)
    vi.stubGlobal('useFileStorage', () => bucket)
    vi.stubGlobal('useEncryptText', async (plain: string) => fakeEncrypt(plain))
    vi.stubGlobal('useDecryptText', async (cipher: string) => {
      return fakeDecrypt(cipher)
    })
  })

  afterEach(() => {
    restoreRuntimeConfig()
    testDb.close()
    vi.unstubAllGlobals()
  })

  it('stores tokens encrypted', async () => {
    await seedConnection()

    const row = await connectionRow()

    expect(row?.refreshToken).toMatch(/^enc:/)
    expect(row?.accessToken).toMatch(/^enc:/)
    expect(JSON.stringify(row)).not.toContain('refresh-stored')
  })

  it('reports a user who never connected', async () => {
    const { getGoogleAccessToken } = await tokensModule()

    expect(await getGoogleAccessToken(
      { userId, clientMode: 'besidka' },
      dependencies(),
    )).toEqual({ status: 'not_connected' })
  })

  it('returns the cached token while it has time left', async () => {
    await seedConnection()

    const { getGoogleAccessToken } = await tokensModule()
    const result = await getGoogleAccessToken(
      { userId, clientMode: 'besidka', requiredScopes: [DRIVE_FILE_SCOPE] },
      dependencies(),
    )

    expect(result).toEqual(expect.objectContaining({
      status: 'ok',
      accessToken: 'access-stored',
    }))
    expect(google.fetch).not.toHaveBeenCalled()
  })

  it('refuses a token for a scope that was not granted', async () => {
    await seedConnection({ scopes: ['openid'] })

    const { getGoogleAccessToken } = await tokensModule()

    expect(await getGoogleAccessToken(
      { userId, clientMode: 'besidka', requiredScopes: [DRIVE_FILE_SCOPE] },
      dependencies(),
    )).toEqual({ status: 'missing_scope' })
  })

  it('refreshes a token close to expiry and stores it encrypted', async () => {
    await seedConnection({ expiresInMs: 60_000 })

    const { getGoogleAccessToken } = await tokensModule()
    const result = await getGoogleAccessToken(
      { userId, clientMode: 'besidka' },
      dependencies(),
    )
    const [request] = google.tokenRequests()
    const row = await connectionRow()

    expect(request!.form.get('grant_type')).toBe('refresh_token')
    expect(request!.form.get('refresh_token')).toBe('refresh-stored')
    expect(result.status).toBe('ok')

    const accessToken = (result as { accessToken: string }).accessToken

    expect(accessToken).toMatch(/^access-refreshed-/)
    expect(fakeDecrypt(row!.accessToken!)).toBe(accessToken)
    expect(fakeDecrypt(row!.refreshToken!)).toBe('refresh-stored')
    expect(row!.accessTokenExpiresAt!.getTime()).toBe(
      Math.floor((NOW + 3_599_000) / 1000) * 1000,
    )
    expect(JSON.stringify(logger.set.mock.calls)).not.toContain(accessToken)
    expect(kv.values.size).toBe(0)
  })

  it('stores a rotated refresh token', async () => {
    useGoogle({
      token: () => ({
        status: 200,
        body: {
          access_token: 'access-new',
          refresh_token: 'refresh-rotated',
          expires_in: 3599,
          token_type: 'Bearer',
        },
      }),
    })
    await seedConnection({ expiresInMs: 0 })

    const { getGoogleAccessToken } = await tokensModule()

    await getGoogleAccessToken({ userId, clientMode: 'besidka' }, dependencies())

    const row = await connectionRow()

    expect(fakeDecrypt(row!.refreshToken!)).toBe('refresh-rotated')
    expect(row!.grantedScopes).toEqual(['openid', DRIVE_FILE_SCOPE])
  })

  it('waits for another refresh instead of refreshing twice', async () => {
    const connectionId = await seedConnection({ expiresInMs: 0 })

    kv.values.set(
      `google:refresh:${connectionId}`,
      JSON.stringify({ owner: 'other', acquiredAt: NOW }),
    )
    wait.mockImplementationOnce(async () => {
      await testDb.db
        .update(schema.googleConnections)
        .set({
          accessToken: fakeEncrypt('access-from-other'),
          accessTokenExpiresAt: new Date(NOW + 3_600_000),
        })
        .where(eq(schema.googleConnections.userId, userId))
    })

    const { getGoogleAccessToken } = await tokensModule()
    const result = await getGoogleAccessToken(
      { userId, clientMode: 'besidka' },
      dependencies(),
    )

    expect(result).toEqual(expect.objectContaining({
      status: 'ok',
      accessToken: 'access-from-other',
    }))
    expect(google.fetch).not.toHaveBeenCalled()
  })

  it('gives up with a retryable error while the lock stays held', async () => {
    const connectionId = await seedConnection({ expiresInMs: 0 })

    kv.values.set(
      `google:refresh:${connectionId}`,
      JSON.stringify({ owner: 'other', acquiredAt: NOW }),
    )

    const { getGoogleAccessToken } = await tokensModule()
    const failure = await failureOf(getGoogleAccessToken(
      { userId, clientMode: 'besidka' },
      dependencies(),
    ))

    expect(failure.status).toBe(503)
    expect(wait).toHaveBeenCalledTimes(3)
    expect(google.fetch).not.toHaveBeenCalled()
  })

  it('ends access on invalid_grant and deletes the Google copies', async () => {
    useGoogle({
      token: () => ({ status: 400, body: { error: 'invalid_grant' } }),
    })
    await seedConnection({ expiresInMs: 60_000 })
    await seedGoogleFile('user/drive-a.pdf')
    await seedGoogleFile('user/drive-b.docx')
    await testDb.db.insert(schema.files).values({
      userId,
      storageKey: 'user/upload.pdf',
      name: 'Upload.pdf',
      size: 10,
      type: 'application/pdf',
    })

    const { getGoogleAccessToken } = await tokensModule()
    const result = await getGoogleAccessToken(
      { userId, clientMode: 'besidka' },
      dependencies(),
    )
    const row = await connectionRow()

    expect(result).toEqual({ status: 'needs_reauth' })
    expect(row).toEqual(expect.objectContaining({
      status: 'needs_reauth',
      accessToken: null,
      refreshToken: null,
      accessTokenExpiresAt: null,
    }))
    expect(bucket.deletedBatches).toHaveLength(1)
    expect(bucket.deletedBatches[0]).toEqual(expect.arrayContaining([
      'user/drive-a.pdf',
      'user/drive-b.docx',
    ]))
    expect(await googleFileCount()).toBe(1)
    expect(google.revokeRequests()[0]!.form.get('token'))
      .toBe('access-stored')
  })

  it('deletes Besidka\'s copies even while the own client is active',
    async () => {
      useGoogle({
        token: () => ({ status: 400, body: { error: 'invalid_grant' } }),
      })
      await seedConnection({ expiresInMs: 0 })
      await seedConnection({ clientMode: 'byo' })
      await seedGoogleFile('user/drive-a.pdf')

      const { getGoogleAccessToken } = await tokensModule()

      await getGoogleAccessToken(
        { userId, clientMode: 'besidka' },
        dependencies(),
      )

      expect(bucket.delete).toHaveBeenCalledTimes(1)
      expect(await googleFileCount()).toBe(0)
      expect((await connectionRow('byo'))!.status).toBe('active')
    })

  it('keeps Besidka\'s copies when the own client loses access', async () => {
    await seedGoogleByoAccess(testDb.db, userId)
    await seedGoogleByoClient()
    useGoogle({
      token: () => ({ status: 400, body: { error: 'invalid_grant' } }),
    })
    await seedConnection()
    await seedConnection({ clientMode: 'byo', expiresInMs: 0 })
    await seedGoogleFile('user/drive-a.pdf')

    const { getGoogleAccessToken } = await tokensModule()
    const result = await getGoogleAccessToken(
      { userId, clientMode: 'byo' },
      dependencies(),
    )

    expect(result.status).toBe('needs_reauth')
    expect((await connectionRow('byo'))!.status).toBe('needs_reauth')
    expect((await connectionRow('besidka'))!.status).toBe('active')
    expect(bucket.delete).not.toHaveBeenCalled()
    expect(await googleFileCount()).toBe(1)
  })

  describe('own client gate', () => {
    it('refreshes an own-client token with the stored client', async () => {
      await seedGoogleByoAccess(testDb.db, userId)
      await seedGoogleByoClient()
      await seedConnection({ clientMode: 'byo', expiresInMs: 0 })

      const { getGoogleAccessToken } = await tokensModule()
      const result = await getGoogleAccessToken(
        { userId, clientMode: 'byo' },
        dependencies(),
      )
      const [refresh] = google.tokenRequests()

      expect(result.status).toBe('ok')
      expect(refresh!.form.get('client_id')).toBe(BYO_CLIENT_ID)
      expect(refresh!.form.get('client_secret')).toBe(BYO_CLIENT_SECRET)
    })

    it.each([
      ['a non-admin with flag grants', { admin: false, grant: true }],
      ['an admin without the opt-in', { admin: true, optIn: false }],
    ])('refuses %s, even a cached token', async (_label, access) => {
      await seedGoogleByoAccess(testDb.db, userId, access)
      await seedGoogleByoClient()
      await seedConnection({ clientMode: 'byo' })

      const { getGoogleAccessToken } = await tokensModule()
      const failure = await failureOf(getGoogleAccessToken(
        { userId, clientMode: 'byo' },
        dependencies(),
      ))

      expect(failure.status).toBe(404)
      expect(google.requests).toHaveLength(0)
    })

    it('answers 409 when the own client is no longer stored', async () => {
      await seedGoogleByoAccess(testDb.db, userId)
      await seedConnection({ clientMode: 'byo', expiresInMs: 0 })

      const { getGoogleAccessToken } = await tokensModule()
      const failure = await failureOf(getGoogleAccessToken(
        { userId, clientMode: 'byo' },
        dependencies(),
      ))

      expect(failure.status).toBe(409)
      expect((await connectionRow('byo'))!.status).toBe('active')
    })
  })

  it.each([
    ['a server error', { status: 500, body: { error: 'internal_failure' } }],
    ['invalid_client', { status: 401, body: { error: 'invalid_client' } }],
  ])('never ends access on %s', async (_label, reply) => {
    useGoogle({ token: () => reply })
    await seedConnection({ expiresInMs: 0 })
    await seedGoogleFile('user/drive-a.pdf')

    const { getGoogleAccessToken } = await tokensModule()
    const failure = await failureOf(getGoogleAccessToken(
      { userId, clientMode: 'besidka' },
      dependencies(),
    ))
    const row = await connectionRow()

    expect(failure.status).toBe(502)
    expect(row!.status).toBe('active')
    expect(fakeDecrypt(row!.refreshToken!)).toBe('refresh-stored')
    expect(await googleFileCount()).toBe(1)
  })

  it('never ends access on a timeout', async () => {
    useGoogle()
    google.fetch.mockImplementation(async () => {
      throw new TypeError('network down')
    })
    await seedConnection({ expiresInMs: 0 })

    const { getGoogleAccessToken } = await tokensModule()
    const failure = await failureOf(getGoogleAccessToken(
      { userId, clientMode: 'besidka' },
      dependencies(),
    ))

    expect(failure.status).toBe(502)
    expect((await connectionRow())!.status).toBe('active')
  })

  it('never ends access when the stored token cannot be decrypted',
    async () => {
      await seedConnection({ expiresInMs: 0 })
      await seedGoogleFile('user/drive-a.pdf')

      const before = await connectionRow()

      vi.stubGlobal('useDecryptText', async () => {
        throw new Error('bad key')
      })

      const { getGoogleAccessToken } = await tokensModule()
      const failure = await failureOf(getGoogleAccessToken(
        { userId, clientMode: 'besidka' },
        dependencies(),
      ))
      const after = await connectionRow()

      expect(failure.status).toBe(500)
      expect(after!.status).toBe('active')
      expect(after!.refreshToken).toBe(before!.refreshToken)
      expect(await googleFileCount()).toBe(1)
      expect(google.fetch).not.toHaveBeenCalled()
    })

  async function setRow(values: Record<string, unknown>) {
    await testDb.db
      .update(schema.googleConnections)
      .set(values)
      .where(eq(schema.googleConnections.userId, userId))
  }

  it('releases the refresh lock after refreshing', async () => {
    const connectionId = await seedConnection({ expiresInMs: 0 })
    const { getGoogleAccessToken } = await tokensModule()

    await getGoogleAccessToken({ userId, clientMode: 'besidka' }, dependencies())

    expect(kv.put).toHaveBeenCalledWith(
      `google:refresh:${connectionId}`,
      expect.any(String),
      { expirationTtl: 60 },
    )
    expect(kv.values.has(`google:refresh:${connectionId}`)).toBe(false)
  })

  it('refreshes without the lock when KV fails', async () => {
    await seedConnection({ expiresInMs: 0 })
    kv.get.mockRejectedValue(new Error('kv down'))

    const { getGoogleAccessToken } = await tokensModule()
    const result = await getGoogleAccessToken(
      { userId, clientMode: 'besidka' },
      dependencies(),
    )

    expect(result.status).toBe('ok')
    expect(google.tokenRequests()).toHaveLength(1)
    expect(JSON.stringify(logger.set.mock.calls)).toContain('lock-unavailable')
  })

  it('skips the refresh when the row changed while the lock was taken',
    async () => {
      await seedConnection({ expiresInMs: 0 })

      const put = kv.put.getMockImplementation()!

      kv.put.mockImplementationOnce(async (key, value, putOptions) => {
        await setRow({
          accessToken: fakeEncrypt('access-from-other'),
          accessTokenExpiresAt: new Date(NOW + 3_600_000),
        })

        return await put(key, value, putOptions)
      })

      const { getGoogleAccessToken } = await tokensModule()
      const result = await getGoogleAccessToken(
        { userId, clientMode: 'besidka' },
        dependencies(),
      )

      expect(result).toEqual(expect.objectContaining({
        status: 'ok',
        accessToken: 'access-from-other',
      }))
      expect(google.fetch).not.toHaveBeenCalled()
    })

  it('returns the winner\'s token when it loses the compare-and-set',
    async () => {
      useGoogle({
        token: () => {
          testDb.sqlite.prepare(
            'update google_connections set refresh_token = ?, '
            + 'access_token = ?, access_token_expires_at = ?',
          ).run(
            fakeEncrypt('refresh-winner'),
            fakeEncrypt('access-winner'),
            Math.floor((NOW + 3_600_000) / 1000),
          )

          return {
            status: 200,
            body: {
              access_token: 'access-loser',
              expires_in: 3599,
              token_type: 'Bearer',
            },
          }
        },
      })
      await seedConnection({ expiresInMs: 0 })

      const { getGoogleAccessToken } = await tokensModule()
      const result = await getGoogleAccessToken(
        { userId, clientMode: 'besidka' },
        dependencies(),
      )

      expect(result).toEqual(expect.objectContaining({
        accessToken: 'access-winner',
      }))
      expect(JSON.stringify(logger.set.mock.calls)).toContain('lost-race')
      expect(fakeDecrypt((await connectionRow())!.refreshToken!))
        .toBe('refresh-winner')
    })

  it('keeps a reconnect that landed during a failed refresh', async () => {
    useGoogle({
      token: () => {
        testDb.sqlite.prepare(
          'update google_connections set refresh_token = ?, '
          + 'access_token = ?, access_token_expires_at = ?',
        ).run(
          fakeEncrypt('refresh-reconnected'),
          fakeEncrypt('access-reconnected'),
          Math.floor((NOW + 3_600_000) / 1000),
        )

        return { status: 400, body: { error: 'invalid_grant' } }
      },
    })
    await seedConnection({ expiresInMs: 0 })
    await seedGoogleFile('user/drive-a.pdf')

    const { getGoogleAccessToken } = await tokensModule()
    const result = await getGoogleAccessToken(
      { userId, clientMode: 'besidka' },
      dependencies(),
    )

    expect(result).toEqual(expect.objectContaining({
      accessToken: 'access-reconnected',
    }))
    expect((await connectionRow())!.status).toBe('active')
    expect(await googleFileCount()).toBe(1)
    expect(JSON.stringify(logger.set.mock.calls)).toContain('superseded')
  })

  it('does not end access twice when another request already did',
    async () => {
      useGoogle({
        token: () => {
          testDb.sqlite.prepare(
            'update google_connections set status = ?, refresh_token = NULL',
          ).run('needs_reauth')

          return { status: 400, body: { error: 'invalid_grant' } }
        },
      })
      await seedConnection({ expiresInMs: 0 })
      await seedGoogleFile('user/drive-a.pdf')

      const { getGoogleAccessToken } = await tokensModule()
      const result = await getGoogleAccessToken(
        { userId, clientMode: 'besidka' },
        dependencies(),
      )

      expect(result).toEqual({ status: 'needs_reauth' })
      expect(bucket.delete).not.toHaveBeenCalled()
      expect(google.revokeRequests()).toHaveLength(0)
    })

  it('validates connections idle for more than a day', async () => {
    useGoogle({
      token: () => ({ status: 400, body: { error: 'invalid_grant' } }),
    })
    await seedConnection({ expiresInMs: -2 * 24 * 60 * 60 * 1000 })
    await seedGoogleFile('user/drive-a.pdf')

    const { validateStaleGoogleConnections } = await tokensModule()
    const result = await validateStaleGoogleConnections(dependencies())

    expect(result).toEqual({ checked: 1, active: 0, ended: 1, failed: 0 })
    expect((await connectionRow())!.status).toBe('needs_reauth')
    expect(await googleFileCount()).toBe(0)
  })

  it('leaves recently used connections out of the validation', async () => {
    await seedConnection({ expiresInMs: -60 * 60 * 1000 })

    const { validateStaleGoogleConnections } = await tokensModule()
    const result = await validateStaleGoogleConnections(dependencies())

    expect(result.checked).toBe(0)
    expect(google.fetch).not.toHaveBeenCalled()
  })

  it('answers 409 through requireGoogleAccessToken after access ended',
    async () => {
      await seedConnection()
      await testDb.db
        .update(schema.googleConnections)
        .set({ status: 'needs_reauth', refreshToken: null })

      const { requireGoogleAccessToken } = await tokensModule()
      const failure = await failureOf(requireGoogleAccessToken(
        { userId, clientMode: 'besidka' },
        dependencies(),
      ))

      expect(failure.status).toBe(409)
    })

  it('revokes every stored grant for account deletion', async () => {
    await seedConnection()
    await seedConnection({ clientMode: 'byo' })

    const { revokeAllGoogleConnectionsOfUser } = await tokensModule()
    const result = await revokeAllGoogleConnectionsOfUser(testDb.db, userId, {
      fetchOptions: { fetchImpl: google.fetch },
    })

    expect(result).toEqual({ attempted: 2, revoked: 2 })
    expect(google.revokeRequests().map(request => request.form.get('token')))
      .toEqual(['refresh-stored', 'refresh-stored'])
  })

  it('stops revoking at the deadline and never throws', async () => {
    await seedConnection()

    const { revokeAllGoogleConnectionsOfUser } = await tokensModule()
    const result = await revokeAllGoogleConnectionsOfUser(testDb.db, userId, {
      fetchOptions: { fetchImpl: google.fetch },
      deadlineMs: 0,
    })

    expect(result).toEqual({ attempted: 0, revoked: 0 })
    expect(google.fetch).not.toHaveBeenCalled()
  })
})
