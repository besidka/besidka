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
  createFakeBucket,
  createFakeGoogle,
  DRIVE_FILE_SCOPE,
  GOOGLE_SUBJECT,
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

  it('keeps the copies when another client mode is still active', async () => {
    useGoogle({
      token: () => ({ status: 400, body: { error: 'invalid_grant' } }),
    })
    await seedConnection({ expiresInMs: 0 })
    await seedConnection({ clientMode: 'byo' })
    await seedGoogleFile('user/drive-a.pdf')

    const { getGoogleAccessToken } = await tokensModule()

    await getGoogleAccessToken({ userId, clientMode: 'besidka' }, dependencies())

    expect(bucket.delete).not.toHaveBeenCalled()
    expect(await googleFileCount()).toBe(1)
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
