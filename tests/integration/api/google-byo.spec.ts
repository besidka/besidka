import { createHash } from 'node:crypto'
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
import { createSkillsRouteEvent } from '../../setup/helpers/skills-route'
import type { SkillsRouteEvent } from '../../setup/helpers/skills-route'
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
  defaultTokenReply,
  GOOGLE_CLIENT_ID,
  GOOGLE_EMAIL,
  makeIdToken,
  seedGoogleByoAccess,
  useGoogleRuntimeConfig,
} from '../../setup/helpers/google-connections'
import type {
  FakeBucket,
  FakeGoogle,
} from '../../setup/helpers/google-connections'

const ORIGIN = 'https://pr-12-besidka.chernenko.workers.dev'
const AUTH = 'https://www.googleapis.com/auth/'
const DRIVE_READONLY = `${AUTH}drive.readonly`
const GMAIL_READONLY = `${AUTH}gmail.readonly`
const GMAIL_COMPOSE = `${AUTH}gmail.compose`
const DRIVE_FILE = `${AUTH}drive.file`
const EMAIL_SCOPE = `${AUTH}userinfo.email`

const mocks = vi.hoisted(() => ({
  flags: new Set<string>(['google.drive']),
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

vi.mock('~~/server/utils/features/context', () => ({
  evaluateFeatureForEvent: async (_event: unknown, flag: string) => {
    const isOn = mocks.flags.has(flag)

    return { value: isOn, active: isOn }
  },
  useFeatureContext: async () => ({ userId: null, isAdmin: false }),
}))

vi.mock('~~/server/utils/logging/request-logger', () => ({
  useRequestLogger: () => ({
    set: (values: unknown) => {
      mocks.logged.push(values)
    },
  }),
}))

vi.mock('~~/server/utils/request-public-origin', () => ({
  resolveRequestPublicOrigin: () => 'https://pr-12-besidka.chernenko.workers.dev',
}))

type Handler = (event: SkillsRouteEvent) => Promise<any>

const ROUTES = {
  save: '~~/server/api/v1/profiles/keys/google-oauth-client/index.post',
  remove: '~~/server/api/v1/profiles/keys/google-oauth-client/index.delete',
  start: '~~/server/api/v1/google/byo/start.post',
  callback: '~~/server/api/v1/google/byo/callback.get',
  besidkaStart: '~~/server/api/v1/google/oauth/start.post',
  besidkaCallback: '~~/server/api/v1/google/oauth/callback.get',
  status: '~~/server/api/v1/google/connections/index.get',
  disconnect: '~~/server/api/v1/google/connections/disconnect.post',
  keys: '~~/server/api/v1/profiles/keys/index.get',
} as const

const GATED_ROUTES = ['save', 'start'] as const

async function failureOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (exception) {
    return exception as { status: number, message?: string, why?: string }
  }

  throw new Error('Expected a rejection')
}

describe('Google bring-your-own client routes', () => {
  let testDb: MemoryExtractionTestDb
  let kv: FakeConnectorKv
  let bucket: FakeBucket
  let google: FakeGoogle
  let userId: number
  let sessionUserId: number
  let restoreRuntimeConfig: () => void = () => {}
  let codeChallenges: string[]
  let grantedScope: string

  function useGoogle() {
    google = createFakeGoogle({
      token: (form) => {
        if (form.get('grant_type') !== 'authorization_code') {
          return defaultTokenReply(form)
        }

        const challenge = createHash('sha256')
          .update(form.get('code_verifier') ?? '')
          .digest('base64url')

        if (!codeChallenges.includes(challenge)) {
          return { status: 400, body: { error: 'invalid_grant' } }
        }

        const clientId = form.get('client_id')

        return {
          status: 200,
          body: {
            access_token: `access-${clientId}`,
            refresh_token: `refresh-${clientId}`,
            expires_in: 3599,
            token_type: 'Bearer',
            scope: clientId === BYO_CLIENT_ID
              ? grantedScope
              : `openid ${EMAIL_SCOPE} ${DRIVE_FILE}`,
            id_token: makeIdToken({ aud: clientId }),
          },
        }
      },
    })
    vi.stubGlobal('fetch', google.fetch)
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
        'origin': ORIGIN,
        'sec-fetch-site': 'same-origin',
        ...bodyHeaders,
        ...partial.headers,
      },
    })
    const result = await (module.default as Handler)(event)

    return { result, event }
  }

  async function saveClient(
    clientId = BYO_CLIENT_ID,
    clientSecret = BYO_CLIENT_SECRET,
  ) {
    return (await call('save', { body: { clientId, clientSecret } })).result
  }

  async function startByo(capabilities: string[] = ['drive-read']) {
    const { result } = await call('start', { body: { capabilities } })
    const url = new URL(result.authorizationUrl as string)

    codeChallenges.push(url.searchParams.get('code_challenge')!)

    return url
  }

  async function startBesidka() {
    const { result } = await call('besidkaStart', { body: {} })
    const url = new URL(result.authorizationUrl as string)

    codeChallenges.push(url.searchParams.get('code_challenge')!)

    return url
  }

  async function finish(
    route: 'callback' | 'besidkaCallback',
    url: URL,
  ) {
    const { event } = await call(route, {
      query: { state: url.searchParams.get('state')!, code: 'auth-code' },
      headers: { 'origin': '', 'sec-fetch-site': 'cross-site' },
    })

    return event.res.headers.get('location') ?? ''
  }

  async function connectByo(capabilities: string[] = ['drive-read']) {
    return await finish('callback', await startByo(capabilities))
  }

  async function connectBesidka() {
    return await finish('besidkaCallback', await startBesidka())
  }

  async function connectionRow(clientMode: 'besidka' | 'byo') {
    const [row] = await testDb.db
      .select()
      .from(schema.googleConnections)
      .where(and(
        eq(schema.googleConnections.userId, userId),
        eq(schema.googleConnections.clientMode, clientMode),
      ))

    return row ?? null
  }

  async function storedClientRows() {
    return await testDb.db
      .select()
      .from(schema.keys)
      .where(and(
        eq(schema.keys.userId, userId),
        eq(schema.keys.provider, 'google-oauth-client'),
      ))
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

  async function seedStoredClient() {
    await testDb.db.insert(schema.keys).values({
      userId,
      provider: 'google-oauth-client',
      apiKey: fakeEncrypt(JSON.stringify({
        clientId: BYO_CLIENT_ID,
        clientSecret: BYO_CLIENT_SECRET,
      })),
    })
  }

  async function callbackLocation() {
    const { event } = await call('callback', {
      query: { state: 'a'.repeat(43), code: 'auth-code' },
      headers: { 'origin': '', 'sec-fetch-site': 'cross-site' },
    })

    return event.res.headers.get('location') ?? ''
  }

  function revokedTokens() {
    return google.revokeRequests().map((request) => {
      return request.form.get('token')
    })
  }

  beforeEach(async () => {
    mocks.flags = new Set(['google.drive'])
    mocks.logged = []
    codeChallenges = []
    grantedScope = `openid ${EMAIL_SCOPE} ${DRIVE_READONLY}`
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

  describe('admin gate', () => {
    it.each(GATED_ROUTES)('%s refuses a signed-out request', async (route) => {
      sessionUserId = 0

      expect((await failureOf(call(route))).status).toBe(401)
    })

    it('sends a signed-out callback back to the Google tab', async () => {
      sessionUserId = 0

      expect(await callbackLocation())
        .toBe('/profile/keys?tab=google&google-byo=error')
    })

    it('refuses a signed-out delete', async () => {
      sessionUserId = 0

      expect((await failureOf(call('remove'))).status).toBe(401)
    })

    it.each(GATED_ROUTES)(
      '%s refuses a non-admin whose flag grants make google.byo active',
      async (route) => {
        await seedGoogleByoAccess(testDb.db, userId, {
          admin: false,
          grant: true,
        })

        const { createBackgroundFeatureCheck } = await import(
          '~~/server/utils/features/background'
        )
        const flagCheck = createBackgroundFeatureCheck({
          flag: 'google.byo',
          db: testDb.db,
          kv: kv as never,
        })

        expect(await flagCheck.isActiveForUser(userId)).toBe(true)

        const failure = await failureOf(call(route, {
          body: route === 'save'
            ? { clientId: BYO_CLIENT_ID, clientSecret: BYO_CLIENT_SECRET }
            : { capabilities: ['drive-read'] },
        }))

        expect(failure.status).toBe(404)
        expect(failure.why).toBe('feature_unavailable')
        expect(await storedClientRows()).toEqual([])
      },
    )

    it('sends the callback of a flag-granted non-admin back with an error',
      async () => {
        await seedGoogleByoAccess(testDb.db, userId, {
          admin: false,
          grant: true,
        })

        expect(await callbackLocation())
          .toBe('/profile/keys?tab=google&google-byo=error')
        expect(google.tokenRequests()).toHaveLength(0)
      })

    it.each(GATED_ROUTES)(
      '%s refuses an admin who did not opt in to google.byo',
      async (route) => {
        await seedGoogleByoAccess(testDb.db, userId, { optIn: false })

        const failure = await failureOf(call(route))

        expect(failure.status).toBe(404)
        expect(failure.why).toBe('feature_unavailable')
      },
    )

    it('lets a non-admin delete a client they left behind', async () => {
      await seedGoogleByoAccess(testDb.db, userId, {
        admin: false,
        grant: true,
      })
      await seedStoredClient()

      const { result } = await call('remove')

      expect(result).toEqual({
        deleted: true,
        connectionEnded: false,
        revoked: false,
      })
      expect(await storedClientRows()).toEqual([])
    })

    it('shows a non-admin with a stored client only what removes it',
      async () => {
        await seedStoredClient()

        expect((await call('status')).result.byo).toEqual({
          canManage: false,
          redirectUri: null,
          hasClient: true,
          connection: null,
        })
      })

    it.each(['save', 'remove', 'start'] as const)(
      '%s refuses a cross-origin request',
      async (route) => {
        await seedGoogleByoAccess(testDb.db, userId)

        const failure = await failureOf(call(route, {
          headers: {
            'origin': 'https://evil.example',
            'sec-fetch-site': 'cross-site',
          },
        }))

        expect(failure.status).toBe(403)
      },
    )

    it('checks the gate again when Google calls back', async () => {
      await seedGoogleByoAccess(testDb.db, userId)
      await saveClient()

      const url = await startByo()

      await testDb.db
        .delete(schema.userRoles)
        .where(eq(schema.userRoles.userId, userId))

      expect(await finish('callback', url))
        .toBe('/profile/keys?tab=google&google-byo=error')
      expect(google.tokenRequests()).toHaveLength(0)
      expect(await connectionRow('byo')).toBeNull()
    })

    it('hides the own client from the status of a non-admin', async () => {
      await seedGoogleByoAccess(testDb.db, userId, {
        admin: false,
        grant: true,
      })

      expect((await call('status')).result.byo).toBeNull()
    })
  })

  describe('saving the client', () => {
    beforeEach(async () => {
      await seedGoogleByoAccess(testDb.db, userId)
    })

    it('stores both values encrypted and answers without either',
      async () => {
        const result = await saveClient()
        const [row] = await storedClientRows()

        expect(result).toEqual({ saved: true, connectionEnded: false })
        expect(row!.apiKey).toMatch(/^enc:/)
        expect(JSON.parse(fakeDecrypt(row!.apiKey))).toEqual({
          clientId: BYO_CLIENT_ID,
          clientSecret: BYO_CLIENT_SECRET,
        })

        const logged = JSON.stringify(mocks.logged)

        expect(logged).not.toContain(BYO_CLIENT_SECRET)
        expect(logged).not.toContain(BYO_CLIENT_ID)
      })

    it('shows the redirect URI and "saved" without decrypting', async () => {
      await saveClient()

      const decrypt = vi.fn(async (cipher: string) => fakeDecrypt(cipher))

      vi.stubGlobal('useDecryptText', decrypt)

      const { result } = await call('status')
      const serialized = JSON.stringify(result)

      expect(result.byo).toEqual({
        canManage: true,
        redirectUri: `${ORIGIN}/api/v1/google/byo/callback`,
        hasClient: true,
        connection: null,
      })
      expect(decrypt).not.toHaveBeenCalled()
      expect(serialized).not.toContain(BYO_CLIENT_SECRET)
      expect(serialized).not.toContain(BYO_CLIENT_ID)
    })

    it.each([
      ['the sign-in client', GOOGLE_CLIENT_ID, {}],
      [
        'the dedicated Drive client',
        'drive-test-client.apps.googleusercontent.com',
        {
          googleDriveClientId: 'drive-test-client.apps.googleusercontent.com',
          googleDriveClientSecret: 'drive-test-secret-value-0123456789',
        },
      ],
    ])('refuses Besidka\'s own %s', async (_label, clientId, overrides) => {
      restoreRuntimeConfig()
      restoreRuntimeConfig = await useGoogleRuntimeConfig(overrides)

      const failure = await failureOf(saveClient(clientId))

      expect(failure.status).toBe(400)
      expect(failure.message).toBe('This is Besidka\'s own Google client')
      expect(failure.why).toBeTruthy()
      expect(await storedClientRows()).toEqual([])
    })

    it('answers a clean 200 when two saves race', async () => {
      const results = await Promise.all([
        saveClient(),
        saveClient(BYO_CLIENT_ID, 'test-second-secret-value-0123456'),
      ])

      expect(results.every(result => result.saved)).toBe(true)
      expect(await storedClientRows()).toHaveLength(1)
    })

    it.each([
      ['a client id without the Google suffix', {
        clientId: 'owner-client.example.com',
        clientSecret: BYO_CLIENT_SECRET,
      }],
      ['a short secret', {
        clientId: BYO_CLIENT_ID,
        clientSecret: 'test-short',
      }],
      ['a secret with spaces', {
        clientId: BYO_CLIENT_ID,
        clientSecret: 'test owner secret value 0123456789',
      }],
      ['a missing secret', { clientId: BYO_CLIENT_ID }],
    ])('refuses %s without echoing it', async (_label, body) => {
      const failure = await failureOf(call('save', { body }))
      const serialized = JSON.stringify(failure)

      expect(failure.status).toBe(400)

      for (const value of Object.values(body)) {
        expect(serialized).not.toContain(value)
      }

      expect(await storedClientRows()).toEqual([])
    })

    it('keeps the connection when only the secret is rotated', async () => {
      await saveClient()
      await connectByo()
      await saveClient(BYO_CLIENT_ID, 'test-rotated-secret-value-0123456')

      const [row] = await storedClientRows()

      expect(JSON.parse(fakeDecrypt(row!.apiKey)).clientSecret)
        .toBe('test-rotated-secret-value-0123456')
      expect((await connectionRow('byo'))!.status).toBe('active')
      expect(google.revokeRequests()).toHaveLength(0)
    })

    it('ends the connection first when another client replaces it',
      async () => {
        await saveClient()
        await connectByo()

        const result = await saveClient(
          'other-test-client-wxyz.apps.googleusercontent.com',
        )

        expect(result.connectionEnded).toBe(true)
        expect(revokedTokens()).toEqual([`refresh-${BYO_CLIENT_ID}`])
        expect(await connectionRow('byo')).toBeNull()
      })

    it('keeps the own client out of the keys summary', async () => {
      await saveClient()
      vi.stubGlobal('enforceKeysRateLimit', async () => {})

      const { result } = await call('keys')
      const providers = result.keys.map((key: { provider: string }) => {
        return key.provider
      })

      expect(providers).not.toContain('google-oauth-client')
      expect(providers).toContain('google')
    })
  })

  describe('deleting the client', () => {
    beforeEach(async () => {
      await seedGoogleByoAccess(testDb.db, userId)
    })

    it('ends the connection before deleting the client', async () => {
      await saveClient()
      await connectByo()

      const { result } = await call('remove')

      expect(result).toEqual({
        deleted: true,
        connectionEnded: true,
        revoked: true,
      })
      expect(revokedTokens()).toEqual([`refresh-${BYO_CLIENT_ID}`])
      expect(await connectionRow('byo')).toBeNull()
      expect(await storedClientRows()).toEqual([])
    })

    it('answers 404 when nothing is saved', async () => {
      expect((await failureOf(call('remove'))).status).toBe(404)
    })

    it('deletes nothing when the connection cannot be read', async () => {
      await saveClient()
      await connectByo()

      const select = vi.spyOn(testDb.db, 'select')

      select.mockImplementationOnce(() => {
        throw new Error('D1 unavailable')
      })

      await failureOf(call('remove'))
      select.mockRestore()

      expect(await storedClientRows()).toHaveLength(1)
      expect((await connectionRow('byo'))!.status).toBe('active')
      expect(google.revokeRequests()).toHaveLength(0)
    })
  })

  describe('connecting', () => {
    beforeEach(async () => {
      await seedGoogleByoAccess(testDb.db, userId)
    })

    it('needs a saved client first', async () => {
      const failure = await failureOf(call('start', {
        body: { capabilities: ['drive-read'] },
      }))

      expect(failure.status).toBe(409)
    })

    it('asks only for the ticked capabilities on the own callback path',
      async () => {
        await saveClient()

        const url = await startByo(['gmail-read', 'gmail-compose'])
        const scopes = url.searchParams.get('scope')!.split(' ')

        expect(url.searchParams.get('client_id')).toBe(BYO_CLIENT_ID)
        expect(url.searchParams.get('redirect_uri'))
          .toBe(`${ORIGIN}/api/v1/google/byo/callback`)
        expect(scopes.sort()).toEqual(
          ['openid', EMAIL_SCOPE, GMAIL_READONLY, GMAIL_COMPOSE].sort(),
        )
        expect(scopes).not.toContain(DRIVE_FILE)
        expect(scopes).not.toContain(DRIVE_READONLY)
      })

    it('asks for the two narrow Calendar scopes only when Calendar is on '
      + 'for the owner', async () => {
      await saveClient()
      await testDb.db.insert(schema.featureOptIns).values({
        userId,
        flag: 'google.calendar',
        optedInAt: new Date('2026-11-01T00:00:00.000Z'),
      })

      const url = await startByo(['calendar'])
      const scopes = url.searchParams.get('scope')!.split(' ')

      expect(scopes.sort()).toEqual([
        'openid',
        EMAIL_SCOPE,
        `${AUTH}calendar.events.owned`,
        `${AUTH}calendar.events.freebusy`,
      ].sort())
      expect(scopes).not.toContain(`${AUTH}calendar.events`)
      expect(scopes).not.toContain(`${AUTH}calendar`)
    })

    it('refuses the Calendar capability while Calendar is off for the '
      + 'owner, without calling Google', async () => {
      await saveClient()

      const failure = await failureOf(call('start', {
        body: { capabilities: ['drive-read', 'calendar'] },
      }))

      expect(failure.status).toBe(403)
      expect(failure.message).toContain('Google Calendar is not turned on')
    })

    it('still starts a connection without Calendar while Calendar is off',
      async () => {
        await saveClient()

        const url = await startByo(['drive-read'])

        expect(url.searchParams.get('scope')).not.toContain('calendar')
      })

    it.each([
      ['no capability', { capabilities: [] }],
      ['an unknown capability', { capabilities: ['drive-picked'] }],
      ['a scope string', { capabilities: [GMAIL_READONLY] }],
    ])('refuses %s', async (_label, body) => {
      await saveClient()

      expect((await failureOf(call('start', { body }))).status).toBe(400)
    })

    it('connects with the own client and stores the granted scopes',
      async () => {
        await saveClient()

        const location = await connectByo(['drive-read'])
        const row = await connectionRow('byo')
        const [exchange] = google.tokenRequests()

        expect(location).toBe('/profile/keys?tab=google&google-byo=connected')
        expect(exchange!.form.get('client_id')).toBe(BYO_CLIENT_ID)
        expect(exchange!.form.get('client_secret')).toBe(BYO_CLIENT_SECRET)
        expect(exchange!.form.get('redirect_uri'))
          .toBe(`${ORIGIN}/api/v1/google/byo/callback`)
        expect(row!.status).toBe('active')
        expect(row!.grantedScopes).toContain(DRIVE_READONLY)
        expect(fakeDecrypt(row!.refreshToken!))
          .toBe(`refresh-${BYO_CLIENT_ID}`)

        const { result } = await call('status')

        expect(result.connection).toBeNull()
        expect(result.byo.connection).toEqual(expect.objectContaining({
          clientMode: 'byo',
          status: 'active',
          email: GOOGLE_EMAIL,
          capabilities: expect.arrayContaining(['drive-read']),
        }))
        expect(JSON.stringify(result)).not.toContain('enc:')
      })

    it('records a partial grant as partial, with only what was granted',
      async () => {
        await saveClient()
        grantedScope = `openid ${EMAIL_SCOPE} ${GMAIL_READONLY}`

        const location = await connectByo(['gmail-read', 'gmail-compose'])
        const row = await connectionRow('byo')
        const { result } = await call('status')

        expect(location).toBe('/profile/keys?tab=google&google-byo=partial')
        expect(row!.grantedScopes).toContain(GMAIL_READONLY)
        expect(row!.grantedScopes).not.toContain(GMAIL_COMPOSE)
        expect(result.byo.connection.capabilities).toContain('gmail-read')
        expect(result.byo.connection.capabilities)
          .not.toContain('gmail-compose')
      })

    it('stores a Calendar grant of both scopes as the Calendar capability, '
      + 'and one scope alone as a partial grant', async () => {
      await saveClient()
      await testDb.db.insert(schema.featureOptIns).values({
        userId,
        flag: 'google.calendar',
        optedInAt: new Date('2026-11-01T00:00:00.000Z'),
      })
      grantedScope = `openid ${EMAIL_SCOPE} ${AUTH}calendar.events.owned `
        + `${AUTH}calendar.events.freebusy`

      expect(await connectByo(['calendar']))
        .toBe('/profile/keys?tab=google&google-byo=connected')
      expect((await call('status')).result.byo.connection.capabilities)
        .toContain('calendar')

      await testDb.db.delete(schema.googleConnections)
      grantedScope = `openid ${EMAIL_SCOPE} ${AUTH}calendar.events.owned`

      expect(await connectByo(['calendar']))
        .toBe('/profile/keys?tab=google&google-byo=partial')

      const row = await connectionRow('byo')

      expect(row!.grantedScopes).toContain(`${AUTH}calendar.events.owned`)
      expect(row!.grantedScopes)
        .not.toContain(`${AUTH}calendar.events.freebusy`)
      expect((await call('status')).result.byo.connection.capabilities)
        .not.toContain('calendar')
    })

    it('stores only what was asked for when Google returns more',
      async () => {
        await saveClient()
        grantedScope = [
          'openid',
          EMAIL_SCOPE,
          DRIVE_READONLY,
          `${AUTH}calendar.events`,
          `${AUTH}calendar.events.owned`,
          `${AUTH}userinfo.profile`,
        ].join(' ')

        await connectByo(['drive-read'])

        const row = await connectionRow('byo')

        expect(row!.grantedScopes.sort())
          .toEqual(['openid', EMAIL_SCOPE, DRIVE_READONLY].sort())
      })

    it('adds a capability while connected and keeps the earlier one',
      async () => {
        await saveClient()
        await connectByo(['drive-read'])
        grantedScope = `openid ${EMAIL_SCOPE} ${DRIVE_READONLY} ${GMAIL_READONLY}`

        const url = await startByo(['gmail-read'])

        expect(url.searchParams.get('scope')!.split(' '))
          .toEqual(expect.arrayContaining([DRIVE_READONLY, GMAIL_READONLY]))

        const location = await finish('callback', url)
        const row = await connectionRow('byo')

        expect(location).toBe('/profile/keys?tab=google&google-byo=connected')
        expect(row!.grantedScopes)
          .toEqual(expect.arrayContaining([DRIVE_READONLY, GMAIL_READONLY]))
      })

    it('revokes a grant that holds none of the ticked capabilities',
      async () => {
        await saveClient()
        grantedScope = `openid ${EMAIL_SCOPE}`

        const location = await connectByo(['drive-read'])

        expect(location)
          .toBe('/profile/keys?tab=google&google-byo=missing_scope')
        expect(revokedTokens()).toEqual([`refresh-${BYO_CLIENT_ID}`])
        expect(await connectionRow('byo')).toBeNull()
      })

    it('refuses a Besidka state on the own callback', async () => {
      await saveClient()

      const url = await startBesidka()
      const location = await finish('callback', url)

      expect(location).toBe('/profile/keys?tab=google&google-byo=error')
      expect(google.tokenRequests()).toHaveLength(0)
    })

    it('refuses an own-client state on Besidka\'s callback', async () => {
      await saveClient()

      const url = await startByo()
      const location = await finish('besidkaCallback', url)

      expect(location).toBe('/profile/keys?tab=google&google=error')
      expect(google.tokenRequests()).toHaveLength(0)
      expect(await connectionRow('byo')).toBeNull()
      expect(await connectionRow('besidka')).toBeNull()
    })

    it('never sends Besidka\'s client a code from the own flow', async () => {
      await saveClient()
      await connectByo()

      const clientIds = google.tokenRequests().map((request) => {
        return request.form.get('client_id')
      })

      expect(clientIds).toEqual([BYO_CLIENT_ID])
      expect(clientIds).not.toContain(GOOGLE_CLIENT_ID)
    })
  })

  describe('two connections side by side', () => {
    beforeEach(async () => {
      await seedGoogleByoAccess(testDb.db, userId)
      await saveClient()
      await connectBesidka()
      await connectByo()
      await seedGoogleFile('user/drive-a.pdf')
    })

    it('shows both connections in the status', async () => {
      const { result } = await call('status')

      expect(result.connection.clientMode).toBe('besidka')
      expect(result.byo.connection.clientMode).toBe('byo')
    })

    it('keeps Besidka\'s copies when the own client disconnects',
      async () => {
        const { result } = await call('disconnect', {
          body: { clientMode: 'byo' },
        })

        expect(result.disconnected).toBe(true)
        expect(revokedTokens()).toEqual([`refresh-${BYO_CLIENT_ID}`])
        expect(await connectionRow('byo')).toBeNull()
        expect((await connectionRow('besidka'))!.status).toBe('active')
        expect(await fileCount()).toBe(1)
      })

    it('deletes Besidka\'s copies when Besidka\'s client disconnects, '
      + 'even while the own client stays', async () => {
      await call('disconnect')

      expect(revokedTokens()).toEqual([`refresh-${GOOGLE_CLIENT_ID}`])
      expect(await connectionRow('besidka')).toBeNull()
      expect((await connectionRow('byo'))!.status).toBe('active')
      expect(await fileCount()).toBe(0)
    })

    it('lets a user who lost the admin role still disconnect', async () => {
      await testDb.db
        .delete(schema.userRoles)
        .where(eq(schema.userRoles.userId, userId))

      const status = (await call('status')).result

      expect(status.byo).toEqual(expect.objectContaining({
        canManage: false,
        redirectUri: null,
        hasClient: true,
      }))
      expect(status.byo.connection.clientMode).toBe('byo')

      await call('disconnect', { body: { clientMode: 'byo' } })
      await call('remove')

      expect(await connectionRow('byo')).toBeNull()
      expect(await storedClientRows()).toEqual([])
    })

    it('refuses an own-client disconnect that lost its Content-Length',
      async () => {
        const failure = await failureOf(call('disconnect', {
          body: { clientMode: 'byo' },
          headers: { 'content-length': '' },
        }))

        expect(failure.status).toBe(411)
        expect((await connectionRow('besidka'))!.status).toBe('active')
        expect((await connectionRow('byo'))!.status).toBe('active')
        expect(await fileCount()).toBe(1)
      })

    it('refuses a disconnect body that is not JSON', async () => {
      const failure = await failureOf(call('disconnect', {
        headers: { 'content-length': '24' },
      }))

      expect(failure.status).toBe(400)
      expect((await connectionRow('besidka'))!.status).toBe('active')
    })

    describe('the hourly gate sweep', () => {
      async function sweepByoGate() {
        const { endUngatedGoogleByoConnections } = await import(
          '~~/server/utils/google/byo-sweep'
        )

        return await endUngatedGoogleByoConnections({
          db: testDb.db,
          kv: kv as never,
          logger: { set: vi.fn() },
          storage: bucket,
        })
      }

      it('leaves the connection of a user who passes the gate', async () => {
        const result = await sweepByoGate()

        expect(result).toEqual({ checked: 1, ended: 0, failed: 0 })
        expect((await connectionRow('byo'))!.status).toBe('active')
        expect(google.revokeRequests()).toHaveLength(0)
      })

      it('ends the connection of a user who lost the admin role', async () => {
        await testDb.db
          .delete(schema.userRoles)
          .where(eq(schema.userRoles.userId, userId))

        const result = await sweepByoGate()

        expect(result).toEqual({ checked: 1, ended: 1, failed: 0 })
        expect(revokedTokens()).toEqual([`refresh-${BYO_CLIENT_ID}`])
        expect(await connectionRow('byo')).toBeNull()
        expect((await connectionRow('besidka'))!.status).toBe('active')
        expect(await fileCount()).toBe(1)
      })

      it('ends the connection when the user opted out of google.byo',
        async () => {
          await testDb.db
            .update(schema.featureOptIns)
            .set({ optedOutAt: new Date() })
            .where(and(
              eq(schema.featureOptIns.userId, userId),
              eq(schema.featureOptIns.flag, 'google.byo'),
            ))

          const result = await sweepByoGate()

          expect(result.ended).toBe(1)
          expect(await connectionRow('byo')).toBeNull()
        })
    })

    it('revokes both grants and deletes the client with the account',
      async () => {
        const { purgeUserGoogleConnections } = await import(
          '~~/server/utils/account/purge-google-connections'
        )

        const result = await purgeUserGoogleConnections(userId, testDb.db)

        expect(result.googleConnectionsDeleted).toBe(2)
        expect(revokedTokens().sort()).toEqual([
          `refresh-${BYO_CLIENT_ID}`,
          `refresh-${GOOGLE_CLIENT_ID}`,
        ].sort())

        await testDb.db.delete(schema.users).where(eq(schema.users.id, userId))

        expect(await storedClientRows()).toEqual([])
      })
  })
})
