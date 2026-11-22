import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import * as schema from '~~/server/db/schema'
import {
  GOOGLE_DRIVE_EXPORT_MAX_BYTES,
  GOOGLE_DRIVE_FILE_MAX_BYTES,
} from '#shared/utils/google-drive'
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
const SHEET_ID = '1SheetSheetSheetSheetSheetSheet02'
const SLIDES_ID = '1SlidesSlidesSlidesSlidesSlides03'
const PDF_ID = '1PdfPdfPdfPdfPdfPdfPdfPdfPdfPdf04'
const PNG_ID = '1PngPngPngPngPngPngPngPngPngPng05'
const FOLDER_ID = '1FolderFolderFolderFolderFolder06'
const FORM_ID = '1FormFormFormFormFormFormFormFo07'
const ZIP_ID = '1ZipZipZipZipZipZipZipZipZipZip08'
const LOCKED_ID = '1LockedLockedLockedLockedLocked09'
const BIG_ID = '1BigBigBigBigBigBigBigBigBigBig10'
const MISSING_ID = '1MissingMissingMissingMissing1'
const SECRET_NAME = 'Secret acquisition plan'

const mocks = vi.hoisted(() => ({
  flags: new Set<string>(['google.drive']),
  logged: [] as unknown[],
  usedBytes: 0,
  maxStorageBytes: 100 * 1024 * 1024,
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
      maxStorageBytes: mocks.maxStorageBytes,
      maxFilesPerMessage: 10,
      maxMessageFilesBytes: 1000 * 1024 * 1024,
      fileRetentionDays: 30,
      imageTransformLimitTotal: 0,
      imageTransformUsedTotal: 0,
    })),
    getUserStorageUsageBytes: vi.fn(async () => mocks.usedBytes),
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
type BodySource = string | Uint8Array | (() => ReadableStream<Uint8Array>)

interface FakeDriveFile {
  metadata: Record<string, unknown>
  media?: BodySource
  mediaRedirect?: string
  exports?: Record<string, BodySource | { status: number, reason: string }>
}

interface FakeDriveRequest {
  kind: 'metadata' | 'export' | 'media' | 'content'
  url: string
  headers: Record<string, string>
}

function toBody(source: BodySource): BodyInit {
  if (typeof source === 'function') {
    return source()
  }

  return source as BodyInit
}

function endlessStream(chunkBytes: number) {
  return () => new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(chunkBytes))
    },
  })
}

function readHeaders(init: RequestInit | undefined) {
  return Object.fromEntries(Object.entries(
    (init?.headers ?? {}) as Record<string, string>,
  ).map(([name, value]) => [name.toLowerCase(), value]))
}

function createFakeDrive(files: Record<string, FakeDriveFile>) {
  const requests: FakeDriveRequest[] = []
  const contentByUrl = new Map<string, BodySource>()
  const fetch = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input)
    const headers = readHeaders(init)

    if (url.hostname.endsWith('.googleusercontent.com')) {
      requests.push({ kind: 'content', url: input, headers })

      const content = contentByUrl.get(input)

      return content
        ? new Response(toBody(content))
        : new Response('missing', { status: 404 })
    }

    const match = url.pathname.match(/^\/drive\/v3\/files\/([^/]+)(\/export)?$/)
    const file = match ? files[match[1]!] : undefined
    const notFound = new Response(JSON.stringify({
      error: { errors: [{ reason: 'notFound' }] },
    }), { status: 404 })

    if (!match || !file) {
      requests.push({ kind: 'metadata', url: input, headers })

      return notFound
    }

    if (match[2]) {
      requests.push({ kind: 'export', url: input, headers })

      const exported = file.exports?.[url.searchParams.get('mimeType') ?? '']

      if (!exported) {
        return new Response(JSON.stringify({
          error: { errors: [{ reason: 'badRequest' }] },
        }), { status: 400 })
      }

      if (typeof exported === 'object' && 'reason' in exported) {
        return new Response(JSON.stringify({
          error: { errors: [{ reason: exported.reason }] },
        }), { status: exported.status })
      }

      return new Response(toBody(exported))
    }

    if (url.searchParams.get('alt') === 'media') {
      requests.push({ kind: 'media', url: input, headers })

      if (file.mediaRedirect) {
        return new Response(null, {
          status: 302,
          headers: { location: file.mediaRedirect },
        })
      }

      return file.media === undefined
        ? notFound
        : new Response(toBody(file.media))
    }

    requests.push({ kind: 'metadata', url: input, headers })

    return new Response(JSON.stringify(file.metadata))
  })

  return {
    fetch,
    requests,
    serveContent(url: string, content: BodySource) {
      contentByUrl.set(url, content)
    },
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
    name: SECRET_NAME,
    mimeType,
    modifiedTime: '2026-11-20T10:00:00.000Z',
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
    [SHEET_ID]: {
      metadata: metadata(
        SHEET_ID,
        'application/vnd.google-apps.spreadsheet',
        { name: 'Budget' },
      ),
      exports: { 'text/csv': 'a,b\n1,2\n' },
    },
    [SLIDES_ID]: {
      metadata: metadata(
        SLIDES_ID,
        'application/vnd.google-apps.presentation',
        { name: 'Deck' },
      ),
      exports: { 'text/plain': 'Slide one' },
    },
    [PDF_ID]: {
      metadata: metadata(PDF_ID, 'application/pdf', {
        name: 'Contract.pdf',
        size: '2048',
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
    [FOLDER_ID]: {
      metadata: metadata(FOLDER_ID, 'application/vnd.google-apps.folder'),
    },
    [FORM_ID]: {
      metadata: metadata(FORM_ID, 'application/vnd.google-apps.form'),
    },
    [ZIP_ID]: {
      metadata: metadata(ZIP_ID, 'application/zip', {
        name: 'Archive.zip',
        size: '10',
      }),
      media: new Uint8Array([1, 2, 3]),
    },
    [LOCKED_ID]: {
      metadata: metadata(LOCKED_ID, 'application/pdf', {
        name: 'Locked.pdf',
        size: '10',
        capabilities: { canDownload: false },
      }),
      media: new Uint8Array([1]),
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

describe('POST /api/v1/google/drive/files', () => {
  let testDb: MemoryExtractionTestDb
  let kv: FakeConnectorKv
  let drive: FakeDrive
  let userId: number
  let sessionUserId: number
  let restoreGoogleConfig: () => void = () => {}
  let stored: Array<{ key: string, size: number, contentType: string }>

  function useDrive(files: Record<string, FakeDriveFile> = standardFiles()) {
    drive = createFakeDrive(files)
    vi.stubGlobal('fetch', drive.fetch)

    return drive
  }

  async function seedConnection(input: {
    status?: 'active' | 'needs_reauth'
    scopes?: string[]
  } = {}) {
    const { saveGoogleConnection } = await import(
      '~~/server/utils/google/tokens'
    )

    await saveGoogleConnection(testDb.db, {
      userId,
      clientMode: 'besidka',
      subject: GOOGLE_SUBJECT,
      email: 'person@example.test',
      scopes: input.scopes ?? ['openid', DRIVE_FILE_SCOPE],
      accessToken: 'access-stored',
      accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
      refreshToken: 'refresh-stored',
    })

    if (input.status === 'needs_reauth') {
      await testDb.db.update(schema.googleConnections)
        .set({ status: 'needs_reauth' })
        .where(eq(schema.googleConnections.userId, userId))
    }
  }

  async function importFiles(
    items: Array<{ id: string, resourceKey?: string }>,
    partial: Partial<SkillsRouteEvent> = {},
  ) {
    const module = await import(
      '~~/server/api/v1/google/drive/files/index.post'
    )
    const event = createSkillsRouteEvent({
      body: { items },
      ...partial,
      headers: {
        'origin': ORIGIN,
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json',
        ...partial.headers,
      },
    })
    const result = await (module.default as Handler)(event)

    return { result, event }
  }

  async function importOne(id: string, resourceKey?: string) {
    const { result } = await importFiles([{ id, resourceKey }])

    return result.results[0]
  }

  async function fileRows() {
    return await testDb.db.select().from(schema.files)
      .where(eq(schema.files.userId, userId))
  }

  beforeEach(async () => {
    mocks.flags = new Set(['google.drive'])
    mocks.logged = []
    mocks.usedBytes = 0
    mocks.maxStorageBytes = 100 * MEBIBYTE
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
      put: vi.fn(async (
        key: string,
        data: Uint8Array,
        options: { httpMetadata: { contentType: string } },
      ) => {
        stored.push({
          key,
          size: data.byteLength,
          contentType: options.httpMetadata.contentType,
        })

        return { key }
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

      expect((await failureOf(importFiles([{ id: DOC_ID }]))).status)
        .toBe(401)
    })

    it('answers 404 while google.drive is not active', async () => {
      mocks.flags = new Set()

      expect((await failureOf(importFiles([{ id: DOC_ID }]))).status)
        .toBe(404)
      expect(drive.fetch).not.toHaveBeenCalled()
    })

    it('refuses a cross-origin request', async () => {
      const failure = await failureOf(importFiles([{ id: DOC_ID }], {
        headers: {
          'origin': 'https://evil.example',
          'sec-fetch-site': 'cross-site',
        },
      }))

      expect(failure.status).toBe(403)
    })

    it('answers 429 after ten imports a minute', async () => {
      for (let index = 0; index < 10; index++) {
        await importFiles([{ id: FOLDER_ID }])
      }

      expect((await failureOf(importFiles([{ id: FOLDER_ID }]))).status)
        .toBe(429)
    })

    it.each([
      ['no items', []],
      ['six items', Array.from({ length: 6 }, (_, index) => {
        return { id: `1Pick${String(index).padStart(2, '0')}Pick${index}`
          .padEnd(20, 'x') }
      })],
      ['a duplicate', [{ id: DOC_ID }, { id: DOC_ID }]],
      ['a path in the id', [{ id: '../../etc/passwd' }]],
      ['a short id', [{ id: 'abc' }]],
      ['a bad resource key', [{ id: DOC_ID, resourceKey: 'a b/c' }]],
    ])('answers 400 for %s', async (_name, items) => {
      expect((await failureOf(importFiles(items))).status).toBe(400)
      expect(drive.fetch).not.toHaveBeenCalled()
    })

    it('answers 400 for an unknown body field', async () => {
      const failure = await failureOf(importFiles([{ id: DOC_ID }], {
        body: { items: [{ id: DOC_ID }], extra: true },
      }))

      expect(failure.status).toBe(400)
    })

    it('answers 404 before any read when Google is not connected', async () => {
      await testDb.db.delete(schema.googleConnections)

      expect((await failureOf(importFiles([{ id: DOC_ID }]))).status)
        .toBe(404)
      expect(drive.fetch).not.toHaveBeenCalled()
    })

    it('answers 409 when the connection needs re-authorization', async () => {
      await testDb.db.update(schema.googleConnections)
        .set({ status: 'needs_reauth' })

      expect((await failureOf(importFiles([{ id: DOC_ID }]))).status)
        .toBe(409)
      expect(drive.fetch).not.toHaveBeenCalled()
    })
  })

  describe('Google-native files', () => {
    it('exports a Doc to Markdown and stores it as a Google copy',
      async () => {
        const item = await importOne(DOC_ID)
        const [row] = await fileRows()

        expect(item).toMatchObject({
          id: DOC_ID,
          status: 'imported',
          file: {
            name: `${SECRET_NAME}.md`,
            type: 'text/markdown',
            externalSource: 'google',
            externalId: DOC_ID,
          },
        })
        expect(row).toMatchObject({
          source: 'upload',
          externalSource: 'google',
          externalId: DOC_ID,
          type: 'text/markdown',
          name: `${SECRET_NAME}.md`,
        })
        expect(row!.externalModifiedAt?.toISOString())
          .toBe('2026-11-20T10:00:00.000Z')
        expect(stored).toEqual([{
          key: row!.storageKey,
          size: '# Plan\n\nBody'.length,
          contentType: 'text/markdown',
        }])
        expect(drive.ofKind('export')[0]!.url)
          .toContain('mimeType=text%2Fmarkdown')
      })

    it('falls back to plain text when Markdown is not accepted', async () => {
      useDrive({
        [DOC_ID]: {
          metadata: metadata(DOC_ID, 'application/vnd.google-apps.document'),
          exports: { 'text/plain': 'Plain body' },
        },
      })

      const item = await importOne(DOC_ID)

      expect(item).toMatchObject({
        status: 'imported',
        file: { name: `${SECRET_NAME}.txt`, type: 'text/plain' },
      })
      expect(drive.ofKind('export')).toHaveLength(2)
    })

    it('exports a Sheet to CSV and says only the first sheet is included',
      async () => {
        const item = await importOne(SHEET_ID)

        expect(item).toMatchObject({
          status: 'imported',
          file: { name: 'Budget (first sheet).csv', type: 'text/csv' },
          note: 'Only the first sheet is included.',
        })
      })

    it('exports Slides to plain text', async () => {
      expect(await importOne(SLIDES_ID)).toMatchObject({
        status: 'imported',
        file: { name: 'Deck.txt', type: 'text/plain' },
      })
    })

    it('fails an over-cap export with its own reason', async () => {
      useDrive({
        [DOC_ID]: {
          metadata: metadata(DOC_ID, 'application/vnd.google-apps.document'),
          exports: {
            'text/markdown': {
              status: 403,
              reason: 'exportSizeLimitExceeded',
            },
          },
        },
      })

      expect(await importOne(DOC_ID)).toMatchObject({
        status: 'failed',
        code: 'export_too_large',
      })
      expect(await fileRows()).toHaveLength(0)
    })

    it('stops an export that streams past 10 MB', async () => {
      useDrive({
        [DOC_ID]: {
          metadata: metadata(DOC_ID, 'application/vnd.google-apps.document'),
          exports: { 'text/markdown': endlessStream(MEBIBYTE) },
        },
      })

      expect(await importOne(DOC_ID)).toMatchObject({
        status: 'failed',
        code: 'export_too_large',
      })
      expect(GOOGLE_DRIVE_EXPORT_MAX_BYTES).toBe(10 * MEBIBYTE)
      expect(stored).toHaveLength(0)
    })

    it('refuses a native type with no text export', async () => {
      expect(await importOne(FORM_ID)).toMatchObject({
        status: 'failed',
        code: 'unsupported_type',
      })
      expect(drive.ofKind('export')).toHaveLength(0)
    })
  })

  describe('other files', () => {
    it('downloads a PDF with shared drives enabled', async () => {
      const item = await importOne(PDF_ID)
      const [media] = drive.ofKind('media')

      expect(item).toMatchObject({
        status: 'imported',
        file: {
          name: 'Contract.pdf',
          type: 'application/pdf',
          externalSource: 'google',
        },
      })
      expect(media!.url).toContain('supportsAllDrives=true')
      expect(drive.ofKind('metadata')[0]!.url)
        .toContain('supportsAllDrives=true')
      expect(media!.headers.authorization).toBe('Bearer access-stored')
    })

    it('stores an image as it is', async () => {
      expect(await importOne(PNG_ID)).toMatchObject({
        status: 'imported',
        file: { type: 'image/png', size: 4 },
      })
    })

    it('sends the resource key with the lookup and the download',
      async () => {
        await importOne(PDF_ID, 'key-123')

        const header = 'x-goog-drive-resource-keys'

        expect(drive.ofKind('metadata')[0]!.headers[header])
          .toBe(`${PDF_ID}/key-123`)
        expect(drive.ofKind('media')[0]!.headers[header])
          .toBe(`${PDF_ID}/key-123`)
      })

    it('follows a download redirect to googleusercontent without the token',
      async () => {
        const contentUrl = 'https://doc-0g-docs.googleusercontent.com/p/x'

        useDrive({
          ...standardFiles(),
          [PDF_ID]: {
            ...standardFiles()[PDF_ID]!,
            media: undefined,
            mediaRedirect: contentUrl,
          },
        })
        drive.serveContent(contentUrl, new Uint8Array([0x25, 0x50]))

        const item = await importOne(PDF_ID)
        const [content] = drive.ofKind('content')

        expect(item).toMatchObject({ status: 'imported' })
        expect(content!.url).toBe(contentUrl)
        expect(content!.headers.authorization).toBeUndefined()
      })

    it('refuses a download redirect to a host that is not Google\'s',
      async () => {
        useDrive({
          ...standardFiles(),
          [PDF_ID]: {
            ...standardFiles()[PDF_ID]!,
            media: undefined,
            mediaRedirect: 'https://evil.example/steal',
          },
        })

        expect(await importOne(PDF_ID)).toMatchObject({
          status: 'failed',
          code: 'failed',
        })
        expect(drive.requests.some((request) => {
          return request.url.includes('evil.example')
        })).toBe(false)
        expect(await fileRows()).toHaveLength(0)
      })

    it('refuses a folder and a file type that cannot be attached',
      async () => {
        expect(await importOne(FOLDER_ID)).toMatchObject({
          status: 'failed',
          code: 'folder',
        })
        expect(await importOne(ZIP_ID)).toMatchObject({
          status: 'failed',
          code: 'unsupported_type',
        })
        expect(drive.ofKind('media')).toHaveLength(0)
      })

    it('does not download a file its owner locked', async () => {
      expect(await importOne(LOCKED_ID)).toMatchObject({
        status: 'failed',
        code: 'not_downloadable',
      })
      expect(drive.ofKind('media')).toHaveLength(0)
    })

    it('answers not found for a file Drive does not return', async () => {
      expect(await importOne(MISSING_ID)).toMatchObject({
        status: 'failed',
        code: 'not_found',
      })
    })

    it('asks the user to reconnect when Drive answers 401', async () => {
      drive.fetch.mockImplementation(async () => {
        return new Response('{}', { status: 401 })
      })

      expect(await importOne(PDF_ID)).toMatchObject({
        status: 'failed',
        code: 'reauthorize',
      })
    })

    it('answers not found for a trashed file', async () => {
      useDrive({
        [PDF_ID]: {
          metadata: metadata(PDF_ID, 'application/pdf', {
            size: '4',
            trashed: true,
          }),
          media: new Uint8Array([1]),
        },
      })

      expect(await importOne(PDF_ID)).toMatchObject({
        status: 'failed',
        code: 'not_found',
      })
      expect(drive.ofKind('media')).toHaveLength(0)
    })
  })

  describe('limits', () => {
    function bigFile(size: string | undefined) {
      return {
        [BIG_ID]: {
          metadata: metadata(BIG_ID, 'application/pdf', {
            name: 'Big.pdf',
            ...(size ? { size } : {}),
          }),
          media: endlessStream(MEBIBYTE),
        },
      }
    }

    it('refuses a file over the size cap before downloading', async () => {
      useDrive(bigFile(String(GOOGLE_DRIVE_FILE_MAX_BYTES + 1)))

      expect(await importOne(BIG_ID)).toMatchObject({
        status: 'failed',
        code: 'too_large',
      })
      expect(drive.ofKind('media')).toHaveLength(0)
    })

    it('enforces the cap while streaming when Drive gave no size', async () => {
      useDrive(bigFile(undefined))

      expect(await importOne(BIG_ID)).toMatchObject({
        status: 'failed',
        code: 'too_large',
      })
      expect(GOOGLE_DRIVE_FILE_MAX_BYTES).toBe(20 * MEBIBYTE)
      expect(stored).toHaveLength(0)
    })

    it('answers storage full before downloading when no space is left',
      async () => {
        mocks.usedBytes = mocks.maxStorageBytes

        expect(await importOne(PDF_ID)).toMatchObject({
          status: 'failed',
          code: 'storage_full',
        })
        expect(drive.ofKind('media')).toHaveLength(0)
        expect(drive.ofKind('export')).toHaveLength(0)
      })

    it('answers storage full before downloading a file that cannot fit',
      async () => {
        mocks.usedBytes = mocks.maxStorageBytes - 1000

        expect(await importOne(PDF_ID)).toMatchObject({
          status: 'failed',
          code: 'storage_full',
        })
        expect(drive.ofKind('media')).toHaveLength(0)
      })

    it('stops a stream that outgrows the space left', async () => {
      mocks.usedBytes = mocks.maxStorageBytes - 3 * MEBIBYTE
      useDrive(bigFile(undefined))

      expect(await importOne(BIG_ID)).toMatchObject({
        status: 'failed',
        code: 'storage_full',
      })
      expect(stored).toHaveLength(0)
    })
  })

  describe('reuse and partial success', () => {
    it('reuses an unchanged copy without downloading again', async () => {
      const first = await importOne(PDF_ID)
      const second = await importOne(PDF_ID)

      expect(first).toMatchObject({ status: 'imported' })
      expect(second).toMatchObject({
        status: 'reused',
        file: { id: first.file.id, storageKey: first.file.storageKey },
      })
      expect(drive.ofKind('media')).toHaveLength(1)
      expect(await fileRows()).toHaveLength(1)
      expect(stored).toHaveLength(1)
      expect(drive.ofKind('metadata')).toHaveLength(2)
    })

    it('copies again when the file changed in Drive', async () => {
      await importOne(PDF_ID)

      const files = standardFiles()

      files[PDF_ID]!.metadata = {
        ...files[PDF_ID]!.metadata,
        modifiedTime: '2026-11-21T09:00:00.000Z',
      }
      useDrive(files)

      expect(await importOne(PDF_ID)).toMatchObject({ status: 'imported' })
      expect(await fileRows()).toHaveLength(2)
    })

    it('never reuses another user\'s copy', async () => {
      const otherUserId = await seedUser(testDb.db)

      await testDb.db.insert(schema.files).values({
        userId: otherUserId,
        storageKey: 'other.pdf',
        name: 'Contract.pdf',
        size: 4,
        type: 'application/pdf',
        externalSource: 'google',
        externalId: PDF_ID,
        externalModifiedAt: new Date('2026-11-20T10:00:00.000Z'),
      })

      expect(await importOne(PDF_ID)).toMatchObject({ status: 'imported' })
    })

    it('does not reuse an expired copy', async () => {
      await testDb.db.insert(schema.files).values({
        userId,
        storageKey: 'expired.pdf',
        name: 'Contract.pdf',
        size: 4,
        type: 'application/pdf',
        externalSource: 'google',
        externalId: PDF_ID,
        externalModifiedAt: new Date('2026-11-20T10:00:00.000Z'),
        expiresAt: new Date(Date.now() - 1000),
      })

      expect(await importOne(PDF_ID)).toMatchObject({ status: 'imported' })
    })

    it('returns one result per file when some fail', async () => {
      const { result } = await importFiles([
        { id: DOC_ID },
        { id: FOLDER_ID },
        { id: PDF_ID },
        { id: MISSING_ID },
      ])

      expect(result.results.map((item: any) => item.status)).toEqual([
        'imported',
        'failed',
        'imported',
        'failed',
      ])
      expect(result.results.map((item: any) => item.id)).toEqual([
        DOC_ID,
        FOLDER_ID,
        PDF_ID,
        MISSING_ID,
      ])
      expect(await fileRows()).toHaveLength(2)
    })

    it('imports the files one at a time', async () => {
      let inFlight = 0
      let maxInFlight = 0
      const original = drive.fetch.getMockImplementation()!

      drive.fetch.mockImplementation(async (input, init) => {
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise(resolve => setTimeout(resolve, 1))

        try {
          return await original(input, init)
        } finally {
          inFlight--
        }
      })

      await importFiles([{ id: DOC_ID }, { id: PDF_ID }, { id: SHEET_ID }])

      expect(maxInFlight).toBe(1)
    })
  })

  describe('logging', () => {
    it('logs counts and ids, never a file name or a token', async () => {
      await importFiles([{ id: DOC_ID }, { id: FOLDER_ID }])

      const logged = JSON.stringify(mocks.logged)

      expect(logged).toContain('"imported":1')
      expect(logged).not.toContain(SECRET_NAME)
      expect(logged).not.toContain('access-stored')
      expect(logged).not.toContain('refresh-stored')
    })

    it('sends no cache headers a browser could reuse', async () => {
      const { event } = await importFiles([{ id: FOLDER_ID }])

      expect(event.res.headers.get('cache-control')).toBe('no-store')
    })
  })
})
