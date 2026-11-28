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
  DRIVE_FILE_SCOPE,
  GOOGLE_SUBJECT,
  useGoogleRuntimeConfig,
} from '../../setup/helpers/google-connections'

const ORIGIN = 'https://besidka.com'
const NEW_DRIVE_ID = '1NewDriveNewDriveNewDriveNew99'

const mocks = vi.hoisted(() => ({
  flags: new Set<string>(['google.drive']),
  logged: [] as unknown[],
}))

vi.mock('~~/server/utils/legal/consent', () => {
  return import('../../setup/mocks/legal-consent')
})

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
    return exception as { status: number, message: string }
  }

  throw new Error('Expected a rejection')
}

describe('POST /api/v1/google/drive/saved-files', () => {
  let testDb: MemoryExtractionTestDb
  let kv: FakeConnectorKv
  let userId: number
  let otherUserId: number
  let sessionUserId: number
  let restoreGoogleConfig: () => void = () => {}
  let fetchMock: ReturnType<typeof vi.fn>
  let objects: Map<string, Uint8Array>

  async function seedFile(input: {
    owner?: number
    storageKey?: string
    size?: number
    isDriveCopy?: boolean
    driveCopyId?: string | null
  } = {}) {
    const storageKey = input.storageKey
      ?? `key-${Math.random().toString(36).slice(2)}`
    const bytes = new TextEncoder().encode('# Report')

    objects.set(storageKey, bytes)

    const [row] = await testDb.db.insert(schema.files).values({
      userId: input.owner ?? userId,
      storageKey,
      name: 'Report.md',
      size: input.size ?? bytes.byteLength,
      type: 'text/markdown',
      source: 'assistant',
      ...(input.isDriveCopy
        ? { externalSource: 'google' as const, externalId: NEW_DRIVE_ID }
        : {}),
      driveCopyId: input.driveCopyId ?? null,
    }).returning({ id: schema.files.id })

    return { id: row!.id, storageKey }
  }

  async function seedConnection(status?: 'needs_reauth') {
    const { saveGoogleConnection } = await import(
      '~~/server/utils/google/tokens'
    )

    await saveGoogleConnection(testDb.db, {
      userId,
      clientMode: 'besidka',
      subject: GOOGLE_SUBJECT,
      email: 'person@example.test',
      scopes: ['openid', DRIVE_FILE_SCOPE],
      accessToken: 'access-stored',
      accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
      refreshToken: 'refresh-stored',
    })

    if (status) {
      await testDb.db.update(schema.googleConnections)
        .set({ status })
        .where(eq(schema.googleConnections.userId, userId))
    }
  }

  async function save(
    body: unknown,
    partial: Partial<SkillsRouteEvent> = {},
  ) {
    const module = await import(
      '~~/server/api/v1/google/drive/saved-files/index.post'
    )
    const event = createSkillsRouteEvent({
      body,
      ...partial,
      headers: {
        'origin': ORIGIN,
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json',
        ...partial.headers,
      },
    })

    return await (module.default as Handler)(event)
  }

  beforeEach(async () => {
    mocks.flags = new Set(['google.drive'])
    mocks.logged = []
    objects = new Map()
    testDb = createMemoryExtractionTestDb()
    kv = createFakeConnectorKv()
    userId = await seedUser(testDb.db)
    otherUserId = await seedUser(testDb.db)
    sessionUserId = userId
    fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ id: NEW_DRIVE_ID }))
    })
    vi.stubGlobal('fetch', fetchMock)
    restoreGoogleConfig = await useGoogleRuntimeConfig()
    vi.stubGlobal('useDb', () => testDb.db)
    vi.stubGlobal('useKV', () => kv)
    vi.stubGlobal('useFileStorage', () => ({
      get: vi.fn(async (key: string) => {
        const bytes = objects.get(key)

        return bytes
          ? { arrayBuffer: async () => bytes.buffer.slice(0) }
          : null
      }),
    }))
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
    await seedConnection()
  })

  afterEach(() => {
    restoreGoogleConfig()
    testDb.close()
    vi.unstubAllGlobals()
  })

  it('saves one of the user\'s files as a new Drive file', async () => {
    const file = await seedFile()
    const result = await save({ storageKey: file.storageKey })
    const [row] = await testDb.db.select().from(schema.files)
      .where(eq(schema.files.id, file.id))

    expect(result).toEqual({
      status: 'saved',
      fileId: file.id,
      driveFileId: NEW_DRIVE_ID,
      name: 'Report.md',
      link: `https://drive.google.com/open?id=${NEW_DRIVE_ID}`,
    })
    expect(row!.driveCopyId).toBe(NEW_DRIVE_ID)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('answers with the existing link and creates nothing the second time',
    async () => {
      const file = await seedFile()

      await save({ storageKey: file.storageKey })

      const again = await save({ storageKey: file.storageKey })

      expect(again.status).toBe('already_saved')
      expect(again.link).toContain(NEW_DRIVE_ID)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

  describe('gates', () => {
    it('refuses a signed-out request', async () => {
      sessionUserId = 0

      expect((await failureOf(save({ storageKey: 'abc' }))).status).toBe(401)
    })

    it('answers 404 while google.drive is not active', async () => {
      mocks.flags = new Set()

      expect((await failureOf(save({ storageKey: 'abc' }))).status).toBe(404)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('refuses a cross-origin request', async () => {
      const failure = await failureOf(save({ storageKey: 'abc' }, {
        headers: {
          'origin': 'https://evil.example',
          'sec-fetch-site': 'cross-site',
        },
      }))

      expect(failure.status).toBe(403)
    })

    it('answers 429 after ten saves a minute', async () => {
      const file = await seedFile({ driveCopyId: NEW_DRIVE_ID })

      for (let index = 0; index < 10; index++) {
        await save({ storageKey: file.storageKey })
      }

      expect((await failureOf(save({ storageKey: file.storageKey }))).status)
        .toBe(429)
    })

    it.each([
      ['no body fields', {}],
      ['an unsafe key', { storageKey: '../secret' }],
      ['a file id list', { fileIds: ['a', 'b'] }],
      ['an unknown field', { storageKey: 'abc', extra: true }],
    ])('answers 400 for %s', async (_name, body) => {
      expect((await failureOf(save(body))).status).toBe(400)
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('refusals', () => {
    it('answers 404 for a file that belongs to someone else', async () => {
      const file = await seedFile({ owner: otherUserId })
      const failure = await failureOf(save({ storageKey: file.storageKey }))

      expect(failure.status).toBe(404)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('answers 404 for a key that matches no file', async () => {
      expect((await failureOf(save({ storageKey: 'unknown-key' }))).status)
        .toBe(404)
    })

    it('answers 409 for a copy of a Drive file', async () => {
      const file = await seedFile({ isDriveCopy: true })

      expect((await failureOf(save({ storageKey: file.storageKey }))).status)
        .toBe(409)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('answers 413 for a file over 5 MB', async () => {
      const file = await seedFile({ size: 5 * 1024 * 1024 + 1 })

      expect((await failureOf(save({ storageKey: file.storageKey }))).status)
        .toBe(413)
    })

    it('answers 404 when Google is not connected, before any call',
      async () => {
        const file = await seedFile()

        await testDb.db.delete(schema.googleConnections)

        expect((await failureOf(save({ storageKey: file.storageKey }))).status)
          .toBe(404)
        expect(fetchMock).not.toHaveBeenCalled()
      })

    it('answers 409 when the connection needs re-authorization', async () => {
      const file = await seedFile()

      await testDb.db.update(schema.googleConnections)
        .set({ status: 'needs_reauth' })

      expect((await failureOf(save({ storageKey: file.storageKey }))).status)
        .toBe(409)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it('answers 409 when Drive says the storage is full', async () => {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
        error: { errors: [{ reason: 'storageQuotaExceeded' }] },
      }), { status: 403 }))

      const file = await seedFile()
      const failure = await failureOf(save({ storageKey: file.storageKey }))
      const [row] = await testDb.db.select().from(schema.files)
        .where(eq(schema.files.id, file.id))

      expect(failure.status).toBe(409)
      expect(failure.message).toContain('storage is full')
      expect(row!.driveCopyId).toBeNull()
    })
  })
})
