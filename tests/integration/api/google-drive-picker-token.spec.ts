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
  createFakeGoogle,
  DRIVE_FILE_SCOPE,
  GOOGLE_SUBJECT,
  useGoogleRuntimeConfig,
} from '../../setup/helpers/google-connections'
import type { FakeGoogle } from '../../setup/helpers/google-connections'

const ORIGIN = 'https://besidka.com'
const PICKER_KEY = 'public-picker-api-key'
const PROJECT_NUMBER = '123456789012'
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events'
const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'

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

vi.mock('~~/server/utils/request-public-origin', () => ({
  resolveRequestPublicOrigin: () => 'https://besidka.com',
}))

vi.mock('~~/server/utils/logging/request-logger', () => ({
  useRequestLogger: () => ({
    set: (values: unknown) => {
      mocks.logged.push(values)
    },
  }),
}))

type Handler = (event: SkillsRouteEvent) => Promise<any>

async function failureOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (exception) {
    return exception as { status: number, code?: string }
  }

  throw new Error('Expected a rejection')
}

describe('POST /api/v1/google/drive/picker-token', () => {
  let testDb: MemoryExtractionTestDb
  let kv: FakeConnectorKv
  let google: FakeGoogle
  let userId: number
  let sessionUserId: number
  let restoreGoogleConfig: () => void = () => {}
  let restorePickerConfig: () => void = () => {}

  async function usePickerConfig(values: Record<string, string>) {
    const runtimeConfig = (await import('#app/nuxt')).useRuntimeConfig() as
      unknown as { public: Record<string, unknown> }
    const previous = { ...runtimeConfig.public }

    Object.assign(runtimeConfig.public, values)

    return () => {
      for (const key of Object.keys(values)) {
        runtimeConfig.public[key] = previous[key]
      }
    }
  }

  async function seedConnection(input: {
    clientMode?: 'besidka' | 'byo'
    scopes?: string[]
    expiresInMs?: number
    status?: 'active' | 'needs_reauth' | 'revoked'
  } = {}) {
    const { saveGoogleConnection } = await import(
      '~~/server/utils/google/tokens'
    )

    await saveGoogleConnection(testDb.db, {
      userId,
      clientMode: input.clientMode ?? 'besidka',
      subject: GOOGLE_SUBJECT,
      email: 'person@example.test',
      scopes: input.scopes ?? ['openid', DRIVE_FILE_SCOPE],
      accessToken: 'access-stored',
      accessTokenExpiresAt: new Date(
        Date.now() + (input.expiresInMs ?? 3_600_000),
      ),
      refreshToken: 'refresh-stored',
    })

    if (input.status && input.status !== 'active') {
      await testDb.db.update(schema.googleConnections)
        .set({ status: input.status })
        .where(eq(schema.googleConnections.userId, userId))
    }
  }

  async function call(partial: Partial<SkillsRouteEvent> = {}) {
    const module = await import(
      '~~/server/api/v1/google/drive/picker-token.post'
    )
    const event = createSkillsRouteEvent({
      ...partial,
      headers: {
        'origin': ORIGIN,
        'sec-fetch-site': 'same-origin',
        'content-length': '0',
        ...partial.headers,
      },
    })
    const result = await (module.default as Handler)(event)

    return { result, event }
  }

  beforeEach(async () => {
    mocks.flags = new Set(['google.drive'])
    mocks.logged = []
    testDb = createMemoryExtractionTestDb()
    kv = createFakeConnectorKv()
    userId = await seedUser(testDb.db)
    sessionUserId = userId
    google = createFakeGoogle()
    vi.stubGlobal('fetch', google.fetch)
    restoreGoogleConfig = await useGoogleRuntimeConfig()
    restorePickerConfig = await usePickerConfig({
      googlePickerApiKey: PICKER_KEY,
      googleCloudProjectNumber: PROJECT_NUMBER,
    })
    vi.stubGlobal('useDb', () => testDb.db)
    vi.stubGlobal('useKV', () => kv)
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
    restorePickerConfig()
    restoreGoogleConfig()
    testDb.close()
    vi.unstubAllGlobals()
  })

  describe('gates', () => {
    it('refuses a signed-out request', async () => {
      sessionUserId = 0

      expect((await failureOf(call())).status).toBe(401)
    })

    it('answers 404 while google.drive is not active', async () => {
      mocks.flags = new Set()
      await seedConnection()

      expect((await failureOf(call())).status).toBe(404)
      expect(google.fetch).not.toHaveBeenCalled()
    })

    it('refuses a cross-origin request', async () => {
      await seedConnection()

      const failure = await failureOf(call({
        headers: {
          'origin': 'https://evil.example',
          'sec-fetch-site': 'cross-site',
        },
      }))

      expect(failure.status).toBe(403)
    })

    it('answers 429 after thirty requests a minute', async () => {
      await seedConnection()

      for (let index = 0; index < 30; index++) {
        await call()
      }

      expect((await failureOf(call())).status).toBe(429)
    })

    it('fails closed when the rate limit cannot be counted', async () => {
      await seedConnection()
      kv.get.mockImplementation(async (key: string) => {
        if (key.startsWith('google-picker-rate-limit')) {
          throw new Error('kv down')
        }

        return kv.values.get(key) ?? null
      })

      expect((await failureOf(call())).status).toBe(429)
    })
  })

  describe('the token', () => {
    it('hands out the access token with the public Picker values', async () => {
      await seedConnection()

      const { result } = await call()

      expect(result).toEqual({
        accessToken: 'access-stored',
        expiresInSeconds: expect.any(Number),
        apiKey: PICKER_KEY,
        appId: PROJECT_NUMBER,
      })
      expect(result.expiresInSeconds).toBeGreaterThan(3500)
      expect(google.fetch).not.toHaveBeenCalled()
    })

    it('is never cached and sends no referrer', async () => {
      await seedConnection()

      const { event } = await call()

      expect(event.res.headers.get('cache-control')).toBe('no-store')
      expect(event.res.headers.get('pragma')).toBe('no-cache')
      expect(event.res.headers.get('referrer-policy')).toBe('no-referrer')
    })

    it('never returns the refresh token and never logs a token', async () => {
      await seedConnection()

      const { result } = await call()
      const logged = JSON.stringify(mocks.logged)

      expect(JSON.stringify(result)).not.toContain('refresh-stored')
      expect(Object.keys(result).sort()).toEqual([
        'accessToken',
        'apiKey',
        'appId',
        'expiresInSeconds',
      ])
      expect(logged).not.toContain('access-stored')
      expect(logged).not.toContain('refresh-stored')
    })

    it('refreshes an expiring token through the refresh lock', async () => {
      await seedConnection({ expiresInMs: 30_000 })

      const { result } = await call()

      expect(result.accessToken).toMatch(/^access-refreshed-/)
      expect(google.tokenRequests()).toHaveLength(1)
      expect(google.tokenRequests()[0]!.form.get('grant_type'))
        .toBe('refresh_token')
    })
  })

  describe('the connection', () => {
    it('answers 404 with a specific code when Google is not connected',
      async () => {
        const failure = await failureOf(call())

        expect(failure).toMatchObject({
          status: 404,
          code: 'google_not_connected',
        })
      })

    it('answers 404 for a revoked connection', async () => {
      await seedConnection({ status: 'revoked' })

      expect(await failureOf(call())).toMatchObject({
        status: 404,
        code: 'google_not_connected',
      })
    })

    it('answers 409 when the connection needs re-authorization', async () => {
      await seedConnection({ status: 'needs_reauth' })

      expect(await failureOf(call())).toMatchObject({
        status: 409,
        code: 'google_reauthorize',
      })
    })

    it('answers 409 when drive.file is not granted', async () => {
      await seedConnection({ scopes: ['openid'] })

      expect(await failureOf(call())).toMatchObject({
        status: 409,
        code: 'google_reauthorize',
      })
    })

    it('answers 409 and mints nothing when the grant holds more than Drive',
      async () => {
        await seedConnection({
          scopes: ['openid', DRIVE_FILE_SCOPE, CALENDAR_SCOPE],
          expiresInMs: 30_000,
        })

        expect(await failureOf(call())).toMatchObject({
          status: 409,
          code: 'google_picker_scope_too_wide',
        })
        expect(google.fetch).not.toHaveBeenCalled()
      })
  })

  describe('a refresh that widens the grant', () => {
    it('refuses the token when the refresh stored wider scopes', async () => {
      google = createFakeGoogle({
        token: () => ({
          status: 200,
          body: {
            access_token: 'access-widened',
            expires_in: 3599,
            token_type: 'Bearer',
            scope: `openid ${DRIVE_FILE_SCOPE} ${CALENDAR_SCOPE}`,
          },
        }),
      })
      vi.stubGlobal('fetch', google.fetch)
      await seedConnection({ expiresInMs: 30_000 })

      const failure = await failureOf(call())

      expect(failure).toMatchObject({
        status: 409,
        code: 'google_picker_scope_too_wide',
      })
      expect(google.tokenRequests()).toHaveLength(1)
      expect(JSON.stringify(mocks.logged)).toContain('after-mint')
      expect(JSON.stringify(mocks.logged)).not.toContain('access-widened')
    })

    it('returns the refreshed token when the scopes stay narrow', async () => {
      await seedConnection({ expiresInMs: 30_000 })

      const { result } = await call()

      expect(result.accessToken).toMatch(/^access-refreshed-/)
    })
  })

  describe('lifetime', () => {
    it('hands out the cached token with its real remaining lifetime',
      async () => {
        await seedConnection({ expiresInMs: 4 * 60_000 })

        const { result } = await call()

        expect(result.accessToken).toBe('access-stored')
        expect(result.expiresInSeconds).toBeGreaterThan(200)
        expect(result.expiresInSeconds).toBeLessThanOrEqual(240)
        expect(google.tokenRequests()).toHaveLength(0)
      })
  })

  describe('configuration', () => {
    it.each([
      ['the API key', { googlePickerApiKey: '' }],
      ['the project number', { googleCloudProjectNumber: '' }],
    ])('answers a clean 503 when %s is not set', async (_name, values) => {
      await seedConnection()
      restorePickerConfig()
      restorePickerConfig = await usePickerConfig({
        googlePickerApiKey: PICKER_KEY,
        googleCloudProjectNumber: PROJECT_NUMBER,
        ...values,
      })

      expect(await failureOf(call())).toMatchObject({
        status: 503,
        code: 'google_picker_not_configured',
      })
      expect(google.fetch).not.toHaveBeenCalled()
    })
  })

  describe('the owner\'s own client', () => {
    it('refuses the byo mode in code, before any token is read', async () => {
      await seedConnection({
        clientMode: 'byo',
        scopes: ['openid', GMAIL_SCOPE],
      })

      const { createGooglePickerToken } = await import(
        '~~/server/utils/google/picker-token'
      )
      const failure = await failureOf(createGooglePickerToken({
        db: testDb.db,
        kv: kv as never,
        userId,
        clientMode: 'byo',
        apiKey: PICKER_KEY,
        projectNumber: PROJECT_NUMBER,
      }))

      expect(failure).toMatchObject({
        status: 403,
        code: 'google_picker_client_refused',
      })
      expect(google.fetch).not.toHaveBeenCalled()
    })

    it('ignores a connected byo account: the route uses Besidka\'s client',
      async () => {
        await seedConnection({
          clientMode: 'byo',
          scopes: ['openid', GMAIL_SCOPE],
        })

        expect(await failureOf(call())).toMatchObject({
          status: 404,
          code: 'google_not_connected',
        })
      })
  })
})
