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
const MEBIBYTE = 1024 * 1024
const DOC_ID = '1DocDocDocDocDocDocDocDocDocDoc01'
const PDF_ID = '1PdfPdfPdfPdfPdfPdfPdfPdfPdfPdf04'
const PNG_ID = '1PngPngPngPngPngPngPngPngPngPng05'
const FIRST_EDIT = '2026-11-20T10:00:00.000Z'
const SECOND_EDIT = '2026-11-21T09:30:00.000Z'

const mocks = vi.hoisted(() => ({
  flags: new Set<string>(['google.drive']),
  logged: [] as unknown[],
  tokenCalls: 0,
}))

vi.mock('~~/server/utils/google/tokens', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('~~/server/utils/google/tokens')
  >()

  return {
    ...actual,
    getGoogleAccessToken: vi.fn(async (
      ...args: Parameters<typeof actual.getGoogleAccessToken>
    ) => {
      mocks.tokenCalls++

      return await actual.getGoogleAccessToken(...args)
    }),
  }
})

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

vi.mock('~~/server/api/v1/storage/index.get', () => ({
  invalidateStorageCache: vi.fn(async () => undefined),
}))

vi.mock('~~/server/utils/files/file-governance', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('~~/server/utils/files/file-governance')
  >()

  return {
    ...actual,
    getEffectiveUserFilePolicy: vi.fn(async () => ({
      tier: 'free',
      maxStorageBytes: 100 * 1024 * 1024,
      maxFilesPerMessage: 10,
      maxMessageFilesBytes: 1000 * 1024 * 1024,
      fileRetentionDays: 30,
      imageTransformLimitTotal: 0,
      imageTransformUsedTotal: 0,
    })),
    getUserStorageUsageBytes: vi.fn(async () => 0),
  }
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

interface FakeDriveFile {
  metadata: Record<string, unknown>
  media?: Uint8Array
  exports?: Record<string, string>
  metadataError?: { status: number, reason: string }
}

interface FakeDriveRequest {
  kind: 'metadata' | 'export' | 'media'
  fileId: string
}

function createFakeDrive(files: Record<string, FakeDriveFile>) {
  const requests: FakeDriveRequest[] = []
  const fetch = vi.fn(async (input: string) => {
    const url = new URL(input)
    const match = url.pathname.match(/^\/drive\/v3\/files\/([^/]+)(\/export)?$/)
    const file = match ? files[match[1]!] : undefined

    if (!match || !file) {
      requests.push({ kind: 'metadata', fileId: match?.[1] ?? '' })

      return new Response(JSON.stringify({
        error: { errors: [{ reason: 'notFound' }] },
      }), { status: 404 })
    }

    if (match[2]) {
      requests.push({ kind: 'export', fileId: match[1]! })

      const exported = file.exports?.[url.searchParams.get('mimeType') ?? '']

      return exported === undefined
        ? new Response('{}', { status: 400 })
        : new Response(exported)
    }

    if (url.searchParams.get('alt') === 'media') {
      requests.push({ kind: 'media', fileId: match[1]! })

      return new Response(file.media as BodyInit)
    }

    requests.push({ kind: 'metadata', fileId: match[1]! })

    if (file.metadataError) {
      return new Response(JSON.stringify({
        error: { errors: [{ reason: file.metadataError.reason }] },
      }), { status: file.metadataError.status })
    }

    return new Response(JSON.stringify(file.metadata))
  })

  return {
    fetch,
    requests,
    ofKind: (kind: FakeDriveRequest['kind']) => {
      return requests.filter(request => request.kind === kind)
    },
  }
}

type FakeDrive = ReturnType<typeof createFakeDrive>

function metadata(
  id: string,
  mimeType: string,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    name: 'Report',
    mimeType,
    modifiedTime: FIRST_EDIT,
    version: '3',
    capabilities: { canDownload: true },
    ...extra,
  }
}

function standardFiles(): Record<string, FakeDriveFile> {
  return {
    [DOC_ID]: {
      metadata: metadata(DOC_ID, 'application/vnd.google-apps.document'),
      exports: { 'text/markdown': '# Plan\n\nBody' },
    },
    [PDF_ID]: {
      metadata: metadata(PDF_ID, 'application/pdf', {
        name: 'Contract.pdf',
        size: '4',
      }),
      media: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    },
    [PNG_ID]: {
      metadata: metadata(PNG_ID, 'image/png', {
        name: 'Photo.png',
        size: '4',
      }),
      media: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    },
  }
}

async function failureOf(promise: Promise<unknown>) {
  try {
    await promise
  } catch (exception) {
    return exception as { status: number, code?: string }
  }

  throw new Error('Expected a rejection')
}

describe('POST /api/v1/google/drive/files/refresh', () => {
  let testDb: MemoryExtractionTestDb
  let kv: FakeConnectorKv
  let drive: FakeDrive
  let driveFiles: Record<string, FakeDriveFile>
  let userId: number
  let sessionUserId: number
  let restoreGoogleConfig: () => void = () => {}
  let stored: string[]

  function useDrive(files: Record<string, FakeDriveFile> = standardFiles()) {
    driveFiles = files
    drive = createFakeDrive(files)
    vi.stubGlobal('fetch', drive.fetch)
  }

  function editInDrive(fileId: string, modifiedTime: string) {
    driveFiles[fileId]!.metadata.modifiedTime = modifiedTime
  }

  async function seedConnection() {
    const { saveGoogleConnection } = await import(
      '~~/server/utils/google/tokens'
    )

    await saveGoogleConnection(testDb.db, {
      userId,
      clientMode: 'besidka',
      subject: `${GOOGLE_SUBJECT}-${userId}`,
      email: 'person@example.test',
      scopes: ['openid', DRIVE_FILE_SCOPE],
      accessToken: 'access-stored',
      accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
      refreshToken: 'refresh-stored',
    })
  }

  function eventFor(body: unknown, partial: Partial<SkillsRouteEvent> = {}) {
    return createSkillsRouteEvent({
      body,
      ...partial,
      headers: {
        'origin': ORIGIN,
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json',
        ...partial.headers,
      },
    })
  }

  async function importCopy(driveId: string) {
    const module = await import(
      '~~/server/api/v1/google/drive/files/index.post'
    )
    const result = await (module.default as Handler)(
      eventFor({ items: [{ id: driveId }] }),
    )

    return result.results[0]
  }

  async function refresh(
    ids: string[],
    partial: Partial<SkillsRouteEvent> = {},
  ) {
    const module = await import(
      '~~/server/api/v1/google/drive/files/refresh.post'
    )
    const result = await (module.default as Handler)(
      eventFor({ ids }, partial),
    )

    return result.results as Array<Record<string, any>>
  }

  async function fileRows() {
    return await testDb.db.select().from(schema.files)
      .where(eq(schema.files.userId, userId))
  }

  beforeEach(async () => {
    mocks.flags = new Set(['google.drive'])
    mocks.logged = []
    mocks.tokenCalls = 0
    stored = []
    testDb = createMemoryExtractionTestDb()
    kv = createFakeConnectorKv()
    userId = await seedUser(testDb.db)
    sessionUserId = userId
    useDrive()
    restoreGoogleConfig = await useGoogleRuntimeConfig()
    vi.stubGlobal('useDb', () => testDb.db)
    vi.stubGlobal('useKV', () => kv)
    vi.stubGlobal('useFileStorage', () => ({
      put: vi.fn(async (key: string) => {
        stored.push(key)

        return { key }
      }),
      head: vi.fn(async (key: string) => {
        return stored.includes(key) ? { key } : null
      }),
      delete: vi.fn(async () => undefined),
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

  describe('gates', () => {
    it('refuses a signed-out request', async () => {
      sessionUserId = 0

      expect((await failureOf(refresh(['skl1']))).status).toBe(401)
    })

    it('answers 404 while google.drive is not active', async () => {
      mocks.flags = new Set()

      expect((await failureOf(refresh(['skl1']))).status).toBe(404)
      expect(drive.fetch).not.toHaveBeenCalled()
    })

    it('refuses a cross-origin request', async () => {
      const failure = await failureOf(refresh(['skl1'], {
        headers: {
          'origin': 'https://evil.example',
          'sec-fetch-site': 'cross-site',
        },
      }))

      expect(failure.status).toBe(403)
    })

    it('answers 404 before any read when Google is not connected', async () => {
      await testDb.db.delete(schema.googleConnections)

      expect((await failureOf(refresh(['skl1']))).status).toBe(404)
      expect(drive.fetch).not.toHaveBeenCalled()
    })

    it('answers 409 when the connection needs re-authorization', async () => {
      await testDb.db.update(schema.googleConnections)
        .set({ status: 'needs_reauth' })

      expect((await failureOf(refresh(['skl1']))).status).toBe(409)
      expect(drive.fetch).not.toHaveBeenCalled()
    })

    it('answers 429 after ten requests a minute', async () => {
      for (let index = 0; index < 10; index++) {
        await refresh(['skl999'])
      }

      expect((await failureOf(refresh(['skl999']))).status).toBe(429)
    })

    it.each([
      ['no ids', []],
      ['six ids', ['skl1', 'skl2', 'skl3', 'skl4', 'skl5', 'skl6']],
      ['a duplicate', ['skl1', 'skl1']],
      ['an empty id', ['']],
    ])('answers 400 for %s', async (_name, ids) => {
      expect((await failureOf(refresh(ids))).status).toBe(400)
      expect(drive.fetch).not.toHaveBeenCalled()
    })

    it('answers 400 for an unknown body field', async () => {
      const module = await import(
        '~~/server/api/v1/google/drive/files/refresh.post'
      )
      const failure = await failureOf(
        (module.default as Handler)(eventFor({ ids: ['skl1'], extra: true })),
      )

      expect(failure.status).toBe(400)
    })
  })

  describe('results', () => {
    it('says up to date without downloading when nothing changed', async () => {
      const copy = await importCopy(PDF_ID)

      drive.requests.length = 0

      const results = await refresh([copy.file.id])

      expect(results).toEqual([{ id: copy.file.id, status: 'up_to_date' }])
      expect(drive.requests).toEqual([{ kind: 'metadata', fileId: PDF_ID }])
      expect(await fileRows()).toHaveLength(1)
    })

    it('makes a new copy of a changed original and keeps the old one',
      async () => {
        const copy = await importCopy(PDF_ID)

        editInDrive(PDF_ID, SECOND_EDIT)

        const [result] = await refresh([copy.file.id])
        const rows = await fileRows()

        expect(result).toMatchObject({
          id: copy.file.id,
          status: 'updated',
          file: { externalSource: 'google', externalId: PDF_ID },
        })
        expect(result!.file.id).not.toBe(copy.file.id)
        expect(rows).toHaveLength(2)
        expect(rows.map(row => row.storageKey)).toContain(
          copy.file.storageKey,
        )
        expect(rows.find(row => row.externalModifiedAt?.toISOString()
          === SECOND_EDIT)).toBeTruthy()
      })

    it('copies a Google Doc again through its export', async () => {
      const copy = await importCopy(DOC_ID)

      editInDrive(DOC_ID, SECOND_EDIT)

      const [result] = await refresh([copy.file.id])

      expect(result).toMatchObject({ status: 'updated' })
      expect(drive.ofKind('export')).toHaveLength(2)
    })

    it('reports a newer copy that already exists instead of copying again',
      async () => {
        const oldCopy = await importCopy(PDF_ID)

        editInDrive(PDF_ID, SECOND_EDIT)
        await refresh([oldCopy.file.id])
        drive.requests.length = 0

        const [result] = await refresh([oldCopy.file.id])

        expect(result).toMatchObject({
          id: oldCopy.file.id,
          status: 'newer_copy',
        })
        expect(drive.ofKind('media')).toHaveLength(0)
        expect(await fileRows()).toHaveLength(2)
      })

    it('reports a file in the trash as deleted and keeps the copy',
      async () => {
        const copy = await importCopy(PDF_ID)

        driveFiles[PDF_ID]!.metadata.trashed = true

        const [result] = await refresh([copy.file.id])

        expect(result).toMatchObject({
          id: copy.file.id,
          status: 'failed',
          code: 'deleted',
        })
        expect(await fileRows()).toHaveLength(1)
      })

    it('reports a file Drive no longer returns', async () => {
      const copy = await importCopy(PDF_ID)

      useDrive({ [DOC_ID]: standardFiles()[DOC_ID]! })

      const [result] = await refresh([copy.file.id])

      expect(result).toMatchObject({ status: 'failed', code: 'not_found' })
    })

    it('reports a file Besidka lost access to', async () => {
      const copy = await importCopy(PDF_ID)

      driveFiles[PDF_ID]!.metadataError = {
        status: 403,
        reason: 'insufficientFilePermissions',
      }

      const [result] = await refresh([copy.file.id])

      expect(result).toMatchObject({
        id: copy.file.id,
        status: 'failed',
        code: 'no_access',
      })
      expect(result!.reason).toContain('Besidka has no access')
      expect(await fileRows()).toHaveLength(1)
    })

    it('reports a Drive outage as a plain failure and keeps the copy',
      async () => {
        const copy = await importCopy(PDF_ID)

        driveFiles[PDF_ID]!.metadataError = {
          status: 500,
          reason: 'backendError',
        }

        const [result] = await refresh([copy.file.id])

        expect(result).toMatchObject({ status: 'failed', code: 'failed' })
        expect(await fileRows()).toHaveLength(1)
      })

    it('answers 409 when the connection ended after the copy was made',
      async () => {
        const copy = await importCopy(PDF_ID)

        await testDb.db.update(schema.googleConnections)
          .set({ status: 'needs_reauth' })

        const failure = await failureOf(refresh([copy.file.id]))

        expect(failure.status).toBe(409)
      })

    it('reports an original that grew past the limit', async () => {
      const copy = await importCopy(PDF_ID)

      editInDrive(PDF_ID, SECOND_EDIT)
      driveFiles[PDF_ID]!.metadata.size = String(21 * MEBIBYTE)

      const [result] = await refresh([copy.file.id])

      expect(result).toMatchObject({ status: 'failed', code: 'too_large' })
      expect(drive.ofKind('media')).toHaveLength(1)
    })

    it('reports a download the owner turned off', async () => {
      const copy = await importCopy(PDF_ID)

      editInDrive(PDF_ID, SECOND_EDIT)
      driveFiles[PDF_ID]!.metadata.capabilities = { canDownload: false }

      const [result] = await refresh([copy.file.id])

      expect(result).toMatchObject({
        status: 'failed',
        code: 'not_downloadable',
      })
    })

    it('gives each file its own result in the order asked', async () => {
      const first = await importCopy(PDF_ID)
      const second = await importCopy(PNG_ID)

      editInDrive(PNG_ID, SECOND_EDIT)

      const results = await refresh([second.file.id, first.file.id])

      expect(results.map(result => [result.id, result.status])).toEqual([
        [second.file.id, 'updated'],
        [first.file.id, 'up_to_date'],
      ])
    })

    it('checks one file at a time with a token for each', async () => {
      const first = await importCopy(PDF_ID)
      const second = await importCopy(PNG_ID)

      drive.requests.length = 0
      mocks.tokenCalls = 0

      await refresh([first.file.id, second.file.id])

      expect(drive.requests).toEqual([
        { kind: 'metadata', fileId: PDF_ID },
        { kind: 'metadata', fileId: PNG_ID },
      ])
      expect(mocks.tokenCalls).toBe(2)
    })
  })

  describe('ownership', () => {
    it('refuses another user copy without a Google call', async () => {
      const strangerId = await seedUser(testDb.db)
      const ownerId = userId

      userId = strangerId
      sessionUserId = strangerId
      await seedConnection()

      const strangerCopy = await importCopy(PDF_ID)

      userId = ownerId
      sessionUserId = ownerId
      drive.fetch.mockClear()
      mocks.tokenCalls = 0

      const [result] = await refresh([strangerCopy.file.id])

      expect(result).toMatchObject({
        id: strangerCopy.file.id,
        status: 'failed',
        code: 'not_a_copy',
      })
      expect(drive.fetch).not.toHaveBeenCalled()
      expect(mocks.tokenCalls).toBe(0)
    })

    it('refuses an id that is not a file and a file that is not a Drive copy',
      async () => {
        const [result] = await refresh(['skl12345'])

        expect(result).toMatchObject({ status: 'failed', code: 'not_a_copy' })

        await testDb.db.insert(schema.files).values({
          userId,
          storageKey: 'files/plain-upload',
          name: 'plain.pdf',
          size: 4,
          type: 'application/pdf',
          source: 'upload',
        })

        const [plain] = await fileRows()
        const [plainResult] = await refresh([plain!.id])

        expect(plainResult).toMatchObject({
          status: 'failed',
          code: 'not_a_copy',
        })
        expect(drive.requests).toHaveLength(0)
      })
  })

  it('sends no cache headers a browser could reuse', async () => {
    const module = await import(
      '~~/server/api/v1/google/drive/files/refresh.post'
    )
    const event = eventFor({ ids: ['skl12345'] })

    await (module.default as Handler)(event)

    expect(event.res.headers.get('cache-control')).toBe('no-store')
  })
})
