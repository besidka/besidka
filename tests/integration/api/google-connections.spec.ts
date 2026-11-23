import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
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
  createFakeConnectorKv,
  fakeDecrypt,
  fakeEncrypt,
} from '../../setup/helpers/connectors-oauth'
import type { FakeConnectorKv } from '../../setup/helpers/connectors-oauth'
import {
  createFakeBucket,
  createFakeGoogle,
  defaultTokenReply,
  DRIVE_FILE_SCOPE,
  GOOGLE_CLIENT_ID,
  GOOGLE_EMAIL,
  GOOGLE_SUBJECT,
  makeIdToken,
  useGoogleRuntimeConfig,
} from '../../setup/helpers/google-connections'
import type {
  FakeBucket,
  FakeGoogle,
  FakeGoogleOptions,
} from '../../setup/helpers/google-connections'

const PRODUCTION_ORIGIN = 'https://besidka.com'
const PREVIEW_ORIGIN = 'https://pr-12-besidka.chernenko.workers.dev'

const mocks = vi.hoisted(() => ({
  flags: new Set<string>(['google.drive']),
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

vi.mock('~~/server/utils/features/context', () => ({
  evaluateFeatureForEvent: async (_event: unknown, flag: string) => {
    const isOn = mocks.flags.has(flag)

    return { value: isOn, active: isOn }
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

const ROUTES = {
  start: '~~/server/api/v1/google/oauth/start.post',
  callback: '~~/server/api/v1/google/oauth/callback.get',
  status: '~~/server/api/v1/google/connections/index.get',
  disconnect: '~~/server/api/v1/google/connections/disconnect.post',
} as const

async function failureOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (exception) {
    return exception as { status: number }
  }

  throw new Error('Expected a rejection')
}

describe('Google connection routes', () => {
  let testDb: MemoryExtractionTestDb
  let kv: FakeConnectorKv
  let bucket: FakeBucket
  let google: FakeGoogle
  let userId: number
  let restoreRuntimeConfig: () => void = () => {}
  let sessionUserId: number
  let codeChallenge: string | null

  function useGoogle(options: FakeGoogleOptions = {}) {
    google = createFakeGoogle({
      ...options,
      token: (form) => {
        if (form.get('grant_type') === 'authorization_code') {
          const verifier = form.get('code_verifier') ?? ''
          const challenge = createHash('sha256')
            .update(verifier)
            .digest('base64url')

          if (challenge !== codeChallenge) {
            return { status: 400, body: { error: 'invalid_grant' } }
          }
        }

        return (options.token ?? defaultTokenReply)(form)
      },
    })
    vi.stubGlobal('fetch', google.fetch)

    return google
  }

  async function call(
    route: keyof typeof ROUTES,
    partial: Partial<SkillsRouteEvent> = {},
  ) {
    const module = await import(ROUTES[route])
    const bodyHeaders: Record<string, string> = partial.body === undefined
      ? { 'content-length': '0' }
      : { 'content-type': 'application/json' }
    const event = createSkillsRouteEvent({
      ...partial,
      headers: {
        'origin': mocks.origin,
        'sec-fetch-site': 'same-origin',
        ...bodyHeaders,
        ...partial.headers,
      },
    })
    const result = await (module.default as Handler)(event)

    return { result, event }
  }

  async function start(body: Record<string, unknown> = {}) {
    const { result } = await call('start', { body })
    const url = new URL(result.authorizationUrl as string)

    codeChallenge = url.searchParams.get('code_challenge')

    return url
  }

  async function callback(query: Record<string, string>) {
    const { event } = await call('callback', { query })

    return event.res.headers.get('location') ?? ''
  }

  async function connect(body: Record<string, unknown> = {}) {
    const url = await start(body)

    return await callback({
      state: url.searchParams.get('state')!,
      code: 'auth-code',
    })
  }

  async function connectionRows() {
    return await testDb.db
      .select()
      .from(schema.googleConnections)
      .where(eq(schema.googleConnections.userId, userId))
  }

  async function seedGoogleFile(storageKey: string) {
    await testDb.db.insert(schema.files).values({
      userId,
      storageKey,
      name: 'Drive.pdf',
      size: 1,
      type: 'application/pdf',
      externalSource: 'google',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    })
  }

  async function fileCount() {
    const rows = await testDb.db
      .select({ id: schema.files.id })
      .from(schema.files)
      .where(eq(schema.files.userId, userId))

    return rows.length
  }

  beforeEach(async () => {
    mocks.flags = new Set(['google.drive'])
    mocks.origin = PRODUCTION_ORIGIN
    mocks.logged = []
    codeChallenge = null
    testDb = createMemoryExtractionTestDb()
    kv = createFakeConnectorKv()
    bucket = createFakeBucket()
    userId = await seedUser(testDb.db)
    sessionUserId = userId
    useGoogle()
    restoreRuntimeConfig = await useGoogleRuntimeConfig()
    vi.stubGlobal('useDb', () => testDb.db)
    vi.stubGlobal('useKV', () => kv)
    vi.stubGlobal('useFileStorage', () => bucket)
    vi.stubGlobal('useEncryptText', async (plain: string) => fakeEncrypt(plain))
    vi.stubGlobal('useDecryptText', async (cipher: string) => {
      return fakeDecrypt(cipher)
    })
    vi.stubGlobal('useUserSession', async () => {
      return sessionUserId > 0
        ? { user: { id: String(sessionUserId) } }
        : null
    })
    vi.stubGlobal('useUnauthorizedError', () => {
      return Object.assign(new Error('Unauthorized'), { status: 401 })
    })
  })

  afterEach(() => {
    restoreRuntimeConfig()
    testDb.close()
    vi.unstubAllGlobals()
  })

  describe('gates', () => {
    it.each(Object.keys(ROUTES) as (keyof typeof ROUTES)[])(
      '%s refuses a signed-out request',
      async (route) => {
        sessionUserId = 0

        expect((await failureOf(call(route))).status).toBe(401)
      },
    )

    it.each(['start', 'callback'] as const)(
      '%s answers 404 while google.drive is not active',
      async (route) => {
        mocks.flags = new Set()

        expect((await failureOf(call(route))).status).toBe(404)
      },
    )

    it.each(['start', 'disconnect'] as const)(
      '%s refuses a cross-origin request',
      async (route) => {
        const failure = await failureOf(call(route, {
          headers: {
            'origin': 'https://evil.example',
            'sec-fetch-site': 'cross-site',
          },
        }))

        expect(failure.status).toBe(403)
      },
    )

    it('refuses a cross-site status read', async () => {
      const failure = await failureOf(call('status', {
        headers: { 'sec-fetch-site': 'cross-site' },
      }))

      expect(failure.status).toBe(403)
    })

    it('answers 429 after ten writes a minute', async () => {
      for (let index = 0; index < 10; index++) {
        await call('start', { body: {} })
      }

      const failure = await failureOf(call('start', { body: {} }))

      expect(failure.status).toBe(429)
    })

    it('fails closed when the rate limit cannot be counted', async () => {
      kv.get.mockImplementation(async (key: string) => {
        if (key.startsWith('google-rate-limit')) {
          throw new Error('kv down')
        }

        return kv.values.get(key) ?? null
      })

      const { event } = await call('status')
      const failure = await failureOf(call('start', { body: {} }))

      expect(event.res.headers.get('cache-control')).toBe('private, no-store')
      expect(failure.status).toBe(429)
    })

    it('answers a clean 503 when no Google client is configured',
      async () => {
        restoreRuntimeConfig()
        restoreRuntimeConfig = await useGoogleRuntimeConfig({
          googleClientId: '',
          googleClientSecret: '',
        })

        expect((await failureOf(call('start', { body: {} }))).status)
          .toBe(503)
      })
  })

  describe('flag off for a connected user', () => {
    it('still shows the connection without offering to connect',
      async () => {
        await connect()
        mocks.flags = new Set()

        const { result } = await call('status')

        expect(result.canConnect).toBe(false)
        expect(result.connection.status).toBe('active')
      })

    it('still disconnects', async () => {
      await connect()
      mocks.flags = new Set()

      const { result } = await call('disconnect')

      expect(result.disconnected).toBe(true)
      expect(await connectionRows()).toEqual([])
    })
  })

  describe('dedicated Drive client', () => {
    it('uses the dedicated client when it is configured', async () => {
      restoreRuntimeConfig()
      restoreRuntimeConfig = await useGoogleRuntimeConfig({
        googleDriveClientId: 'drive-client.apps.googleusercontent.com',
        googleDriveClientSecret: 'drive-secret',
      })

      const url = await start()
      const { result } = await call('status')

      expect(url.searchParams.get('client_id'))
        .toBe('drive-client.apps.googleusercontent.com')
      expect(result.dedicatedClient).toBe(true)
    })

    it('falls back to the sign-in client and says so', async () => {
      const url = await start()
      const { result } = await call('status')

      expect(url.searchParams.get('client_id')).toBe(GOOGLE_CLIENT_ID)
      expect(result.dedicatedClient).toBe(false)
      expect(JSON.stringify(result)).not.toContain(GOOGLE_CLIENT_ID)
    })
  })

  describe('start', () => {
    it('builds the consent URL from the request origin', async () => {
      mocks.origin = PREVIEW_ORIGIN

      const url = await start()
      const state = url.searchParams.get('state')!

      expect(url.searchParams.get('redirect_uri'))
        .toBe(`${PREVIEW_ORIGIN}/api/v1/google/oauth/callback`)
      expect(url.searchParams.get('client_id')).toBe(GOOGLE_CLIENT_ID)
      expect(url.searchParams.get('access_type')).toBe('offline')
      expect(url.searchParams.get('include_granted_scopes')).toBe('true')
      expect(url.searchParams.get('prompt')).toBe('consent select_account')
      expect(url.searchParams.get('code_challenge_method')).toBe('S256')
      expect(url.searchParams.get('scope')!.split(' '))
        .toEqual(expect.arrayContaining([DRIVE_FILE_SCOPE, 'openid']))
      expect(url.searchParams.get('scope')).not.toContain('calendar')
      expect(kv.ttls.get(`google:oauth:${state}`)).toBe(600)
    })

    it('falls back to the Google tab for an unsafe return path', async () => {
      const url = await start({ returnTo: 'https://evil.example/steal' })
      const location = await callback({
        state: url.searchParams.get('state')!,
        code: 'auth-code',
      })

      expect(location).toBe('/chats/connectors?google=connected')
    })
  })

  describe('callback', () => {
    it('connects and stores the tokens encrypted', async () => {
      const location = await connect()
      const [row] = await connectionRows()

      expect(location).toBe('/chats/connectors?google=connected')
      expect(row).toEqual(expect.objectContaining({
        clientMode: 'besidka',
        status: 'active',
        googleSubject: GOOGLE_SUBJECT,
        googleEmail: GOOGLE_EMAIL,
      }))
      expect(fakeDecrypt(row!.refreshToken!)).toBe('refresh-initial')
      expect(fakeDecrypt(row!.accessToken!)).toBe('access-initial')
      expect(row!.grantedScopes).toContain(DRIVE_FILE_SCOPE)
      expect(google.tokenRequests()[0]!.form.get('redirect_uri'))
        .toBe(`${PRODUCTION_ORIGIN}/api/v1/google/oauth/callback`)

      const logged = JSON.stringify(mocks.logged)

      expect(logged).not.toContain('refresh-initial')
      expect(logged).not.toContain('access-initial')
      expect(logged).not.toContain('auth-code')
      expect(logged).not.toContain(GOOGLE_EMAIL)
    })

    it('accepts Google\'s cross-site redirect', async () => {
      const url = await start()
      const { event } = await call('callback', {
        query: { state: url.searchParams.get('state')!, code: 'auth-code' },
        headers: { 'origin': '', 'sec-fetch-site': 'cross-site' },
      })

      expect(event.res.headers.get('location'))
        .toBe('/chats/connectors?google=connected')
    })

    it('refuses a replayed state', async () => {
      const url = await start()
      const query = { state: url.searchParams.get('state')!, code: 'auth-code' }

      await callback(query)

      expect(await callback(query))
        .toBe('/chats/connectors?google=expired')
      expect(google.tokenRequests()).toHaveLength(1)
    })

    it('refuses a state started by another user', async () => {
      const url = await start()

      sessionUserId = await seedUser(testDb.db)

      const location = await callback({
        state: url.searchParams.get('state')!,
        code: 'auth-code',
      })

      expect(location).toBe('/chats/connectors?google=error')
      expect(google.tokenRequests()).toHaveLength(0)
      expect(await connectionRows()).toEqual([])
    })

    it('refuses a malformed state without reading KV', async () => {
      expect(await callback({ state: 'x', code: 'auth-code' }))
        .toBe('/chats/connectors?google=error')
      expect(kv.get).not.toHaveBeenCalled()
    })

    it('handles a refused consent cleanly', async () => {
      const url = await start()
      const location = await callback({
        state: url.searchParams.get('state')!,
        error: 'access_denied',
      })

      expect(location).toBe('/chats/connectors?google=denied')
      expect(google.fetch).not.toHaveBeenCalled()
    })

    it('refuses a grant without drive.file and revokes it', async () => {
      useGoogle({
        token: () => ({
          status: 200,
          body: {
            access_token: 'access-partial',
            refresh_token: 'refresh-partial',
            expires_in: 3599,
            token_type: 'Bearer',
            scope: 'openid https://www.googleapis.com/auth/userinfo.email',
            id_token: makeIdToken(),
          },
        }),
      })

      expect(await connect())
        .toBe('/chats/connectors?google=missing_scope')
      expect(await connectionRows()).toEqual([])
      expect(google.revokeRequests()[0]!.form.get('token'))
        .toBe('refresh-partial')
    })

    it('refuses an ID token for another client', async () => {
      useGoogle({
        token: (form) => {
          const reply = defaultTokenReply(form)

          return {
            ...reply,
            body: {
              ...(reply.body as object),
              id_token: makeIdToken({ aud: 'other-client' }),
            },
          }
        },
      })

      expect(await connect()).toBe('/chats/connectors?google=error')
      expect(await connectionRows()).toEqual([])
    })

    it('sends the user back once with prompt=consent when no refresh '
      + 'token came', async () => {
      useGoogle({
        token: () => ({
          status: 200,
          body: {
            access_token: 'access-only',
            expires_in: 3599,
            token_type: 'Bearer',
            scope: DRIVE_FILE_SCOPE,
            id_token: makeIdToken(),
          },
        }),
      })

      const location = await connect()
      const restart = new URL(location)

      expect(restart.origin).toBe('https://accounts.google.com')
      expect(restart.searchParams.get('prompt')).toContain('consent')
      expect(await connectionRows()).toEqual([])
      expect(google.revokeRequests()).toHaveLength(0)

      codeChallenge = restart.searchParams.get('code_challenge')

      expect(await callback({
        state: restart.searchParams.get('state')!,
        code: 'auth-code',
      })).toBe('/chats/connectors?google=error')
      expect(await connectionRows()).toEqual([])
    })

    it('destroys nothing when another account comes without a refresh '
      + 'token', async () => {
      await connect()
      await seedGoogleFile('u/old-account.pdf')
      useGoogle({
        token: () => ({
          status: 200,
          body: {
            access_token: 'access-other',
            expires_in: 3599,
            token_type: 'Bearer',
            scope: DRIVE_FILE_SCOPE,
            id_token: makeIdToken({ sub: 'other-subject' }),
          },
        }),
      })

      const location = await connect()
      const [row] = await connectionRows()

      expect(new URL(location).searchParams.get('prompt'))
        .toContain('consent')
      expect(row!.status).toBe('active')
      expect(row!.googleSubject).toBe(GOOGLE_SUBJECT)
      expect(fakeDecrypt(row!.refreshToken!)).toBe('refresh-initial')
      expect(await fileCount()).toBe(1)
      expect(google.revokeRequests()).toHaveLength(0)
    })

    it('revokes the new grant when the old copies cannot be deleted',
      async () => {
        await connect()
        await seedGoogleFile('u/old-account.pdf')
        bucket.delete.mockRejectedValueOnce(new Error('r2 down'))
        useGoogle({
          token: (form) => {
            const reply = defaultTokenReply(form)

            return {
              ...reply,
              body: {
                ...(reply.body as object),
                refresh_token: 'refresh-second',
                id_token: makeIdToken({ sub: 'second-subject' }),
              },
            }
          },
        })

        expect(await connect()).toBe('/chats/connectors?google=error')

        const [row] = await connectionRows()

        expect(row!.status).toBe('revoked')
        expect(google.revokeRequests().map((request) => {
          return request.form.get('token')
        })).toEqual(['refresh-initial', 'refresh-second'])
        expect(JSON.stringify(mocks.logged)).toContain('GOOGLE_CLEANUP_PENDING')
      })

    it('replaces a different Google account after deleting its copies',
      async () => {
        await connect()
        await seedGoogleFile('u/old-account.pdf')
        useGoogle({
          token: (form) => {
            const reply = defaultTokenReply(form)

            return {
              ...reply,
              body: {
                ...(reply.body as object),
                refresh_token: 'refresh-second',
                id_token: makeIdToken({
                  sub: 'second-subject',
                  email: 'second@example.test',
                }),
              },
            }
          },
        })

        expect(await connect())
          .toBe('/chats/connectors?google=connected')

        const [row] = await connectionRows()

        expect(row!.googleSubject).toBe('second-subject')
        expect(fakeDecrypt(row!.refreshToken!)).toBe('refresh-second')
        expect(await fileCount()).toBe(0)
        expect(google.revokeRequests()[0]!.form.get('token'))
          .toBe('refresh-initial')
      })

    it('reconnects the same account with the subject as hint', async () => {
      await connect()

      const url = await start()

      expect(url.searchParams.get('login_hint')).toBe(GOOGLE_SUBJECT)
      expect(url.toString()).not.toContain('example.test')
      expect(url.searchParams.has('prompt')).toBe(false)
    })
  })

  describe('status', () => {
    it('reports no connection', async () => {
      expect((await call('status')).result).toEqual({
        connection: null,
        canConnect: true,
        dedicatedClient: false,
        byo: null,
      })
    })

    it('reports the connection without tokens', async () => {
      await connect()

      const { result } = await call('status')

      expect(result).toEqual({
        connection: {
          clientMode: 'besidka',
          status: 'active',
          email: GOOGLE_EMAIL,
          isWorkspaceAccount: true,
          capabilities: ['drive-picked'],
          connectedAt: expect.any(String),
        },
        canConnect: true,
        dedicatedClient: false,
        byo: null,
      })
      expect(JSON.stringify(result)).not.toContain('enc:')
    })
  })

  describe('disconnect', () => {
    it('revokes, deletes the copies and the row', async () => {
      await connect()
      await seedGoogleFile('u/drive.pdf')

      const { result } = await call('disconnect')

      expect(result).toEqual({
        disconnected: true,
        revoked: true,
        filesDeleted: 1,
        filesPending: false,
      })
      expect(google.revokeRequests()[0]!.form.get('token'))
        .toBe('refresh-initial')
      expect(await connectionRows()).toEqual([])
      expect(await fileCount()).toBe(0)
    })

    it.each([
      ['no Content-Length', undefined],
      ['a zero Content-Length', '0'],
    ])('disconnects Besidka\'s client for a request with %s',
      async (_label, contentLength) => {
        await connect()

        const module = await import(ROUTES.disconnect)
        const event = createSkillsRouteEvent({
          headers: {
            'origin': mocks.origin,
            'sec-fetch-site': 'same-origin',
          },
        })

        if (contentLength === undefined) {
          delete event.headers['content-length']
        } else {
          event.headers['content-length'] = contentLength
        }

        const result = await (module.default as Handler)(event)

        expect(result.disconnected).toBe(true)
        expect(await connectionRows()).toEqual([])
      })

    it('still disconnects when Google cannot revoke', async () => {
      useGoogle({ revoke: () => ({ status: 503, body: {} }) })
      await connect()

      const { result } = await call('disconnect')

      expect(result.disconnected).toBe(true)
      expect(result.revoked).toBe(false)
      expect(await connectionRows()).toEqual([])
    })

    it('keeps a row a reconnect brought back during the cleanup',
      async () => {
        await connect()
        await seedGoogleFile('u/drive.pdf')
        bucket.delete.mockImplementationOnce(async () => {
          await testDb.db
            .update(schema.googleConnections)
            .set({ status: 'active' })
            .where(eq(schema.googleConnections.userId, userId))
        })

        await call('disconnect')

        const [row] = await connectionRows()

        expect(row!.status).toBe('active')
      })

    it('leaves a revoked row for the sweep when R2 fails', async () => {
      await connect()
      await seedGoogleFile('u/drive.pdf')
      bucket.delete.mockRejectedValueOnce(new Error('r2 down'))

      const { result } = await call('disconnect')
      const [row] = await connectionRows()

      expect(result.filesPending).toBe(true)
      expect(row).toEqual(expect.objectContaining({
        status: 'revoked',
        refreshToken: null,
        accessToken: null,
      }))
      expect((await call('status')).result)
        .toEqual(expect.objectContaining({ connection: null }))
    })

    it('answers 404 when nothing is connected', async () => {
      expect((await failureOf(call('disconnect'))).status).toBe(404)
    })
  })
})
